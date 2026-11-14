"""Timeframes in `build` (docs/specs/08-timeframes.md): period frames, weekly/monthly snapshots, periods.json,
the market.json period blocks and the per-timeframe signal performance."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .. import metrics
from . import columns as C
from . import outputs, signal_perf
from .schema import validate

TF_DIRS = {"w": "weekly", "m": "monthly"}  # snapshot folders; quarterly has no snapshot files (08 section 5A)
TF_ALL = ("w", "m", "q")
PERIOD_HORIZONS = {"w": (20, 60), "m": (63, 126)}  # trading days: 4 and 12 weeks, 3 and 6 months
HORIZON_LABELS = {"w": ["4 weeks", "12 weeks"], "m": ["3 months", "6 months"]}
PERIOD_EVENTS = [("ACC", "Up on heavy delivery (ACC)"), ("DIS", "Down on heavy delivery (DIS)"),
                 ("ABS", "Heavy delivery, flat price (ABS)"), ("SPU", "Up on low delivery (SPU)"),
                 ("SPD", "Down on low delivery (SPD)")]
PERIOD_PERF_COLUMNS = ["tf", "event", "group", "horizon", "events", "n", "periods", "medianExcess", "meanExcess",
                       "hitRate"]
EXCLUDED_FLAGS = C.FLAG["lowLiquidity"] | C.FLAG["t2t"] | C.FLAG["etf"]

BASE_COLS = ["sym", "date", "series", "open", "high", "low", "close", "prevClose", "vwap", "vol", "turnoverCr",
             "trades", "delivQty", "delivValCr", "valid", "flags"]


def compute_period_frames(df: pd.DataFrame, days_iso: list[str], settings: dict, signals: dict,
                          etf: set) -> dict[str, tuple[list[dict], pd.DataFrame]]:
    """{tf: (periods, frame)} for w, m and q from the daily frame (sorted by sym, date)."""
    base = df[BASE_COLS]
    out = {}
    for tf in TF_ALL:
        periods = metrics.periods_for(days_iso, tf)
        out[tf] = (periods, metrics.aggregate_frame(base, periods, tf, settings, signals, etf))
    return out


def clip_frames(frames: dict, first_date: str) -> dict:
    """The period frames restricted to periods that START on or after `first_date` (the rolling publish window, 07 section 8);
    baselines were computed on the full history, so the kept rows are identical to the unclipped build's."""
    out = {}
    for tf, (periods, pf) in frames.items():
        keep = [i for i, p in enumerate(periods) if p["start"] >= first_date]
        remap = {old: new for new, old in enumerate(keep)}
        pf2 = pf[pf["pi"].isin(remap)].copy() if len(pf) else pf
        if len(pf2):
            pf2["pi"] = pf2["pi"].map(remap)
        out[tf] = ([periods[i] for i in keep], pf2.reset_index(drop=True))
    return out


def period_config(settings: dict, signals: dict) -> dict:
    """The thresholds and windows the client's aggregatePeriods needs (the same numbers the build used)."""
    return {"minPeriodsFraction": settings["minPeriodsFraction"], "liquidity": settings["liquidity"],
            "notSplits": settings.get("notSplits", []),
            "periods": {tf: {**metrics.DEFAULT_PERIOD_CFG[tf], **signals.get("periods", {}).get(tf, {})}
                        for tf in TF_ALL}}


def periods_doc(frames: dict, settings: dict, signals: dict) -> dict:
    """periods.json: the lists of weeks, months and quarters (08 section 4) and the period configuration."""
    doc: dict = {"schemaVersion": 1, "config": period_config(settings, signals)}
    names = {"w": "weekly", "m": "monthly", "q": "quarterly"}
    for tf, (periods, pf) in frames.items():
        counts = pf.groupby("pi").size() if len(pf) else pd.Series(dtype=int)
        items = []
        for i, p in enumerate(periods):
            item = {"key": p["key"], "start": p["start"], "end": p["end"], "tradingDays": p["tradingDays"],
                    "partial": bool(p["partial"]), "daysIn": p["daysIn"], "daysExpected": p["daysExpected"],
                    "stocks": int(counts.get(i, 0))}
            if tf in TF_DIRS:
                item["file"] = f"{TF_DIRS[tf]}/{p['end'] if tf == 'w' else p['key']}.json"
            items.append(item)
        doc[names[tf]] = items
    return doc


def write_snapshots(frames: dict, out: Path) -> int:
    """weekly/{weekEnd}.json and monthly/{YYYY-MM}.json: one columnar Screener snapshot per period, slim set only."""
    total = 0
    for tf, folder in TF_DIRS.items():
        periods, pf = frames[tf]
        if pf.empty:
            continue
        pf = pf.sort_values(["pi", "sym"], kind="stable").reset_index(drop=True)
        ft = outputs.FastTable(pf, C.PERIOD)
        bounds = pf["pi"].to_numpy()
        for i, p in enumerate(periods):
            a, b = np.searchsorted(bounds, i, "left"), np.searchsorted(bounds, i, "right")
            if b <= a:
                continue
            doc = {"schemaVersion": 1, "tf": tf, "key": p["key"], "start": p["start"], "end": p["end"],
                   "partial": bool(p["partial"]), "daysIn": p["daysIn"], "daysExpected": p["daysExpected"],
                   "columns": C.names(C.PERIOD), "rows": ft.rows(a, b)}
            validate("period", doc)
            name = p["end"] if tf == "w" else p["key"]
            total += outputs.dump(out / folder / f"{name}.json", doc)
    return total


def market_blocks(frames: dict, uni: pd.DataFrame, idx_close: pd.DataFrame) -> dict:
    """market.json `weekly`, `monthly` and `quarterly` blocks: the same groups and fields as the daily block, one
    entry per period (08 section 4)."""
    groups = outputs.market_group_members(uni)
    names = {"w": "weekly", "m": "monthly", "q": "quarterly"}
    blocks = {}
    for tf, (periods, pf) in frames.items():
        v = pf.copy()
        v["ret1"] = v["ret"]
        v["isSpike2"] = (v["spike"] >= 2) & ((v["flags"] & (C.FLAG["lowLiquidity"] | C.FLAG["newListing"])) == 0)
        ends = [p["end"] for p in periods]
        blocks[names[tf]] = {
            "keys": [p["key"] for p in periods], "ends": ends, "partial": [bool(p["partial"]) for p in periods],
            "groups": outputs.market_aggregate(v, groups, "pi", list(range(len(periods)))),
            "indexClose": outputs.index_close_series(idx_close, ends),
        }
    return blocks


def signal_perf_periods(df: pd.DataFrame, frames: dict, days: list[str], uni: pd.DataFrame, n200_bit: int) -> dict:
    """stats/signal_perf_periods.json: forward excess returns after each PERIOD signal (08 section 5).

    Events are the signals of complete weeks and months (partial periods are excluded). Entry is the close of the first
    trading day after the period ends; the horizons are 20 and 60 trading days (4 and 12 weeks) for weekly and 63 and
    126 (3 and 6 months) for monthly. The excess-return method is 04 section 6's: the stock's forward return minus
    the median forward return of every eligible stock of the same group with a valid window on the same period end;
    windows crossing a price adjustment are dropped."""
    T = len(days)
    tix = {d: i for i, d in enumerate(days)}
    syms = sorted(df["sym"].unique())
    si = {s: i for i, s in enumerate(syms)}
    ti_all, sj_all = df["date"].map(tix).to_numpy(), df["sym"].map(si).to_numpy()
    close = np.full((T, len(syms)), np.nan)
    prev = np.full((T, len(syms)), np.nan)
    close[ti_all, sj_all] = df["close"].to_numpy(float)
    prev[ti_all, sj_all] = df["prevClose"].to_numpy(float)
    adj = signal_perf.adjustment_matrix(close, prev)
    adj_cum = np.cumsum(np.nan_to_num(adj, nan=0).astype(int), axis=0)
    ud = uni.set_index("sym")
    rows: list[list] = []
    for tf in ("w", "m"):
        periods, pf = frames[tf]
        p = pf[~pf["partial"]]
        p = p[(p["flags"].to_numpy(np.int64) & EXCLUDED_FLAGS) == 0].reset_index(drop=True)
        end_idx = np.array([tix[q["end"]] for q in periods], dtype=np.int64)[p["pi"].to_numpy()]
        sj = p["sym"].map(si).to_numpy()
        bucket = p["sym"].map(ud["bucket"]).to_numpy(dtype=object)
        idx = p["sym"].map(ud["idx"]).fillna(0).to_numpy(np.int64)
        members = {"ALL": np.ones(len(p), bool), "IDX:NIFTY200": (idx >> n200_bit) & 1 == 1,
                   **{b: bucket == b for b in ("L", "M", "S", "U")}}
        sig = p["signal"].to_numpy(dtype=object)
        pidx = p["pi"].to_numpy()
        for k in PERIOD_HORIZONS[tf]:
            t0, tk = end_idx + 1, end_idx + 1 + k
            ok = tk < T
            a, b = np.where(ok, t0, 0), np.where(ok, tk, 0)
            with np.errstate(invalid="ignore", divide="ignore"):
                r = close[b, sj] / close[a, sj] - 1
            clean = ok & (adj_cum[b, sj] == adj_cum[np.where(ok, end_idx, 0), sj])
            fwd = np.where(clean, r * 100, np.nan)
            for g, m in members.items():
                med = pd.Series(fwd[m]).groupby(pidx[m]).median()
                ex = fwd - med.reindex(pidx).to_numpy()
                ex[~m] = np.nan
                for eid, _ in PERIOD_EVENTS:
                    em = (sig == eid) & m
                    x = ex[em]
                    keep = ~np.isnan(x)
                    n = int(keep.sum())
                    if n == 0:
                        rows.append([tf, eid, g, k, int(em.sum()), 0, 0, None, None, None])
                        continue
                    xv = x[keep]
                    rows.append([tf, eid, g, k, int(em.sum()), n, int(len(np.unique(pidx[em][keep]))),
                                 round(float(np.median(xv)), 3), round(float(xv.mean()), 3),
                                 round(float((xv > 0).mean() * 100), 1)])
    return {
        "schemaVersion": 1, "asOf": days[-1], "window": {"from": days[0], "to": days[-1]},
        "timeframes": {tf: {"horizons": list(PERIOD_HORIZONS[tf]), "horizonLabels": HORIZON_LABELS[tf]}
                       for tf in ("w", "m")},
        "groups": ["ALL", "L", "M", "S", "U", "IDX:NIFTY200"], "minN": 30,
        "events": [{"id": i, "label": lab} for i, lab in PERIOD_EVENTS],
        "label": "Historical, one sample period, current index/cap membership, before costs. Entry at the close of the "
                 "first trading day after the period ends. Not a prediction.",
        "columns": PERIOD_PERF_COLUMNS, "rows": rows,
    }
