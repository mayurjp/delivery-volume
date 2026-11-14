"""`build`: derive all generated JSON from store/. Pure: no network access."""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from .. import config, metrics
from . import columns as C
from . import deals as deals_build
from . import loader, outputs, signal_perf
from . import periods as period_build
from . import trail as trail_build
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
    eq_syms = set(df["sym"])  # every symbol that trades EQ/BE/BZ in the store (SME-only names are not in it)
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
                           loader.load_hl52(alias, root), etf, loader.first_date("corp_actions", root=root))

    if out.exists():
        for sub in ("daily", "cum", "symbols", "stats", "weekly", "monthly", "trail", "deals", "institutional"):
            shutil.rmtree(out / sub, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    outputs._DIRS.clear()

    # Rolling publish window (07 section 8): published files cover only the last `historyTradingDays` days; the store and
    # every statistic keep the whole history, and cum/ stays cumulative from the first stored day.
    hist = settings.get("publish", {}).get("historyTradingDays")
    pub_start = max(0, len(days) - hist) if hist else 0
    pub_days = days[pub_start:]
    pub_first = pub_days[0].isoformat()
    iso_all_days = [d.isoformat() for d in days]
    meta = outputs.build_meta(pub_days, uni, asof, settings, root, store_first=days[0].isoformat())
    validate("meta", meta)
    outputs.dump(out / "meta.json", meta)

    uni_doc = {"schemaVersion": 1, "columns": outputs.C.names(outputs.C.UNIVERSE),
               "rows": outputs.table(uni, outputs.C.UNIVERSE)}
    validate("universe", uni_doc)
    outputs.dump(out / "universe.json", uni_doc)

    dealb = deals_build.build_deals(out, alias, eq_syms, root)
    deals_build.build_institutional(out, iso_all_days, root)
    outputs.flush()
    lap(f"deals: {deals_build.outputs_summary(dealb)}")
    sizes = {"daily": outputs.write_daily(df, pub_days, out, settings.get("publish", {}).get("dailyFullTradingDays"))}
    outputs.flush()
    lap(f"daily written ({sizes['daily'] / 1e6:.1f} MB)")
    sizes["cum"] = outputs.write_cum(df, days, list(uni["sym"]), settings["carryForwardMaxDays"], out, pub_start)
    outputs.flush()
    lap(f"cum written ({sizes['cum'] / 1e6:.1f} MB)")
    sizes["symbols"] = outputs.write_symbols(df, uni, corp, out, pub_first, dealb.by_sym, dealb.flow_rows)
    outputs.flush()
    lap(f"symbols written ({sizes['symbols'] / 1e6:.1f} MB)")
    iso_days = [d.isoformat() for d in days]
    idx_close = loader.load_indices_close(days, root)
    frames = period_build.compute_period_frames(df, iso_days, settings, signals, etf)
    lap("period frames computed (w, m, q)")
    pub_frames = period_build.clip_frames(frames, pub_first) if pub_start else frames
    market = outputs.build_market(df[df["date"] >= pub_first] if pub_start else df, pub_days, uni, idx_close)
    market.update(period_build.market_blocks(pub_frames, uni, idx_close))
    validate("market", market)
    outputs.dump(out / "market.json", market)
    pdoc = period_build.periods_doc(pub_frames, settings, signals)
    validate("periods", pdoc)
    outputs.dump(out / "periods.json", pdoc)
    sizes["periods"] = period_build.write_snapshots(pub_frames, out)
    outputs.flush()
    lap(f"periods written ({sizes['periods'] / 1e6:.1f} MB)")
    adj = outputs.detected_adjustments(df, loader.first_date("corp_actions", root=root), settings.get("notSplits", []))
    split_doc = outputs.build_split_bonus(corp, adj)
    validate("split_bonus", split_doc)
    outputs.dump(out / "stats" / "split_bonus.json", split_doc)
    perf = signal_perf.compute(df, iso_days, uni, C.INDICES.index("NIFTY200"))
    validate("signal_perf", perf)
    outputs.dump(out / "stats" / "signal_perf.json", perf)
    pperf = period_build.signal_perf_periods(df, frames, iso_days, uni, C.INDICES.index("NIFTY200"))
    validate("signal_perf_periods", pperf)
    outputs.dump(out / "stats" / "signal_perf_periods.json", pperf)
    tsize, tinfo = trail_build.write_trail(df, iso_days, uni, signals, out, pub_first, C.INDICES.index("NIFTY500"),
                                           dealb.flows, dealb.first_date)
    sizes["trail"] = tsize
    outputs.flush()
    lap(f"trail written ({tsize / 1e6:.1f} MB, {tinfo['asOf']} as-of snapshots, {tinfo['eligible']} stocks); build complete")
    return {"universe": len(uni), "days": len(days), "sizes": sizes, "seconds": time.monotonic() - t0}
