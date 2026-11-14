"""Phase 4 pipeline tests: entities and categories, round trips on a real same-day pair, flows = deal rows, dedupe,
the S7 parser on the real .xls, FII/DII cash gaps, and the dealsNet trail indicator (docs/specs 04 5.3, 07 6A)."""

from pathlib import Path

import pandas as pd
import pytest

from pipeline import collect
from pipeline import deals as D
from pipeline import institutional as I
from pipeline import trail as T
from pipeline.config import ROOT
from pipeline.entities import EntityIndex, clean_name, infer_type, is_round_trip, load_seeds
from pipeline.sources import s7_fii_stats

FIX = Path(__file__).parent / "fixtures"
STORE_DEALS = ROOT / "store" / "deals"


def _index() -> EntityIndex:
    return EntityIndex(load_seeds())


# ---- entities and categories ------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw, category, typ", [
    ("SBI MUTUAL FUND", "DII", "MF"),
    ("ABC NEWCO MUTUAL FUND", "DII", "MF"),  # unseeded: the name rule alone
    ("ICICI PRUDENTIAL LIFE INSURANCE COMPANY LIMITED", "DII", "Insurance"),
    ("ZETA GENERAL INSURANCE CO", "DII", "Insurance"),  # unseeded
    ("SOCIETE GENERALE - ODI", "FII", "FPI"),
    ("NEWCO HOLDINGS - ODI", "FII", "FPI (likely)"),  # unseeded ODI account
    ("GOLDMAN SACHS BANK EUROPE SE - ODI", "FII", "FPI"),  # ODI wins over BANK (DEVIATIONS #76)
    ("KOTAK MAHINDRA BANK LTD", "DII", "Bank"),
    ("JUNOMONETA FINSOL PRIVATE LIMITED", "Other", "Other"),
    ("PI OPPORTUNITIES AIF V LLP", "DII", "AIF"),  # AIF before the LLP prop-desk rule
    ("NIPPON INDIA EQUITY OPPORTUNITIES AIF SCHEME 7", "DII", "AIF"),
    ("FACTORY MUTUAL INSURANCE COMPANY", "FII", "FPI"),  # foreign insurer: seed beats the INSURANCE rule
])
def test_entity_category_for_names(raw, category, typ):
    e = _index().resolve(raw)
    assert e.category == category and e.type == typ


def test_inference_order_and_cleaning():
    assert clean_name("Goldman Sachs & Co. - ODI") == "GOLDMAN SACHS AND CO ODI"
    assert clean_name("Foo Private Limited") == clean_name("FOO PVT LTD") == "FOO PVT LTD"
    assert infer_type("PRIME MUTUAL FUND SCHEME") == "MF"
    assert infer_type("HOLD ME TRADING LLP") == "Trader/Prop (likely)"


def test_aliases_of_one_firm_resolve_to_one_entity():
    idx = _index()
    ids = {idx.resolve(n).id for n in ["GOLDMAN SACHS BANK EUROPE SE", "GOLDMAN SACHS INVESTMENTS MAURITIUS I LIMITED",
                                       "Goldman Sachs Trust II Goldman Sachs GQG"]}
    assert ids == {"goldman-sachs"}


def test_seed_covers_the_fifty_largest_fii_and_dii_names_by_value():
    """entities.json must list (as seeds, not only by name rule) the 50 largest FII and 50 largest DII entities."""
    if not STORE_DEALS.exists():
        pytest.skip("no stored deals")
    frames = [pd.read_csv(f, dtype=str, keep_default_na=False) for f in sorted(STORE_DEALS.glob("20*.csv"))]
    ds = D.build_deals(D.load_raw(frames), _index(), None, None)
    seeded = {e["id"] for e in load_seeds()}
    for cat in ("FII", "DII"):
        top = (ds[ds["entityCategory"] == cat].assign(v=lambda x: x["valueCr"].abs())
               .groupby("entityId")["v"].sum().sort_values(ascending=False).head(50).index)
        assert len(top) == 50, cat
        unseeded = [e for e in top if e not in seeded]
        assert not unseeded, (cat, unseeded)


def test_every_deal_row_has_a_category():
    raw = D.load_raw([pd.read_csv(FIX / "deals_sample.csv", dtype=str, keep_default_na=False)])
    ds = D.build_deals(raw, _index(), None, None)
    assert len(ds) == len(raw) and ds["entityCategory"].isin(["FII", "DII", "Other"]).all()


# ---- round trips ------------------------------------------------------------------------------------------------------

def test_round_trip_rule_thresholds():
    assert is_round_trip(772182, 826930)  # 6.6% apart
    assert not is_round_trip(100, 150)  # 33% apart
    assert not is_round_trip(0, 500)  # one side only


def test_round_trip_on_a_real_same_day_pair():
    raw = D.load_raw([pd.read_csv(FIX / "deals_sample.csv", dtype=str, keep_default_na=False)])
    ds = D.build_deals(raw, _index(), None, None)
    pair = ds[(ds["sym"] == "AGIIL") & (ds["date"] == "2026-01-01")]
    arihant = pair[pair["client"] == "ARIHANT CAPITAL MARKETS LIMITED"]
    assert sorted(arihant["side"]) == ["BUY", "SELL"]
    assert arihant["roundTrip"].all()
    single = pair[pair["client"] != "ARIHANT CAPITAL MARKETS LIMITED"]
    assert len(single) and not single["roundTrip"].any()


# ---- flows and totals -------------------------------------------------------------------------------------------------

def test_flows_totals_equal_the_deal_rows_they_come_from():
    raw = D.load_raw([pd.read_csv(FIX / "deals_sample.csv", dtype=str, keep_default_na=False)])
    ds = D.build_deals(raw, _index(), None, None)
    fl = D.flows(ds)
    live = ds[~ds["roundTrip"]]
    for cat in ("FII", "DII", "Other"):
        want = live[live["entityCategory"] == cat]
        net_want = round(float(want.loc[want["side"] == "BUY", "valueCr"].sum() - want.loc[want["side"] == "SELL", "valueCr"].sum()), 2)
        got = fl[fl["category"] == cat]["netValueCr"].sum()
        assert abs(got - net_want) < 0.05, cat
    ent = D.entity_totals(ds)
    assert abs(ent["netValueCr"].sum() - fl["netValueCr"].sum()) < 0.05


def test_entity_page_lists_every_alias():
    raw = D.load_raw([pd.read_csv(FIX / "deals_sample.csv", dtype=str, keep_default_na=False)])
    ds = D.build_deals(raw, _index(), None, None)
    ent = D.entity_totals(ds).set_index("entityId")
    gs = ds[ds["entityId"] == "goldman-sachs"]
    assert set(ent.loc["goldman-sachs", "aliases"]) == set(gs["client"])
    assert len(set(gs["client"])) >= 3  # the fixture has three spellings of the Goldman Sachs Bank Europe account


def test_symbol_rename_resolution_is_applied_before_grouping():
    raw = pd.DataFrame({"date": ["2025-01-02"], "type": ["bulk"], "symbol": ["OLDX"], "securityName": ["x"],
                        "client": ["ABC MUTUAL FUND"], "side": ["BUY"], "qty": [10.0], "price": [100.0],
                        "remarks": ["-"]})
    ds = D.build_deals(D.load_raw([raw]), _index(), {"NEWX"}, lambda s, d: s.map({"OLDX": "NEWX"}))
    assert list(ds["sym"]) == ["NEWX"]


# ---- dedupe -----------------------------------------------------------------------------------------------------------

def test_same_day_rerun_adds_zero_rows(tmp_path):
    src = pd.read_csv(FIX / "deals_sample.csv", dtype=str, keep_default_na=False)
    new = pd.DataFrame({
        "date": src["date"], "type": src["type"], "symbol": src["symbol"], "securityName": src["securityName"],
        "client": src["client"], "side": src["side"], "qty": src["qty"].astype(int), "price": src["price"].astype(float),
        "remarks": src["remarks"]})
    frame = collect.normalise_deals(new.rename(columns={"date": "Date", "symbol": "Symbol", "securityName": "Security Name",
                                                        "client": "Client Name", "side": "Buy/Sell",
                                                        "qty": "Quantity Traded",
                                                        "price": "Trade Price / Wght. Avg. Price",
                                                        "remarks": "Remarks"}).assign(
        Date=lambda x: pd.to_datetime(x["Date"]).dt.strftime("%d-%b-%Y").str.upper()), "bulk")
    first = collect.merge_deals(frame, tmp_path)
    again = collect.merge_deals(frame, tmp_path)
    assert sum(first.values()) == len(frame) and sum(again.values()) == 0


# ---- S7 ---------------------------------------------------------------------------------------------------------------

def test_s7_parser_reads_the_real_file():
    p = s7_fii_stats.parse((FIX / "fii_stats_sample.xls").read_bytes(), __import__("datetime").date(2026, 11, 13))
    assert p.ok, p.errors
    cats = {(r["category"], r["level"]) for r in p.data["rows"]}
    for c in s7_fii_stats.CATEGORIES:
        assert (c, "total") in cats
    total_stock_futures = next(r for r in p.data["rows"] if r["category"] == "STOCK FUTURES")
    assert total_stock_futures["buyContracts"] == 275871.0


# ---- FII/DII cash -----------------------------------------------------------------------------------------------------

def test_cash_rows_have_one_row_per_trading_day_with_nulls_for_gaps():
    recs = [
        {"date": "2026-11-11", "payload": [{"category": "DII", "buyValue": "100", "sellValue": "50", "netValue": "50"},
                                          {"category": "FII/FPI", "buyValue": "10", "sellValue": "20", "netValue": "-10"}]},
        {"date": "2026-11-13", "payload": [{"category": "DII", "buyValue": "1", "sellValue": "2", "netValue": "-1"},
                                          {"category": "FII/FPI", "buyValue": "3", "sellValue": "4", "netValue": "-1"}]},
    ]
    rows = I.cash_rows(recs, ["2026-11-09", "2026-11-11", "2026-11-12", "2026-11-13"])
    assert [r[0] for r in rows] == ["2026-11-11", "2026-11-12", "2026-11-13"]
    assert rows[1][1:] == [None] * 6  # the gap is never interpolated
    assert rows[0][3] == -10 and rows[2][6] == -1


def test_cash_payload_from_the_stored_fixture_line():
    rec = {"date": "2026-11-13", "payload": [
        {"buyValue": "11745.95", "category": "DII", "date": "13-Nov-2026", "netValue": "-2253.58", "sellValue": "13999.53"},
        {"buyValue": "18339.57", "category": "FII/FPI", "date": "13-Nov-2026", "netValue": "5736.55", "sellValue": "12603.02"}]}
    row = I.cash_rows([rec], ["2026-11-13"])[0]
    assert row == ["2026-11-13", 18339.57, 12603.02, 5736.55, 11745.95, 13999.53, -2253.58]


# ---- dealsNet (07 6A, Phase 4) ----------------------------------------------------------------------------------------

def _weekdays(n, start=(2025, 11, 3)):
    from datetime import date, timedelta

    d, out = date(*start), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _flat_rows(days):
    return [{"date": d, "series": "EQ", "close": 100.0, "prevClose": 100.0, "vol": 1000, "delivQty": 500,
             "turnoverCr": 1.0, "trades": 10, "delivValCr": 0.5, "spike": None, "flags": 0} for d in days]


def test_deals_net_thresholds_and_missing_before_coverage():
    days = _weekdays(300)
    cfg = {**T.trail_cfg(), "dealsFrom": days[0]}
    rows = _flat_rows(days)
    # a window with +20 Cr FII and +0 DII -> A; -20 Cr -> D; +4 Cr -> N
    for amount, want in ((20.0, "A"), (-20.0, "D"), (4.0, "N")):
        deals = {d: (amount / 63, 0.0) for d in days[-63:]}
        rec = T.trail_for_rows(rows, days, cfg, deals=deals)["windows"]["3M"]
        assert rec is not None and rec[0][4] == want, (amount, rec[0])
        assert rec[-2] == pytest.approx(amount, abs=0.05)  # dealsFii cell
    # no deal history configured: missing, never neutral
    rec = T.trail_for_rows(rows, days, {**cfg, "dealsFrom": None}, deals={})["windows"]["3M"]
    assert rec[0][4] == "-"


def test_deals_net_window_must_start_inside_the_deal_history():
    days = _weekdays(300)
    cfg = {**T.trail_cfg(), "dealsFrom": days[200]}  # history starts 200 days in: the 3M window (ending last) is covered
    rows = _flat_rows(days)
    rec = T.trail_for_rows(rows, days, cfg, deals={})["windows"]
    assert rec["3M"][0][4] == "N"  # covered, no deals
    assert rec["1Y"][0][4] == "-"  # its window starts before the history
