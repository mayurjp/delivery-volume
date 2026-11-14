"""S8 payload-date handling, S9/S10 dedupe, historical payload mapping and overlap with the daily files."""

import json
from datetime import date

import pandas as pd

from pipeline import collect
from pipeline.sources import s9_s10_deals as s9

DAILY_BULK = (
    b"Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price,Remarks\n"
    b"13-NOV-2026,AMBER,Amber Enterprises (I) Ltd,GRAVITON RESEARCH CAPITAL LLP,BUY,295139,6620.16,-\n"
    b"13-NOV-2026,AMBER,Amber Enterprises (I) Ltd,GRAVITON RESEARCH CAPITAL LLP,SELL,295139,6621.5,-\n"
    b'13-NOV-2026,X,X Ltd,"CLIENT, ONE",BUY,"1,000",10.5,-\n'
    b"13-NOV-2026,X,X Ltd,\"CLIENT, ONE\",BUY,\"1,000\",10.5,-\n"  # a genuine identical second trade
)
DAILY_BLOCK = (
    b"Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price\n"
    b"13-NOV-2026,MEESHO,Meesho Limited,ADITYA BIRLA SUN LIFE MUTUAL FUND,BUY,4200000,246.75\n"
)


def daily_frame():
    D = date(2026, 11, 13)
    bulk = collect.normalise_deals(s9.SPEC_BULK.parse(DAILY_BULK, D).data, "bulk")
    block = collect.normalise_deals(s9.SPEC_BLOCK.parse(DAILY_BLOCK, D).data, "block")
    return pd.concat([bulk, block], ignore_index=True)


def hist_record(**kw):
    rec = {"BD_DT_DATE": "13-NOV-2026", "BD_DT_ORDER": "2026-11-12T18:30:00.000Z", "BD_SYMBOL": "AMBER",
           "BD_SCRIP_NAME": "Amber Enterprises (I) Ltd", "BD_CLIENT_NAME": "GRAVITON RESEARCH CAPITAL LLP",
           "BD_BUY_SELL": "BUY", "BD_QTY_TRD": 295139, "BD_TP_WATP": 6620.16, "BD_REMARKS": "-"}
    rec.update(kw)
    return rec


def test_daily_normalise_columns_and_types():
    df = daily_frame()
    assert list(df.columns) == collect.DEAL_COLUMNS
    assert df["date"].unique().tolist() == ["2026-11-13"]
    assert df["qty"].tolist() == [295139, 295139, 1000, 1000, 4200000]
    assert df.iloc[-1]["remarks"] == "-"  # block file has no Remarks column


def test_merge_dedupe_rerun_adds_zero_but_keeps_identical_trades(tmp_path):
    df = daily_frame()
    assert collect.merge_deals(df, tmp_path) == {2026: 5}
    assert collect.merge_deals(df, tmp_path) == {}  # re-run on the same day adds 0 rows
    stored = pd.read_csv(tmp_path / "deals" / "2026.csv")
    assert len(stored) == 5 and list(stored.columns) == collect.DEAL_COLUMNS
    # a late-added row in the batch is appended once
    extra = pd.concat([df, df.iloc[[0]].assign(qty=1)], ignore_index=True)
    assert collect.merge_deals(extra, tmp_path) == {2026: 1}


def test_merge_splits_years_by_trade_date(tmp_path):
    df = daily_frame()
    old = df.iloc[[0]].assign(date="2025-12-31")
    assert collect.merge_deals(pd.concat([df, old]), tmp_path) == {2026: 5, 2025: 1}
    assert (tmp_path / "deals" / "2025.csv").exists()


def test_historical_payload_mapping():
    recs = [hist_record(), hist_record(BD_BUY_SELL="sell", BD_REMARKS=None, BD_QTY_TRD="1,200", BD_TP_WATP="9.5")]
    df, problems = collect.normalise_historical(recs, "block")
    assert problems == []
    assert list(df.columns) == collect.DEAL_COLUMNS
    assert df.iloc[0].to_dict() == {"date": "2026-11-13", "type": "block", "symbol": "AMBER",
                                    "securityName": "Amber Enterprises (I) Ltd",
                                    "client": "GRAVITON RESEARCH CAPITAL LLP", "side": "BUY", "qty": 295139,
                                    "price": 6620.16, "remarks": "-"}
    assert df.iloc[1]["side"] == "SELL" and df.iloc[1]["remarks"] == "-" and df.iloc[1]["qty"] == 1200


def test_historical_payload_validation():
    recs = [hist_record(), {"BD_SYMBOL": "ONLY"}, hist_record(BD_BUY_SELL="HOLD"), hist_record(BD_QTY_TRD=None),
            hist_record(BD_DT_DATE="garbage")]
    df, problems = collect.normalise_historical(recs, "bulk")
    assert len(df) == 1
    assert len(problems) == 3


def test_backfill_then_daily_file_has_no_duplicates(tmp_path):
    hist = [hist_record(), hist_record(BD_BUY_SELL="SELL", BD_TP_WATP=6621.5),
            hist_record(BD_SYMBOL="X", BD_SCRIP_NAME="X Ltd", BD_CLIENT_NAME="CLIENT, ONE", BD_QTY_TRD=1000,
                        BD_TP_WATP=10.5),
            hist_record(BD_SYMBOL="X", BD_SCRIP_NAME="X Ltd", BD_CLIENT_NAME="CLIENT, ONE", BD_QTY_TRD=1000,
                        BD_TP_WATP=10.5)]
    h, _ = collect.normalise_historical(hist, "bulk")
    assert collect.merge_deals(h, tmp_path) == {2026: 4}
    # the daily bulk.csv for the same date overlaps: only the block row is new
    assert collect.merge_deals(daily_frame(), tmp_path) == {2026: 1}
    assert collect.merge_deals(h, tmp_path) == {}
    assert len(pd.read_csv(tmp_path / "deals" / "2026.csv")) == 5


def test_month_chunks():
    ch = collect.month_chunks(date(2025, 11, 15), date(2026, 1, 10))
    assert ch == [(date(2025, 11, 15), date(2025, 11, 30)), (date(2025, 12, 1), date(2025, 12, 31)),
                  (date(2026, 1, 1), date(2026, 1, 10))]


def test_capped_window_is_split_to_days_and_flags_truncated_day():
    calls = []

    def fake(client, kind, opt, a, b):
        calls.append((a, b))
        if a == b:
            return [hist_record()] * (collect.HIST_CAP if a == date(2026, 11, 3) else 1)
        return [hist_record()] * collect.HIST_CAP

    trunc: list[str] = []
    rows = collect.fetch_hist_range(None, "bulk", "bulk_deals", date(2026, 11, 2), date(2026, 11, 4), trunc, fake)
    assert trunc == ["bulk 2026-11-03"]
    assert len(rows) == 1 + collect.HIST_CAP + 1
    assert (date(2026, 11, 2), date(2026, 11, 2)) in calls


def test_fii_dii_payload_date_and_upsert(tmp_path):
    p = [{"category": "DII", "date": "13-Nov-2026", "buyValue": "1", "sellValue": "2", "netValue": "-1"},
         {"category": "FII/FPI", "date": "13-Nov-2026", "buyValue": "3", "sellValue": "2", "netValue": "1"}]
    assert collect.payload_date(p) == date(2026, 11, 13)
    assert collect.upsert_fii_dii(p, "t1", tmp_path) == "stored"
    assert collect.upsert_fii_dii(list(reversed(p)), "t2", tmp_path) == "skip"  # same figures, any order
    path = tmp_path / "fii_dii_cash" / "2026.jsonl"
    lines = path.read_text().splitlines()
    assert len(lines) == 1 and json.loads(lines[0])["date"] == "2026-11-13" and json.loads(lines[0])["fetchedAt"] == "t1"
    # revised provisional figures replace that date's line
    q = [dict(p[0], netValue="-5"), p[1]]
    assert collect.upsert_fii_dii(q, "t3", tmp_path) == "stored"
    assert len(path.read_text().splitlines()) == 1
    # next date is a new line; the file year comes from the payload date, not from today
    n = [dict(r, date="02-Jan-2027") for r in p]
    assert collect.upsert_fii_dii(n, "t4", tmp_path) == "stored"
    assert (tmp_path / "fii_dii_cash" / "2027.jsonl").exists()


def test_fii_dii_bad_dates_rejected(tmp_path):
    base = {"category": "DII", "buyValue": "1", "sellValue": "2", "netValue": "-1"}
    mixed = [dict(base, date="13-Nov-2026"), dict(base, category="FII/FPI", date="12-Nov-2026")]
    assert collect.payload_date(mixed) is None
    assert collect.upsert_fii_dii(mixed, "t", tmp_path) == "invalid"
    assert collect.upsert_fii_dii([dict(base, date="garbage")], "t", tmp_path) == "invalid"
    assert not (tmp_path / "fii_dii_cash").exists()
