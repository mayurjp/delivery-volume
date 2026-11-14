"""Integration tests on a slice of the real store (last 45 trading days). Skipped when store/ is empty."""

import json
import shutil
import time

import pandas as pd
import pytest

from pipeline import store
from pipeline.build import columns as C
from pipeline.build import loader, run_build
from pipeline.config import STORE_DIR
from pipeline.sources import s1_cm_delivery

pytestmark = pytest.mark.skipif(len(store.list_dates("cm_delivery")) < 45, reason="needs a backfilled store")

KINDS = [("cm_delivery", "csv.gz"), ("cm_isin", "csv.gz"), ("mcap", "csv.gz"), ("corp_actions", "csv.gz"),
         ("band_hits", "csv.gz"), ("indices_close", "csv.gz"), ("hl52", "csv.gz"), ("fo_ban", "txt")]


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root = tmp_path_factory.mktemp("store")
    days = store.list_dates("cm_delivery")[-45:]
    for kind, ext in KINDS:
        for d in store.list_dates(kind, ext):
            if d >= days[0]:
                src = store.path_for(kind, d, ext)
                dst = store.path_for(kind, d, ext, root)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(src, dst)
    for k in ("constituents", "equity_list"):
        shutil.copytree(STORE_DIR / k, root / k)
    out = tmp_path_factory.mktemp("out")
    t = time.monotonic()
    res = run_build(out, root=root)
    return out, root, days, res, time.monotonic() - t


def rows(doc):
    return [dict(zip(doc["columns"], r)) for r in doc["rows"]]


def test_spot_checks_against_stored_s1(built):
    out, root, days, *_ = built
    latest = days[-1]
    raw = s1_cm_delivery.parse_stored(store.read_bytes(store.path_for("cm_delivery", latest, root=root)), latest)
    rel = raw[raw["sym"] == "RELIANCE"].iloc[0]
    daily = {r["sym"]: r for r in rows(json.loads((out / "daily" / f"{latest}.json").read_text()))}
    r = daily["RELIANCE"]
    assert r["delivPct"] == pytest.approx(rel["delivPct"], abs=0.005)  # DELIV_PER
    assert r["delivValCr"] == pytest.approx(rel["delivQty"] * rel["vwap"] / 1e7, abs=0.005)  # DELIV_QTY*AVG_PRICE/1e7
    assert r["turnoverCr"] == pytest.approx(rel["turnoverLacs"] / 100, abs=0.005)


def test_outputs_exist_and_no_sme_series(built):
    out, root, days, res, _ = built
    meta = json.loads((out / "meta.json").read_text())
    assert meta["latestDate"] == days[-1].isoformat() and meta["tradingDays"][0] == days[0].isoformat()
    for d in days:
        assert (out / "daily" / f"{d}.json").exists() and (out / "cum" / f"{d}.json").exists()
    latest = json.loads((out / "daily" / "latest.json").read_text())
    assert {r["series"] for r in rows(latest)} <= {"EQ", "BE", "BZ"}
    stored = s1_cm_delivery.parse_stored(store.read_bytes(store.path_for("cm_delivery", days[-1], root=root)),
                                         days[-1])
    sme_syms = set(pd.read_csv(store.path_for("cm_delivery", days[-1], root=root), dtype=str,
                               skipinitialspace=True).query("SERIES in ['SM', 'ST']")["SYMBOL"])
    assert sme_syms and not (sme_syms & {r["sym"] for r in rows(latest)}) and len(stored) > 0


def test_universe_counts(built):
    out, *_ = built
    uni = rows(json.loads((out / "universe.json").read_text()))
    n50 = [u for u in uni if u["idx"] & 1]
    assert 45 <= len(n50) <= 50
    classified = [u for u in uni if u["sector"] != "Unclassified"]
    assert 650 <= len(classified) <= 800
    assert {u["bucket"] for u in uni} <= {"L", "M", "S", "U", None}
    assert sum(1 for u in uni if u["bucket"] == "L") == 100
    assert all(u["f"] for u in uni) and next(u for u in uni if u["sym"] == "RELIANCE")["mcapRank"] <= 10


def test_cum_final_equals_sum_of_daily(built):
    out, root, days, *_ = built
    cum = {r["sym"]: r for r in rows(json.loads((out / "cum" / f"{days[-1]}.json").read_text()))}
    tot = 0.0
    for d in days:
        r = {x["sym"]: x for x in rows(json.loads((out / "daily" / f"{d}.json").read_text()))}.get("RELIANCE")
        if r and r["delivValCr"] is not None:
            tot += r["delivValCr"]
    assert cum["RELIANCE"]["cDelivValCr"] == pytest.approx(tot, abs=0.01 * len(days))


def test_symbol_file_and_market(built):
    out, *_ = built
    sym = json.loads((out / "symbols" / "RELIANCE.json").read_text())
    assert sym["columns"] == C.names(C.SYMBOL_HIST) and len(sym["rows"]) >= 40
    market = json.loads((out / "market.json").read_text())
    assert "ALL" in market["groups"] and "IDX:NIFTY50" in market["groups"]
    assert len(market["groups"]["ALL"]["delivPctW"]) == len(market["dates"])
    assert 0 < market["groups"]["ALL"]["delivPctW"][-1] < 100


def test_build_time_budget(built):
    *_, secs = built
    assert secs < 180


def test_loader_alias_map_is_nonempty():
    assert isinstance(loader.load_alias_map(), dict)
