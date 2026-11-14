"""ETF flagging: detection rule, PR-zip extract, mcap ranking exclusion, no signal, flag bit and schemas."""

import io
import zipfile
from datetime import date, timedelta

import pandas as pd
import pytest

from pipeline import config, metrics, store
from pipeline.build import columns as C
from pipeline.build import loader, outputs
from pipeline.build.schema import schemas, validate
from pipeline.etf import detect_etf
from pipeline.sources import s4_pr_zip

ETF_HEADER = ",".join(s4_pr_zip.ETF_HEADER)


# ---- detection rule ------------------------------------------------------------------------------------------------

def test_detect_etf_rules():
    s15 = {"TCS", "INFY", "NEWCO"}
    pr = {"NIFTYBEES", "RENAMEDETF"}
    mcap = {"TCS", "INFY", "DELISTED", "NEWCO", "NEWCO2"}
    syms = ["TCS", "INFY", "NIFTYBEES", "GOLDBEES", "DELISTED", "NEWCO2", "RENAMEDETF"]
    got = detect_etf(syms, pr, s15, mcap)
    # NIFTYBEES/RENAMEDETF: in the PR list. GOLDBEES: not in S15 and never in mcap (the PR list omits commodity ETFs).
    assert got == {"NIFTYBEES", "RENAMEDETF", "GOLDBEES"}
    # a delisted company or a listing S15 has not caught up with yet is NOT an ETF: it has a market cap in S4
    assert "DELISTED" not in got and "NEWCO2" not in got


def test_detect_etf_without_s15_snapshot_only_uses_pr_list():
    assert detect_etf(["AAA", "BBB"], {"BBB"}, set(), set()) == {"BBB"}


# ---- PR zip extract ------------------------------------------------------------------------------------------------

def _zip(etf_text: str | None, d=date(2026, 11, 13)) -> bytes:
    buf = io.BytesIO()
    tok = f"{d:%d%m%Y}"
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("readme.txt", "x")
        if etf_text is not None:
            z.writestr(f"etf{tok}.csv", etf_text)
    return buf.getvalue()


def test_s4_parses_etf_extract():
    text = (ETF_HEADER + "\nN,EQ,NIFTYBEES,NIPPON - NIFTYBEES,1,1,1,1,1,1,1,1,1,1,NIFTY 50\n"
            "N,EQ,ABSLBANETF,BIRLASLAMC - ABSLBANETF,1,1,1,1,1,1,1,1,1,1,NIFTY BANK\n")
    p = s4_pr_zip.parse(_zip(text), date(2026, 11, 13))
    assert list(p.data["etf"].columns) == ["symbol", "series"]
    assert list(p.data["etf"]["symbol"]) == ["ABSLBANETF", "NIFTYBEES"]  # sorted, stripped


def test_s4_missing_or_changed_etf_member_does_not_fail_the_day():
    base = s4_pr_zip.parse(_zip(None), date(2026, 11, 13))
    assert "etf" not in base.data and not any("etf" in e for e in base.errors)
    bad = s4_pr_zip.parse(_zip("A,B,C\n1,2,3\n"), date(2026, 11, 13))
    assert "etf" not in bad.data and not any("etf" in e for e in bad.errors)
    assert any("etf header changed" in n for n in bad.notes)


def test_loader_unions_stored_etf_files_and_applies_aliases(tmp_path):
    for d, syms in ((date(2026, 11, 12), ["OLDNAME", "AAA"]), (date(2026, 11, 13), ["AAA", "BBB"])):
        df = pd.DataFrame({"symbol": syms, "series": "EQ"})
        store.write_atomic(store.path_for("etf", d, root=tmp_path),
                           store.gz_bytes(df.to_csv(index=False, lineterminator="\n").encode()))
    assert loader.load_etf_symbols({"OLDNAME": "NEWNAME"}, tmp_path) == {"NEWNAME", "AAA", "BBB"}
    assert loader.load_etf_symbols({}, tmp_path / "nowhere") == set()


# ---- universe: mcap rank / bucket ----------------------------------------------------------------------------------

def _universe(pr_etf, mcap_rows, in_s15):
    days = [date(2026, 11, 12), date(2026, 11, 13)]
    syms = [r[0] for r in mcap_rows] + ["GOLDBEES"]
    df = pd.DataFrame([{"sym": s, "series": "EQ", "date": d.isoformat(), "close": 10.0} for s in syms for d in days])
    mcap = pd.DataFrame([{"symbol": s, "series": "EQ", "issueSize": 1.0, "mcapRs": m * 1e7} for s, m in mcap_rows])
    hist = mcap.assign(date="2026-11-13")[["symbol", "date", "issueSize"]]
    eq_list = pd.DataFrame({"SYMBOL": in_s15, "NAME OF COMPANY": "x", "DATE OF LISTING": "01-JAN-2020",
                            "ISIN NUMBER": "INE"})
    return outputs.build_universe_frame(df, days, config.settings(), mcap, hist, {}, eq_list, {}, {}, pr_etf)


def test_etfs_take_no_mcap_rank_or_bucket_and_do_not_shift_real_ranks():
    rows = [("ETFBIG", 900000.0), ("AAA", 500000.0), ("BBB", 400000.0), ("CCC", 300000.0)]
    # ETFBIG has a (hypothetical) mcap row and is in the PR ETF list; GOLDBEES has no mcap and is absent from S15
    u = _universe({"ETFBIG"}, rows, ["AAA", "BBB", "CCC"]).set_index("sym")
    assert bool(u.loc["ETFBIG", "etf"]) and bool(u.loc["GOLDBEES", "etf"])
    assert not u.loc[["AAA", "BBB", "CCC"], "etf"].any()
    assert pd.isna(u.loc["ETFBIG", "mcapRank"]) and pd.isna(u.loc["ETFBIG", "bucket"])
    assert pd.isna(u.loc["GOLDBEES", "mcapRank"]) and pd.isna(u.loc["GOLDBEES", "bucket"])
    assert list(u.loc[["AAA", "BBB", "CCC"], "mcapRank"]) == [1, 2, 3]  # not 2, 3, 4
    assert list(u.loc[["AAA", "BBB", "CCC"], "bucket"]) == ["L", "L", "L"]


def test_unflagged_symbol_with_big_mcap_still_ranks():
    rows = [("BIGCO", 900000.0), ("AAA", 500000.0)]
    u = _universe(set(), rows, ["BIGCO", "AAA"]).set_index("sym")
    assert not u.loc["BIGCO", "etf"] and u.loc["BIGCO", "mcapRank"] == 1 and u.loc["AAA", "mcapRank"] == 2


# ---- signals and flag bit ------------------------------------------------------------------------------------------

def _acc_frame(sym, n=60):
    rows = []
    for i in range(n):
        last = i == n - 1
        price = 1000.0
        dq = 300000 if last else 100000
        rows.append(dict(sym=sym, series="EQ", date=(date(2026, 1, 1) + timedelta(days=i)).isoformat(),
                         prevClose=price, open=price, high=price * 1.03, low=price - 2,
                         close=price * 1.03 if last else price + 1, vwap=price, vol=dq * 2,
                         turnoverLacs=dq * 2 * price / 1e5, trades=100, delivQty=dq,
                         delivPct=70.0 if last else 50.0))
    return pd.DataFrame(rows)


def test_etf_rows_keep_metrics_but_get_no_signal():
    df = pd.concat([_acc_frame("STOCK"), _acc_frame("ETFX")], ignore_index=True)
    out = metrics.compute_daily(df, config.settings(), config.signals(), {"ETFX"})
    last = out[out["date"] == out["date"].max()].set_index("sym")
    assert last.loc["STOCK", "signal"] == "ACC"  # the fixture really triggers a signal
    assert out[out["sym"] == "ETFX"]["signal"].isna().all()
    for col in ("spike", "delivPctDiff", "ret1", "delivPctPctile"):  # metrics are unchanged
        assert last.loc["ETFX", col] == pytest.approx(last.loc["STOCK", col], nan_ok=True)
    assert last.loc["ETFX", "spike"] > 1.5


def test_etf_flag_bit_512():
    assert C.FLAG["etf"] == 512
    assert len(set(C.FLAG.values())) == len(C.FLAG) and all(v & (v - 1) == 0 for v in C.FLAG.values())
    days = [date(2026, 11, 12), date(2026, 11, 13)]
    df = pd.DataFrame([{"sym": s, "series": "EQ", "date": d.isoformat(), "high": 1.0, "low": 1.0,
                        "lowLiquidity": False, "newListing": False} for s in ("AAA", "ETFX") for d in days])
    empty = pd.DataFrame(columns=["sym", "date"])
    out = outputs.add_flags(df, days, pd.DataFrame(columns=["sym", "exDate", "kind", "purpose"]), empty, empty,
                            pd.DataFrame(columns=["sym", "date", "high52", "low52"]), {"ETFX"})
    f = out.set_index("sym")["flags"]
    assert set(f["ETFX"]) == {512} and set(f["AAA"]) == {0}


# ---- schemas -------------------------------------------------------------------------------------------------------

def test_universe_and_symbol_schemas_carry_etf():
    assert C.UNIVERSE[-1] == ("etf", "b", None)
    sc = schemas()
    assert sc["universe"]["properties"]["columns"]["const"][-1] == "etf"
    assert "etf" in sc["symbol"]["required"] and sc["symbol"]["properties"]["etf"] == {"type": "boolean"}
    row = ["A", "A", "A", "INE", "IT", 0, None, None, None, None, [], False, True]
    validate("universe", {"schemaVersion": 1, "columns": C.names(C.UNIVERSE), "rows": [row]})
    with pytest.raises(Exception):
        validate("universe", {"schemaVersion": 1, "columns": C.names(C.UNIVERSE), "rows": [row[:-1] + ["yes"]]})
    sym = {"schemaVersion": 1, "sym": "A", "name": "A", "sector": "x", "idx": 0, "bucket": None,
           "columns": C.names(C.SYMBOL_HIST), "rows": [], "deals": [], "corpActions": [],
           "holdings": {"columns": C.HOLDINGS_COLS, "rows": []},
           "namedHolders": {"columns": C.NAMED_HOLDER_COLS, "rows": []},
           "dealFlows": {"columns": C.DEAL_FLOW_COLS, "rows": []}}
    with pytest.raises(Exception):
        validate("symbol", sym)  # etf is required
    validate("symbol", {**sym, "etf": False})
