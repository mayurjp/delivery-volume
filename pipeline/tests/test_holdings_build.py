"""Phase 4B holdings build (03 5.10, 04 5.4) on synthetic two-quarter extracts: QoQ changes, the NEW / UP / DOWN /
SAME / EXITED labels, dilutionFlag, quarter completeness, market-cap-weighted aggregates, disclosed-holding counts
and Promoter entity tags. Tests use no store and no site data."""

from __future__ import annotations

import json
from datetime import date

import pytest

from pipeline import entities as E
from pipeline.build import holdings as H


def _cats(**pct) -> dict:
    keys = ["promoter", "mf", "insurance", "bank", "pension", "aif", "otherDii", "fpi1", "fpi2", "fiiLegacy",
            "fdi", "swf", "retailSmall", "retailLarge", "corporate", "others"]
    out = {k: {"shares": 0, "pct": 0.0} for k in keys}
    for k, v in pct.items():
        out[k] = {"shares": int(v * 10_000), "pct": float(v)}
    return out


def _doc(sym, quarter, total, holders=(), filed="2026-10-20", **pct) -> dict:
    return {"sym": sym, "quarter": quarter, "filedOn": filed, "totalShares": total, "categories": _cats(**pct),
            "namedHolders": list(holders)}


def _h(cat, sub, name, pct, shares=None):
    return {"category": cat, "subType": sub, "holder": name, "shares": shares or int(pct * 10_000), "pct": pct}


# ---- the labels and groupings -----------------------------------------------------------------------------------

@pytest.mark.parametrize("prev,cur,label", [
    (None, 2.0, "NEW"),
    (2.0, 2.04, "SAME"),
    (2.0, 2.05, "UP"),  # |change| >= 0.05 pp
    (2.0, 1.95, "DOWN"),
    (2.0, 1.99, "SAME"),
    (2.0, None, "EXITED"),
])
def test_named_holder_labels_at_the_boundaries(prev, cur, label):
    prev_list = [] if prev is None else [_h("DII", "mf", "X", prev)]  # [] = a previous quarter without X (NEW)
    cur_list = [] if cur is None else [_h("DII", "mf", "X", cur)]
    rows = H.named_rows("ABC", cur_list, prev_list, lambda n: "e-" + n)
    if label == "EXITED":
        assert rows[-1][-1] == "EXITED" and rows[-1][5] is None and rows[-1][7] == 2.0
    else:
        assert rows[0][-1] == label
        assert rows[0][4] == "e-X"


def test_exited_is_synthesised_from_the_previous_quarter_and_means_below_1_or_sold():
    prev = [_h("FII", "fpi1", "GONE CAPITAL", 1.5), _h("DII", "mf", "STAYS MF", 2.5)]
    cur = [_h("DII", "mf", "STAYS MF", 2.5)]
    rows = H.named_rows("XYZ", cur, prev, lambda n: n.lower())
    exited = [r for r in rows if r[8] == "EXITED"]
    assert len(exited) == 1 and exited[0][3] == "GONE CAPITAL" and exited[0][7] == 1.5
    assert exited[0][5] is None and exited[0][6] is None  # no current holding is shown: the filing cannot tell


def test_no_previous_quarter_leaves_changes_unlabelled():
    rows = H.named_rows("XYZ", [_h("DII", "mf", "A", 3.0)], None, lambda n: n)
    assert rows[0][8] is None and rows[0][7] is None


def test_groupings_follow_the_spec_definitions():
    g = H.groupings({"fpi1": 10, "fpi2": 2, "fiiLegacy": 1, "fdi": 9, "swf": 9, "mf": 5, "insurance": 3, "bank": 1,
                     "pension": 0.5, "aif": 0.5, "otherDii": 0.5, "retailSmall": 4, "retailLarge": 2,
                     "promoter": 50})
    assert g["fiiPct"] == 13  # fdi and swf are not in FII (03 5.10)
    assert g["diiPct"] == 10.5
    assert g["retailPct"] == 6 and g["promoterPct"] == 50 and g["mfPct"] == 5


# ---- stock rows: changes, dilution ------------------------------------------------------------------------------

def test_stock_row_changes_and_dilution_flag():
    prev = _doc("ABC", "2026-06-30", 1_000_000, promoter=60, mf=5, fpi1=10)
    cur = _doc("ABC", "2026-09-30", 1_030_000, promoter=58, mf=6.5, fpi1=9)  # shares +3%
    row = H.stock_row("ABC", cur, prev)
    cols = [c[0] for c in H.C.HOLD_STOCK]
    r = dict(zip(cols, row))
    assert r["mfChgPp"] == 1.5 and r["promoterChgPp"] == -2.0 and r["fiiChgPp"] == -1.0
    assert r["sharesChgPct"] == 3.0 and r["dilutionFlag"] is True


def test_no_dilution_flag_for_small_share_count_moves_and_none_without_previous():
    cur = _doc("ABC", "2026-09-30", 1_015_000, promoter=60)
    prev = _doc("ABC", "2026-06-30", 1_000_000, promoter=60)
    r = dict(zip([c[0] for c in H.C.HOLD_STOCK], H.stock_row("ABC", cur, prev)))
    assert r["dilutionFlag"] is False and r["sharesChgPct"] == 1.5
    first = dict(zip([c[0] for c in H.C.HOLD_STOCK], H.stock_row("ABC", cur, None)))
    assert first["mfChgPp"] is None and first["sharesChgPct"] is None and first["dilutionFlag"] is False


# ---- completeness -----------------------------------------------------------------------------------------------

def test_quarter_is_complete_at_95_percent_or_after_60_days():
    asof = date(2026, 11, 14)
    assert H.quarter_complete(95, 100, "2026-09-30", asof)  # 95% filed
    assert not H.quarter_complete(94, 100, "2026-09-30", asof)  # 45 days after quarter end, not 95%
    assert H.quarter_complete(10, 100, "2026-06-30", asof)  # 137 days after quarter end


# ---- build_holdings: files, validation, aggregates, disclosed counts, Promoter tags -----------------------------

def _universe():
    return [
        {"sym": "AAA", "mcapCr": 1000.0, "bucket": "L"},
        {"sym": "BBB", "mcapCr": 3000.0, "bucket": "M"},
        {"sym": "CCC", "mcapCr": 0.0, "bucket": None},
    ]


def _docs():
    gov = "OIL AND NATURAL GAS CORPORATION LIMITED"
    return [
        _doc("AAA", "2026-06-30", 1_000_000, [_h("DII", "mf", "SBI MUTUAL FUND", 2.0)], promoter=60, mf=2.0, fpi1=8,
             retailSmall=10),
        _doc("AAA", "2026-09-30", 1_000_000, [_h("DII", "mf", "SBI MUTUAL FUND", 3.0),
                                              _h("FII", "fpi1", "CAMAS PTE LTD", 1.2)],
             promoter=60, mf=3.0, fpi1=7.5, retailSmall=10, filed="2026-10-25"),
        _doc("BBB", "2026-06-30", 2_000_000, [_h("Promoter", "govtPromoted", gov, 30.0)], promoter=30, mf=10,
             retailSmall=20),
        _doc("BBB", "2026-09-30", 2_000_000, [_h("Promoter", "govtPromoted", gov, 30.0)], promoter=30, mf=12,
             retailSmall=18, filed="2026-10-28"),
    ]


def test_build_writes_validated_files_and_blocks(tmp_path):
    res = H.build_holdings(tmp_path, _universe(), date(2026, 11, 14), docs=_docs())
    assert (tmp_path / "holdings" / "holders" / "2026-09-30.json").exists()  # latest two quarters have holder files
    assert res.quarters == ["2026-06-30", "2026-09-30"]
    q = json.loads((tmp_path / "holdings" / "quarters.json").read_text(encoding="utf-8"))
    # June: 2 of 3 filed and 137 days after quarter end, so complete by the 60-day rule; September: 45 days, incomplete
    assert q["rows"][0][:3] == ["2026-06-30", 2, 3] and q["rows"][0][3] is True
    assert q["rows"][1][:3] == ["2026-09-30", 2, 3] and q["rows"][1][3] is False
    latest = json.loads((tmp_path / "holdings" / "latest.json").read_text(encoding="utf-8"))
    assert {r[1] for r in latest["rows"]} == {"AAA", "BBB"}
    assert res.by_sym["AAA"]["holdings"]["rows"][1][0] == "2026-09-30"
    named = res.by_sym["AAA"]["namedHolders"]["rows"]
    assert named[0][0] == "2026-09-30" and named[0][-1] == "UP"  # SBI: 2.0 -> 3.0
    assert any(r[-1] == "NEW" for r in named)  # CAMAS PTE LTD


def test_promoter_names_become_entities_of_type_promoter(tmp_path):
    res = H.build_holdings(tmp_path, _universe(), date(2026, 11, 14), docs=_docs())
    assert res.promoter_names == ["OIL AND NATURAL GAS CORPORATION LIMITED"]
    ent = res.index.resolve("Oil and Natural Gas Corporation Limited")
    assert ent.type == "Promoter" and ent.category == "Other" and ent.seeded
    assert E.default_index().resolve("Oil and Natural Gas Corporation Limited").type != "Promoter"  # base unchanged


def test_disclosed_counts_are_for_the_latest_quarter(tmp_path):
    res = H.build_holdings(tmp_path, _universe(), date(2026, 11, 14), docs=_docs())
    sbi = res.index.resolve("SBI MUTUAL FUND").id
    assert res.disclosed[sbi] == (1, "2026-09-30")
    assert res.disclosed[res.index.resolve("CAMAS PTE LTD").id] == (1, "2026-09-30")


def test_aggregates_are_market_cap_weighted(tmp_path):
    H.build_holdings(tmp_path, _universe(), date(2026, 11, 14), docs=_docs())
    agg = json.loads((tmp_path / "holdings" / "aggregates.json").read_text(encoding="utf-8"))
    rows = {(r[0], r[1]): r for r in agg["rows"]}
    # 2026-09-30, ALL: AAA (1000 Cr, mf 3.0) and BBB (3000 Cr, mf 12.0) -> (1000*3 + 3000*12)/4000 = 9.75
    assert rows[("2026-09-30", "ALL")][2] == 2
    assert rows[("2026-09-30", "ALL")][5] == pytest.approx(9.75, abs=0.01)  # diiPct is index 4; mf is in diiPct too
    assert ("2026-09-30", "MC:M") in rows and ("2026-09-30", "MC:L") in rows
    assert ("2026-09-30", "MC:U") not in rows  # no U-bucket stock


def test_validation_failure_stops_the_build(tmp_path):
    bad = _docs()
    bad[0]["totalShares"] = "many"  # not an integer: schema validation must refuse the write
    with pytest.raises(Exception):
        H.build_holdings(tmp_path, _universe(), date(2026, 11, 14), docs=bad)
