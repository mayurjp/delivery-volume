"""S17 symbol changes: dated, chained, reuse-safe aliasing in the build (DEVIATIONS #70)."""

import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from pipeline import fetch, store
from pipeline.build import loader, outputs
from pipeline.sources import s17_symbol_change as s17

FIX = Path(__file__).parent / "fixtures" / "symbolchange_sample.csv"


def alias_map(isin: dict | None = None) -> loader.AliasMap:
    changes = s17.changes(FIX.read_text(encoding="utf-8"))
    a = loader.AliasMap(isin or {})
    a.changes, a.isin = changes, isin or {}
    return a


def resolve(rows: list[tuple[str, str]], isin=None) -> list[str]:
    df = pd.DataFrame(rows, columns=["sym", "date"])
    return list(loader.resolve_alias(df["sym"], alias_map(isin), df["date"]))


def test_parse_and_changes_drop_bad_rows():
    p = s17.parse(FIX.read_bytes(), date(2026, 11, 14))
    assert p.header == s17.HEADER and any("row count" in e for e in p.errors)  # a fixture is below the 500-row floor
    ch = s17.changes(FIX.read_text(encoding="utf-8"))
    assert len(ch) == 7 and "BADROW" not in set(ch["old"])
    assert ch.loc[ch["old"] == "ZOMATO", "effective"].iloc[0] == "2025-04-09"
    assert s17.parse(b"A,B\n1,2\n", date(2026, 1, 1)).errors[0].startswith("schema_mismatch")


def test_rename_applies_only_before_the_effective_date():
    got = resolve([("ZOMATO", "2023-11-15"), ("ZOMATO", "2025-04-08"), ("ZOMATO", "2025-04-09"), ("ETERNAL", "2025-04-09")])
    assert got == ["ETERNAL", "ETERNAL", "ZOMATO", "ETERNAL"]  # on/after the effective date the old name is not renamed


def test_chain_lti_ltim_ltm_is_transitive():
    got = resolve([("LTI", "2022-06-01"), ("LTIM", "2024-01-01"), ("LTIM", "2026-02-26"), ("LTM", "2026-03-02")])
    assert got == ["LTM", "LTM", "LTM", "LTM"]
    assert resolve([("LTIM", "2026-03-02")]) == ["LTIM"]  # after the second rename the symbol is not mapped


def test_symbol_reuse_does_not_merge_the_new_company():
    # OLDX became NEWX on 2024-06-03; OTHER took the name OLDX on 2025-01-02
    got = resolve([("OLDX", "2024-01-10"), ("OLDX", "2025-03-03"), ("OTHER", "2024-10-01"), ("OTHER", "2025-01-02")])
    assert got == ["NEWX", "OLDX", "OLDX", "OTHER"]


def test_a_mapped_row_never_duplicates_an_existing_symbol_day():
    # CLA -> CLB on 2025-03-01, but CLB already trades on 2025-02-03 under its own name: that day stays unmerged
    got = resolve([("CLA", "2025-02-03"), ("CLB", "2025-02-03"), ("CLA", "2025-02-04")])
    assert got == ["CLA", "CLB", "CLB"]


def test_isin_timeline_wins_over_s17():
    assert resolve([("ZOMATO", "2024-01-01")], isin={"ZOMATO": "ELSEWHERE"}) == ["ELSEWHERE"]


def test_static_map_skips_names_that_still_trade(tmp_path):
    root = tmp_path
    p = root / "ref" / "symbolchange" / "2026-11-14.csv.gz"
    p.parent.mkdir(parents=True)
    p.write_bytes(store.gz_bytes(FIX.read_bytes()))
    isin = pd.DataFrame({"symbol": ["OLDX", "ETERNAL", "LTM"], "series": ["EQ"] * 3, "isin": ["I1", "I2", "I3"]})
    d = root / "cm_isin" / "2026" / "2026-11-13.csv.gz"
    d.parent.mkdir(parents=True)
    d.write_bytes(fetch.csv_gz(isin))
    a = loader.load_alias_map(root)
    assert a["ZOMATO"] == "ETERNAL" and a["LTI"] == "LTM" and a["LTIM"] == "LTM"
    assert "OLDX" not in a  # still trades (reused): only the dated rule applies


def test_snapshot_written_only_when_content_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch, "STORE_DIR", tmp_path)

    class R:
        ok, missing, body = True, False, FIX.read_bytes()

    monkeypatch.setattr(fetch, "_get", lambda *a, **k: R)
    monkeypatch.setattr(fetch, "_validate", lambda *a, **k: (None, None))
    monkeypatch.setattr(fetch.config, "run_here", lambda k: True)
    for day, want in ((date(2026, 11, 14), "stored"), (date(2026, 11, 28), "skip")):
        assert fetch.fetch_snapshots(None, day, {}, True, ["s17"])["s17"] == want
    assert [p.name for p in (tmp_path / "ref" / "symbolchange").iterdir()] == ["2026-11-14.csv.gz"]


def _series(sym_rows):
    rows = []
    for sym, d, q in sym_rows:
        rows.append(dict(sym=sym, date=d, close=100 + q % 7, prevClose=100.0, valid=True, delivQty=q, vol=q * 2, trades=q // 10,
                         delivValCr=q * 100 / 1e7, turnoverCr=q * 200 / 1e7, series="EQ", open=100, high=101, low=99,
                         vwap=100, flags=0))
    return pd.DataFrame(rows)


def test_renamed_history_is_one_series_in_symbols_and_cum_ranges(tmp_path):
    days = [date(2025, 4, 1) + timedelta(days=i) for i in range(20)]  # ZOMATO -> ETERNAL on 2025-04-09 (day 8)
    raw = _series([("ZOMATO" if d < date(2025, 4, 9) else "ETERNAL", d.isoformat(), 1000 + 10 * i)
                   for i, d in enumerate(days)])
    df = raw.copy()
    df["sym"] = loader.resolve_alias(raw["sym"], alias_map(), raw["date"])
    assert set(df["sym"]) == {"ETERNAL"} and not df.duplicated(["sym", "date"]).any()
    uni = pd.DataFrame([dict(sym="ETERNAL", f="ETERNAL", name="Eternal", sector="X", idx=0, bucket="L", etf=False)])
    outputs.write_symbols(df, uni, pd.DataFrame(columns=["sym", "exDate", "kind", "purpose"]), tmp_path)
    outputs.write_cum(df, days, ["ETERNAL"], 60, tmp_path)
    outputs.flush()
    sym = json.loads((tmp_path / "symbols" / "ETERNAL.json").read_text())
    assert sym["rows"][0][0] == days[0].isoformat() and len(sym["rows"]) == len(days)

    def cum(i):
        doc = json.loads((tmp_path / "cum" / f"{days[i].isoformat()}.json").read_text())
        return dict(zip(doc["columns"], doc["rows"][0]))

    a, b = 5, 15  # a range spanning the rename (day 8)
    direct = df[(df.date >= days[a].isoformat()) & (df.date <= days[b].isoformat())]["delivValCr"].sum()
    assert abs(cum(b)["cDelivValCr"] - cum(a - 1)["cDelivValCr"] - direct) < 0.01 * (b - a + 1)
    assert cum(b)["cDays"] - cum(a - 1)["cDays"] == b - a + 1
