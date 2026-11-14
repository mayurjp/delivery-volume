"""`build`: derive all generated JSON from store/. Pure: no network access."""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from .. import config, metrics
from . import columns as C
from . import loader, outputs, signal_perf
from .schema import validate


def run_build(out: Path, root: Path | None = None, settings: dict | None = None, signals: dict | None = None) -> dict:
    t0 = time.monotonic()
    settings = settings or config.settings()
    signals = signals or config.signals()

    def lap(msg: str) -> None:
        print(f"[build {time.monotonic() - t0:6.1f}s] {msg}", flush=True)

    days = loader.trading_days(root)
    if not days:
        raise SystemExit("build: store has no trading days (run backfill first)")
    alias = loader.load_alias_map(root)
    df = loader.load_delivery(days, alias, root)
    lap(f"loaded {len(df):,} S1 rows over {len(days)} days; {len(alias)} symbol aliases")

    asof, constituents = loader.load_constituents(alias, root)
    eq_list = loader.load_equity_list(alias, root)
    mcap_latest = loader.load_mcap(days[-1], root)
    mcap_hist = loader.load_mcap_history(days, root)
    uni = outputs.build_universe_frame(df, days, settings, mcap_latest, mcap_hist, constituents, eq_list,
                                       loader.load_isin_latest(alias, root), alias, loader.load_etf_symbols(alias, root))
    df = df[df["sym"].isin(set(uni["sym"]))]
    lap(f"universe: {len(uni)} symbols")

    etf = set(uni.loc[uni["etf"], "sym"])
    lap(f"etf: {len(etf)} symbols flagged")
    df = metrics.compute_daily(df, settings, signals, etf)
    lap("metrics computed")
    corp = loader.load_corp_actions(alias, root)
    df = outputs.add_flags(df, days, corp, loader.load_band_hits(alias, root), loader.load_ban(alias, root),
                           loader.load_hl52(alias, root), etf)

    if out.exists():
        for sub in ("daily", "cum", "symbols", "stats"):
            shutil.rmtree(out / sub, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)

    meta = outputs.build_meta(days, uni, asof, settings, root)
    validate("meta", meta)
    outputs.dump(out / "meta.json", meta)

    uni_doc = {"schemaVersion": 1, "columns": outputs.C.names(outputs.C.UNIVERSE),
               "rows": outputs.table(uni, outputs.C.UNIVERSE)}
    validate("universe", uni_doc)
    outputs.dump(out / "universe.json", uni_doc)

    sizes = {"daily": outputs.write_daily(df, days, out)}
    outputs.flush()
    lap(f"daily written ({sizes['daily'] / 1e6:.1f} MB)")
    sizes["cum"] = outputs.write_cum(df, days, list(uni["sym"]), settings["carryForwardMaxDays"], out)
    outputs.flush()
    lap(f"cum written ({sizes['cum'] / 1e6:.1f} MB)")
    sizes["symbols"] = outputs.write_symbols(df, uni, corp, out)
    outputs.flush()
    lap(f"symbols written ({sizes['symbols'] / 1e6:.1f} MB)")
    market = outputs.build_market(df, days, uni, loader.load_indices_close(days, root))
    validate("market", market)
    outputs.dump(out / "market.json", market)
    outputs.flush()
    outputs.dump(out / "stats" / "split_bonus.json", outputs.build_split_bonus(corp))
    validate("split_bonus", outputs.build_split_bonus(corp))
    perf = signal_perf.compute(df, [d.isoformat() for d in days], uni, C.INDICES.index("NIFTY200"))
    validate("signal_perf", perf)
    outputs.dump(out / "stats" / "signal_perf.json", perf)
    outputs.flush()
    lap("market, split/bonus and signal_perf written; build complete")
    return {"universe": len(uni), "days": len(days), "sizes": sizes, "seconds": time.monotonic() - t0}
