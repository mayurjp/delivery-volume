"""S16 shareholding (Phase 4B): parser against committed XBRL fixtures, listing selection, capped mode with a mocked
listing, and the totals report. Tests never read site/public/data (CI has no generated data)."""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pytest

from pipeline import shareholding as SH
from pipeline import store
from pipeline.http import Response
from pipeline.sources import s16_shareholding as S

FIX = Path(__file__).parent / "fixtures" / "shareholding"
HAND = json.loads((FIX / "listing_handcheck.json").read_text(encoding="utf-8"))


def _xbrl(name: str) -> bytes:
    return gzip.decompress((FIX / name).read_bytes())


# ---- parser: hand-checks, totals, named holders -----------------------------------------------------------------

@pytest.mark.parametrize("row", HAND, ids=lambda r: r["symbol"])
def test_hand_check_promoter_and_public_match_listing(row):
    """06 Phase 4B: promoter % and public % for the latest quarter match NSE's summary fields within 0.01 pp.
    The listing fields pr_and_prgrp and public_val are the summary the shareholding page shows."""
    p = S.parse_xbrl(_xbrl(row["xbrlFile"]))
    assert p["ok"], p["problems"]
    assert p["sym"] == row["symbol"]
    assert abs(p["promoterPct"] - float(row["pr_and_prgrp"])) <= 0.01
    assert abs(p["publicPct"] - float(row["public_val"])) <= 0.01
    assert p["checks"]["ok"]


def test_known_values_for_hand_checks():
    """The numbers recorded in the report (so a parser change that moves them is visible)."""
    got = {r["symbol"]: S.parse_xbrl(_xbrl(r["xbrlFile"])) for r in HAND}
    assert (got["LT"]["promoterPct"], got["LT"]["publicPct"]) == (0.0, 100.0)
    assert (got["AUROPHARMA"]["promoterPct"], got["AUROPHARMA"]["publicPct"]) == (51.88, 48.12)
    assert (got["GESHIP"]["promoterPct"], got["GESHIP"]["publicPct"]) == (30.07, 69.93)


@pytest.mark.parametrize("row", HAND, ids=lambda r: r["symbol"])
def test_category_totals_sum_to_100(row):
    p = S.parse_xbrl(_xbrl(row["xbrlFile"]))
    total = sum(c["pct"] for c in p["categories"].values())
    assert abs(total - 100) <= 0.1
    assert set(p["categories"]) == set(S.CATEGORY_KEYS)


def test_named_holders_above_one_percent_with_joins():
    p = S.parse_xbrl(_xbrl("AUROPHARMA_30SEP2026.xml.gz"))
    holders = p["namedHolders"]
    assert holders, "a mid-cap with named mutual funds must yield named holders"
    assert all(h["pct"] >= 1.0 for h in holders)
    assert all(h["category"] in ("DII", "FII", "Promoter", "Other") for h in holders)
    assert all(isinstance(h["shares"], int) for h in holders)
    # the join: a named holder's shares equal the value context's shares (not another category's)
    total = p["totalShares"]
    assert all(abs(h["shares"] / total * 100 - h["pct"]) <= 0.01 for h in holders)


def test_government_promoted_holders_are_tagged_promoter():
    """IOC lists ONGC and Oil India under the government-promoted-company axis: the filing's own promoter class."""
    xml = _synthetic(holders=[("ShareholdingByCompaniesOrBodiesCorporateWhereCentralOrStateGovernmentIsPromoter",
                               "OIL AND NATURAL GAS CORPORATION LIMITED", 25.0, 200)], promoter=50.0)
    p = S.parse_xbrl(xml)
    assert p["ok"], p["problems"]
    named = {h["holder"]: h for h in p["namedHolders"]}
    assert named["OIL AND NATURAL GAS CORPORATION LIMITED"]["category"] == "Promoter"


def test_public_leaf_larger_than_public_total_is_promoter_overlap():
    """HDFC Life files HDFC Bank (the promoter) under the legacy banks member: it cannot be public."""
    xml = _synthetic(extra_leaves=[("IndianFinancialInstitutionsOrBanksMember", 60.0)], promoter=50.0)
    p = S.parse_xbrl(xml)
    assert p["ok"]
    assert p["categories"]["bank"]["pct"] == 0.0
    assert "bank" in p["promoterOverlap"]
    assert any("promoter-group overlap" in x for x in p["problems"])


def test_both_namespace_versions_parse_by_local_name():
    """The taxonomy is versioned by namespace (2025-05-31 and 2025-10-31). The parser matches local names only."""
    a = S.parse_xbrl(_synthetic(ns="2025-05-31"))
    b = S.parse_xbrl(_synthetic(ns="2025-10-31"))
    assert a["ok"] and b["ok"]
    assert a["format"] == "2025-05-31" and b["format"] == "2025-10-31"
    assert a["categories"] == b["categories"]


def test_totals_failure_is_reported_not_raised():
    xml = _synthetic(promoter=50.0, public_shares_override=10)  # shares do not add to the total
    p = S.parse_xbrl(xml)
    assert p["ok"]
    assert not p["checks"]["ok"]
    assert any("not 100" in x for x in p["problems"])


def test_garbage_input_is_not_a_crash():
    assert S.parse_xbrl(b"<html>nope</html>")["ok"] is False
    assert S.parse_xbrl(b"not xml at all")["ok"] is False


# ---- listing selection ------------------------------------------------------------------------------------------

def test_quarter_end_only_calendar_quarter_ends():
    assert S.quarter_end("30-SEP-2026") == date(2026, 9, 30)
    assert S.quarter_end("31-DEC-2025") == date(2025, 12, 31)
    assert S.quarter_end("16-SEP-2026") is None  # a non-quarter date is not a quarterly filing
    assert S.quarter_end("") is None


def test_latest_filings_takes_the_last_broadcast_per_quarter():
    rows = [
        {"symbol": "X", "date": "30-SEP-2026", "broadcastDate": "10-OCT-2026 10:00:00", "xbrl": "a", "recordId": "1"},
        {"symbol": "X", "date": "30-SEP-2026", "broadcastDate": "20-NOV-2026 09:00:00", "xbrl": "b", "recordId": "2",
         "revisedData": "Revised"},
        {"symbol": "X", "date": "16-SEP-2026", "broadcastDate": "21-OCT-2026 09:00:00", "xbrl": "c", "recordId": "3"},
    ]
    got = SH.latest_filings(rows, [date(2026, 9, 30)])
    assert set(got) == {("X", date(2026, 9, 30))}
    assert got[("X", date(2026, 9, 30))]["recordId"] == "2"


def test_windows_cover_the_range_without_gaps():
    w = SH.windows(date(2026, 1, 1), date(2026, 11, 14))
    assert w[0][0] == date(2026, 1, 1) and w[-1][1] == date(2026, 11, 14)
    assert all((b[0] - a[1]).days == 1 for a, b in zip(w, w[1:]))
    assert all((b - a).days + 1 <= 120 for a, b in w)


def test_quarter_ends_upto_returns_latest_n():
    qs = SH.quarter_ends_upto(date(2026, 11, 14), 4)
    assert qs == [date(2025, 12, 31), date(2026, 3, 31), date(2026, 6, 30), date(2026, 9, 30)]


def test_listing_url_uses_dd_mm_yyyy_and_the_date_range_variant():
    url = S.listing_url(date(2026, 7, 18), date(2026, 11, 14))
    assert url == ("https://www.nseindia.com/api/corporate-share-holdings-master?index=equities"
                   "&from_date=18-07-2026&to_date=14-11-2026")


# ---- capped mode with a mocked listing ---------------------------------------------------------------------------

@dataclass
class FakeClient:
    """Stands in for http.Client: counts every request, serves the listing rows published by `now`, and the
    committed XBRL fixtures for the download URLs."""
    now: date
    rows: list
    xbrl: dict
    requests: int = 0

    def warm_up(self, pages):
        self.requests += len(pages)
        return []

    def get(self, url, headers=None, source="", date="", retries=3):
        self.requests += 1
        if "corporate-share-holdings-master" in url:
            visible = [r for r in self.rows if S.broadcast_at(r["broadcastDate"]).date() <= self.now]
            return Response(url, 200, json.dumps(visible).encode(), 1)
        return Response(url, 200, self.xbrl[url], 1)


def _mcap_root(tmp_path: Path, rows: list[tuple[str, float]]) -> Path:
    root = tmp_path / "store"
    d = root / "mcap" / "2026"
    d.mkdir(parents=True)
    lines = ["symbol,series,issueSize,mcapRs"] + [f"{s},EQ,1,{v}" for s, v in rows]
    (d / "2026-11-13.csv.gz").write_bytes(gzip.compress(("\n".join(lines) + "\n").encode(), mtime=0))
    return root


def _handcheck_world():
    rows = []
    xbrl = {}
    for r in HAND:
        rows.append(dict(r))
        xbrl[r["xbrl"]] = _xbrl(r["xbrlFile"])
    return rows, xbrl


def test_capped_run_stays_within_max_requests(tmp_path):
    root = _mcap_root(tmp_path, [("LT", 3e11), ("AUROPHARMA", 2e11), ("GESHIP", 1e10)])
    rows, xbrl = _handcheck_world()
    client = FakeClient(now=date(2026, 11, 14), rows=rows, xbrl=xbrl)
    res = SH.run("daily", client=client, root=root, max_requests=4, today=date(2026, 11, 14))
    assert client.requests <= 4
    assert res["requests"] <= 4
    assert res["capped"] is True  # 3 filings were waiting, the cap left room for one download


def test_newly_filed_quarter_is_picked_up_within_seven_days(tmp_path):
    """A filing broadcast on 12-OCT-2026 (GESHIP) is not stored by a run on 10-OCT; a run on 16-OCT (4 days later)
    stores it. This is the 7-day pickup for the capped daily mode, simulated with a mocked listing."""
    root = _mcap_root(tmp_path, [("LT", 3e11), ("AUROPHARMA", 2e11), ("GESHIP", 1e10)])
    rows, xbrl = _handcheck_world()
    before = FakeClient(now=date(2026, 10, 10), rows=rows, xbrl=xbrl)
    res_a = SH.run("daily", client=before, root=root, max_requests=50, today=date(2026, 11, 14))
    assert res_a["stored"] == 0
    assert not (root / "shareholding" / "2026-09-30" / "GESHIP.json.gz").exists()
    after = FakeClient(now=date(2026, 10, 16), rows=rows, xbrl=xbrl)
    res_b = SH.run("daily", client=after, root=root, max_requests=50, today=date(2026, 11, 14))
    assert res_b["stored"] >= 1
    assert (root / "shareholding" / "2026-09-30" / "GESHIP.json.gz").exists()
    assert (date(2026, 10, 16) - date(2026, 10, 12)).days <= 7


def test_stored_extract_is_gzip_with_mtime_zero_and_round_trips(tmp_path):
    root = _mcap_root(tmp_path, [("LT", 3e11)])
    rows, xbrl = _handcheck_world()
    client = FakeClient(now=date(2026, 11, 14), rows=[r for r in rows if r["symbol"] == "LT"], xbrl=xbrl)
    SH.run("daily", client=client, root=root, max_requests=50, today=date(2026, 11, 14))
    path = root / "shareholding" / "2026-09-30" / "LT.json.gz"
    raw = path.read_bytes()
    assert raw[4:8] == b"\x00\x00\x00\x00"  # gzip header mtime 0
    doc = json.loads(gzip.decompress(raw))
    assert doc["sym"] == "LT" and doc["quarter"] == "2026-09-30"
    assert doc["filedOn"] == "2026-10-17" and doc["broadcastDate"].startswith("2026-10-17T10:11:10")
    assert doc["promoterPct"] == 0.0 and doc["publicPct"] == 100.0
    assert "xbrl" not in doc and len(raw) < 8000  # parsed extract only, small


def test_revised_filing_replaces_stored_extract(tmp_path):
    root = _mcap_root(tmp_path, [("LT", 3e11)])
    rows, xbrl = _handcheck_world()
    lt = [dict(r) for r in rows if r["symbol"] == "LT"]
    client = FakeClient(now=date(2026, 11, 14), rows=lt, xbrl=xbrl)
    SH.run("daily", client=client, root=root, max_requests=50, today=date(2026, 11, 14))
    lt[0]["recordId"] = "999999"
    res = SH.run("daily", client=FakeClient(now=date(2026, 11, 14), rows=lt, xbrl=xbrl), root=root,
                 max_requests=50, today=date(2026, 11, 14))
    assert res["stored"] == 1


def test_problem_filing_is_reported_and_the_run_continues(tmp_path):
    root = _mcap_root(tmp_path, [("LT", 3e11), ("AUROPHARMA", 2e11)])
    rows, xbrl = _handcheck_world()
    bad_url = [r for r in rows if r["symbol"] == "LT"][0]["xbrl"]
    xbrl[bad_url] = b"<html>error page</html>"  # a download that is not XBRL
    client = FakeClient(now=date(2026, 11, 14), rows=rows, xbrl=xbrl)
    res = SH.run("daily", client=client, root=root, max_requests=50, today=date(2026, 11, 14))
    assert res["invalid"] == 1 and res["stored"] >= 1
    report = store.read_json(root / "shareholding" / SH.PROBLEMS_FILE)
    assert report["count"] >= 1 and report["items"][0]["symbol"] == "LT"


def test_status_lines_show_coverage_and_the_target(tmp_path):
    root = _mcap_root(tmp_path, [("LT", 3e11), ("AUROPHARMA", 2e11)])
    lines = SH.status_lines(root)
    assert any("4-quarter coverage" in x and "target 95%" in x for x in lines)


# ---- synthetic XBRL for the cases the fixtures do not cover -------------------------------------------------------

def _synthetic(*, ns: str = "2025-10-31", promoter: float = 50.0, holders=(), extra_leaves=(),
               public_shares_override: int | None = None) -> bytes:
    """A minimal SHP document: MainD/MainI, the total, promoter, public, NPNP 0, and the given extra leaves/holders.
    Shares are derived from a 1,000,000-share total so that the percentages are exact."""
    total = 1_000_000
    prom_sh = int(total * promoter / 100)
    public_sh = total - prom_sh if public_shares_override is None else public_shares_override
    ctx: list[str] = []
    facts: list[str] = []

    def cat(cid: str, member: str, shares: int, pct: float | None = None):
        ctx.append(f'<xbrli:context id="{cid}"><xbrli:entity><xbrli:identifier scheme="s">1</xbrli:identifier>'
                   f'</xbrli:entity><xbrli:period><xbrli:instant>2026-09-30</xbrli:instant></xbrli:period>'
                   f'<xbrli:scenario><xbrldi:explicitMember dimension="in-bse-shp:CategoryOfShareholdersAxis">'
                   f'in-bse-shp:{member}</xbrldi:explicitMember></xbrli:scenario></xbrli:context>')
        facts.append(f'<in-bse-shp:NumberOfFullyPaidUpEquityShares contextRef="{cid}">{shares}</in-bse-shp:'
                     f'NumberOfFullyPaidUpEquityShares>')
        p = shares / total if pct is None else pct / 100
        facts.append(f'<in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="{cid}">{p}'
                     f'</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>')
        facts.append(f'<in-bse-shp:NumberOfShareholders contextRef="{cid}">1</in-bse-shp:NumberOfShareholders>')

    ctx.append('<xbrli:context id="MainD"><xbrli:entity><xbrli:identifier scheme="s">1</xbrli:identifier>'
               '</xbrli:entity><xbrli:period><xbrli:startDate>2026-07-01</xbrli:startDate><xbrli:endDate>'
               '2026-09-30</xbrli:endDate></xbrli:period></xbrli:context>')
    ctx.append('<xbrli:context id="MainI"><xbrli:entity><xbrli:identifier scheme="s">1</xbrli:identifier>'
               '</xbrli:entity><xbrli:period><xbrli:instant>2026-09-30</xbrli:instant></xbrli:period></xbrli:context>')
    facts.append('<in-bse-shp:Symbol contextRef="MainD">SYNTH</in-bse-shp:Symbol>')
    facts.append('<in-bse-shp:WhetherCompanyIsSME contextRef="MainI">******</in-bse-shp:WhetherCompanyIsSME>')
    facts.append('<in-bse-shp:DateOfReport contextRef="MainI">2026-09-30</in-bse-shp:DateOfReport>')
    cat("TotalC", "ShareholdingPatternMember", total, 100.0)
    cat("PromC", "ShareholdingOfPromoterAndPromoterGroupMember", prom_sh)
    cat("PubC", "PublicShareholdingMember", public_sh)
    cat("NpnpC", "SharesHeldByNonPromoterNonPublicShareholdersMember", 0, 0.0)
    cat("MfC", "MutualFundsOrUTIMember", 0)
    for i, (member, value) in enumerate(extra_leaves):
        shares = int(total * value / 100)
        cat(f"LeafC{i}", member, shares)
    for i, (axis_base, name, pct, shares) in enumerate(holders):
        cid = f"Val{i}_Context1"
        dim = f"in-bse-shp:DetailsOfSharesHeldBy{axis_base}Axis"
        ctx.append(f'<xbrli:context id="{cid}"><xbrli:entity><xbrli:identifier scheme="s">1</xbrli:identifier>'
                   f'</xbrli:entity><xbrli:period><xbrli:instant>2026-09-30</xbrli:instant></xbrli:period>'
                   f'<xbrli:scenario><xbrldi:typedMember dimension="{dim}"><in-bse-shp:Dom>{cid}</in-bse-shp:Dom>'
                   f'</xbrldi:typedMember></xbrli:scenario></xbrli:context>')
        ctx.append(f'<xbrli:context id="D_{cid}"><xbrli:entity><xbrli:identifier scheme="s">1</xbrli:identifier>'
                   f'</xbrli:entity><xbrli:period><xbrli:startDate>2026-07-01</xbrli:startDate><xbrli:endDate>'
                   f'2026-09-30</xbrli:endDate></xbrli:period><xbrli:scenario><xbrldi:typedMember dimension="{dim}">'
                   f'<in-bse-shp:Dom>{cid}</in-bse-shp:Dom></xbrldi:typedMember></xbrli:scenario></xbrli:context>')
        facts.append(f'<in-bse-shp:NameOfTheShareholder contextRef="D_{cid}">{name}</in-bse-shp:NameOfTheShareholder>')
        facts.append(f'<in-bse-shp:NumberOfFullyPaidUpEquityShares contextRef="{cid}">{shares}'
                     f'</in-bse-shp:NumberOfFullyPaidUpEquityShares>')
        facts.append(f'<in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="{cid}">{pct / 100}'
                     f'</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>')
        facts.append(f'<in-bse-shp:NumberOfShareholders contextRef="{cid}">1</in-bse-shp:NumberOfShareholders>')
    doc = (f'<?xml version="1.0" encoding="UTF-8"?><xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" '
           f'xmlns:in-bse-shp="http://www.bseindia.com/xbrl/shp/{ns}/in-bse-shp" '
           f'xmlns:xbrldi="http://xbrl.org/2006/xbrldi">' + "".join(ctx) + "".join(facts) + "</xbrli:xbrl>")
    return doc.encode("utf-8")
