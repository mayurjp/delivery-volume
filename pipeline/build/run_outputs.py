"""Run forensics in `build` (docs/specs/07-run-forensics.md sections 2, 4, 5): the runs of every stock in symbols/{f}.json
(`runs`, `runSummary`, `resultsDates`), runs/library.json and stats/run_footprints.json. Pure: reads the grids built
from the store, the holdings, deal flows and board meetings the build already has."""

from __future__ import annotations

import bisect
import math
from pathlib import Path

import numpy as np
import pandas as pd

from .. import runs as R
from ..runs import (
    BUILD_CODES,
    DEAL_CATS,
    EXTRA_COLS,
    HOLD_FIELDS,
    LIBRARY_COLS,
    MIN_RUNS_PER_DIRECTION,
    PRE_COLS,
    RUN_COLS,
    SUMMARY_COLS,
)
from . import signal_perf
from .schema import validate

INT_COLS = {"days", "results", "corpActions", "circuits", "runs", *[f"build{c}" for c in BUILD_CODES]}
TEXT_COLS = {"dir", "start", "end", "sym", "bucket", "sector", "group", "enough"}


def _cell(col: str, v):
    """One JSON cell: text as is, counts as integers, numbers rounded (2 dp for percentages and rupee values, 3 dp for
    ratios), NaN and infinity as null."""
    if col in TEXT_COLS:
        return v
    if v is None:
        return None
    if col in INT_COLS or col.endswith("SpikeDays"):
        return None if (isinstance(v, float) and not math.isfinite(v)) else int(v)
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    dp = 2 if (col.endswith(("Pct", "Pp")) or col.startswith(("deals", "hold")) or col == "movePct") else 3
    return round(x, dp)


def _table(df: pd.DataFrame, cols: list[str]) -> list[list]:
    vals = [df[c].to_numpy(dtype=object) for c in cols]
    return [[_cell(c, vals[k][i]) for k, c in enumerate(cols)] for i in range(len(df))]


def holdings_change(rows: list[list], cols: list[str], pivot_day: str, end: str) -> dict:
    """holdChgPp for one run (07 section 2): from the latest quarter that ends before the pivot and was broadcast by the
    pivot day, to the first quarter ending after the run's end, when that quarter is filed. Null when either is not
    stored. The base uses the broadcast date, so no filing enters before it was public."""
    out = {k: None for k in ("promoterPct", "fiiPct", "mfPct", "diiPct")}
    if not rows:
        return out
    qi, fi = cols.index("quarter"), cols.index("filedOn")
    before = None
    after_q = None
    for r in sorted(rows, key=lambda x: x[qi]):
        q, filed = r[qi], r[fi]
        if q < pivot_day and filed and filed <= pivot_day:
            before = r
        if after_q is None and q > end:
            after_q = r
    if before is None or after_q is None or not after_q[fi]:
        return out
    for k in out:
        ci = cols.index(k)
        if before[ci] is not None and after_q[ci] is not None:
            out[k] = float(after_q[ci]) - float(before[ci])
    return out


def _deal_mats(flows: pd.DataFrame | None, days: list[str], syms: list[str]) -> dict:
    tix = {d: i for i, d in enumerate(days)}
    pos = {s: i for i, s in enumerate(syms)}
    T, S = len(days), len(syms)
    if flows is None or not len(flows):
        return {c: np.zeros((T, S)) for c in DEAL_CATS}
    return {c: signal_perf.deal_matrix(flows, c, tix, pos, T, S) for c in DEAL_CATS}


def run_extras(g: R.Grids, runs: pd.DataFrame, days: list[str], corp: pd.DataFrame, results: dict,
               hold_by_sym: dict, deal_mats: dict, deals_first: str | None) -> pd.DataFrame:
    """The EXTRA_COLS of every run: events (results dates, corporate actions, circuits), holdChgPp, the F&O open-interest
    change and build-up days over the pre window, and the deal flows (pre and full windows, round trips excluded)."""
    corp_dates: dict[str, list[str]] = {}
    if len(corp):
        for sym, grp in corp.groupby("sym"):
            corp_dates[sym] = sorted(grp["exDate"].tolist())
    rows = []
    for r in runs.itertuples(index=False):
        j, s, e = int(r.j), int(r.s), int(r.e)
        sym = g.syms[j]
        pre_lo = max(s - R.PRE_DAYS + 1, 0)
        d_pre, d_piv, d_end = days[pre_lo], days[s], days[e]
        rd = results.get(sym, [])
        cd = corp_dates.get(sym, [])
        out = {
            "results": bisect.bisect_right(rd, d_end) - bisect.bisect_left(rd, d_pre),
            "corpActions": bisect.bisect_right(cd, d_end) - bisect.bisect_left(cd, d_pre),
            "circuits": int(g.band[s:e + 1, j].sum()),
        }
        hc = holdings_change(*hold_by_sym.get(sym, ([], [])), pivot_day=d_piv, end=d_end)
        for col, field in HOLD_FIELDS.items():
            out[col] = hc[field]
        oi = g.fo_oi[:, j]
        base_i = s - R.PRE_DAYS
        if base_i >= 0 and np.isfinite(oi[s]) and np.isfinite(oi[base_i]) and oi[base_i] > 0:
            out["futOiChgPct"] = (oi[s] / oi[base_i] - 1) * 100
        else:
            out["futOiChgPct"] = None
        bu = g.fo_bu[pre_lo:s + 1, j]
        has_fo = any(x is not None for x in bu)
        for c in BUILD_CODES:
            out[f"build{c}"] = int(sum(1 for x in bu if x == c)) if has_fo else None
        for cat in DEAL_CATS:
            m = deal_mats[cat]
            out[f"dealsPre{cat}"] = float(m[pre_lo:s + 1, j].sum()) if deals_first and d_pre >= deals_first else None
            out[f"dealsFull{cat}"] = float(m[s:e + 1, j].sum()) if deals_first and d_piv >= deals_first else None
        rows.append(out)
    return pd.DataFrame(rows, index=runs.index, columns=EXTRA_COLS)


def _summary_rows(sel_runs: pd.DataFrame, pre_ok: np.ndarray, pre_feats: dict) -> list[list]:
    """runSummary rows for one stock: UP runs, DOWN runs and ordinary days (the medians of the pre-window features)."""
    rows = []
    for grp in ("UP", "DOWN", "ORDINARY"):
        if grp == "ORDINARY":
            n = int(pre_ok.sum())
            enough = n > 0
            vals = [float(np.nanmedian(pre_feats[f][pre_ok])) if n and np.isfinite(pre_feats[f][pre_ok]).any() else None
                    for f in R.FEATURES]
        else:
            part = sel_runs[sel_runs["dir"] == grp]
            n = int(len(part))
            enough = n >= MIN_RUNS_PER_DIRECTION
            vals = []
            for col in PRE_COLS:
                x = part[col].to_numpy(float) if n else np.empty(0)
                x = x[np.isfinite(x)]
                vals.append(float(np.median(x)) if enough and len(x) else None)
        rows.append([grp, n, enough, *[_cell(c, v) for c, v in zip(PRE_COLS, vals)]])
    return rows


def build_run_outputs(df: pd.DataFrame, days: list[str], uni: pd.DataFrame, settings: dict, corp: pd.DataFrame,
                      results: dict, hold_by_sym: dict, flows: pd.DataFrame | None, deals_first: str | None,
                      asof: str) -> dict:
    """{'sym': {sym: {runs, runSummary, resultsDates}}, 'library': doc, 'stats': doc, 'counts': {...}} for 5B."""
    cfg = R.run_cfg(settings)
    ud = uni.set_index("sym")
    stocks = [s for s in uni["sym"] if not bool(ud.loc[s, "etf"])]
    bucket = {s: (ud.loc[s, "bucket"] if isinstance(ud.loc[s, "bucket"], str) else None) for s in stocks}
    sector = {s: ud.loc[s, "sector"] for s in stocks}
    rank = [ud.loc[s, "mcapRank"] for s in stocks]
    uni_mask = np.array([pd.notna(m) and m <= R.STUDY_TOP_N for m in rank], dtype=bool)
    bucket_of = np.array([bucket[s] for s in stocks], dtype=object)
    g = R.build_grids(df, days, stocks, settings.get("notSplits", []))
    runs = R.run_rows(g, R.detect_runs(g, cfg), cfg)
    day = R.day_features(g)
    long = R.long_features(g)
    extras = run_extras(g, runs, days, corp, results, hold_by_sym, _deal_mats(flows, days, g.syms), deals_first)
    runs = pd.concat([runs, extras], axis=1)
    runs["bucket"] = [bucket_of[j] for j in runs["j"]]
    runs["sector"] = [sector[g.syms[j]] for j in runs["j"]]
    runs["dir"] = runs["dir"].astype(object)
    runs = runs.sort_values(["j", "s"], kind="stable")
    per_sym: dict[str, dict] = {}
    by_j = {j: part for j, part in runs.groupby("j", sort=False)}
    for j, sym in enumerate(g.syms):
        part = by_j.get(j)
        rows = _table(part, RUN_COLS) if part is not None else []
        pre_ok = day["okPre"][:, j]
        pre_feats = {f: day["pre"][f][:, j] for f in R.FEATURES}
        per_sym[sym] = {
            "runs": {"columns": RUN_COLS, "rows": rows},
            "runSummary": {"columns": SUMMARY_COLS, "rows": _summary_rows(
                part if part is not None else runs.iloc[0:0], pre_ok, pre_feats)},
            "resultsDates": results.get(sym, []),
        }
    lib = runs.sort_values(["start", "sym"], kind="stable")
    lib_doc = {"schemaVersion": 1, "asOf": asof, "bigMovePct": cfg["bigMovePct"], "minMovePct": cfg["minMovePct"],
               "reversalPct": cfg["reversalPct"], "minDays": cfg["minDays"],
               "universe": "non-ETF EQ stocks in the universe", "columns": LIBRARY_COLS,
               "rows": _table(lib, LIBRARY_COLS)}
    stats = R.run_stats(g, runs, day, uni_mask, bucket_of, cfg, long, asof)
    stats["schemaVersion"] = 1
    counts = {"stocks": len(stocks), "runs": int(len(runs)), "studyUniverse": int(uni_mask.sum()),
              "up": int((runs["dir"] == "UP").sum()), "down": int((runs["dir"] == "DOWN").sum())}
    return {"sym": per_sym, "library": lib_doc, "stats": stats, "counts": counts}


def write_library_and_stats(res: dict, out: Path, dump) -> dict:
    """Validates and writes runs/library.json and stats/run_footprints.json; returns the bytes written."""
    validate("runs_library", res["library"])
    n_lib = dump(out / "runs" / "library.json", res["library"])
    validate("run_footprints", res["stats"])
    n_stats = dump(out / "stats" / "run_footprints.json", res["stats"])
    return {"library": n_lib, "stats": n_stats}
