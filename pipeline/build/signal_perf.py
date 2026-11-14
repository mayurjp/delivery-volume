"""stats/signal_perf.json (04 section 6): forward excess returns after each delivery event, by cap group.

Reproduces docs/research/scripts/signal_fwd*.py (vectorised: matrices of closes, one groupby median per group x
entry x horizon). Excess = stock forward return minus the median forward return of the same group on the same day
(all liquid stocks in the group with a valid window). Windows crossing a price adjustment are dropped.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import columns as C

HORIZONS = (1, 5, 20)
ENTRIES = ("t1", "t0")  # close(t+1) is the default (data is published after the close); close(t) is the toggle
GROUPS = ("ALL", "L", "M", "S", "U", "IDX:NIFTY200")
MIN_N = 30
EXCLUDED_FLAGS = C.FLAG["lowLiquidity"] | C.FLAG["t2t"] | C.FLAG["etf"]
ADJ_THRESHOLD = 0.03

# F&O and deals combinations arrive with Phases 4/5 (their data is not in the build yet).
EVENTS = [
    ("ACC", "Up on heavy delivery (ACC)"), ("DIS", "Down on heavy delivery (DIS)"),
    ("ABS", "Heavy delivery, flat price (ABS)"), ("SPU", "Up on low delivery (SPU)"),
    ("SPD", "Down on low delivery (SPD)"),
    ("UPSPIKE", "Delivery 2x or more and price up 1% or more"),
    ("DNSPIKE", "Delivery 2x or more and price down 1% or more"),
    ("SPIKE2", "Delivery spike 2x or more (any price move)"),
    ("Z2", "Delivery % 2 standard deviations above its 60-day norm"),
    ("BO_ALL", "New 52-week high (all)"), ("BO_LOW", "New 52-week high on low delivery (spike below 1)"),
    ("BO_HEAVY", "New 52-week high on heavy delivery (spike 2 or more)"),
    ("STREAK5", "Delivery streak reaches 5 days"), ("STREAK5_UP", "Streak reaches 5, price up over 5 days"),
    ("STREAK10", "Delivery streak reaches 10 days"), ("STREAK10_UP", "Streak reaches 10, price up over 5 days"),
]
COLUMNS = ["event", "group", "entry", "horizon", "events", "n", "days", "medianExcess", "meanExcess", "hitRate"]


def event_masks(d: pd.DataFrame, trend5: np.ndarray) -> dict[str, np.ndarray]:
    sig = d["signal"].to_numpy(dtype=object)
    # thresholds are applied to the published (rounded) values, so anyone can reproduce them from daily/*.json
    spike, ret1 = np.round(d["spike"].to_numpy(float), 3), np.round(d["ret1"].to_numpy(float), 2)
    streak = d["streak"].to_numpy(float)
    bo = (d["flags"].to_numpy(np.int64) & C.FLAG["high52"]) != 0
    with np.errstate(invalid="ignore"):
        out = {code: sig == code for code in ("ACC", "DIS", "ABS", "SPU", "SPD")}
        out.update({"UPSPIKE": (spike >= 2) & (ret1 >= 1), "DNSPIKE": (spike >= 2) & (ret1 <= -1),
                    "SPIKE2": spike >= 2,
                    "Z2": np.round(d["delivPctZ60"].to_numpy(float), 3) >= 2, "BO_ALL": bo, "BO_LOW": bo & (spike < 1), "BO_HEAVY": bo & (spike >= 2)})
        for n in (5, 10):
            first = streak == n
            out[f"STREAK{n}"] = first
            out[f"STREAK{n}_UP"] = first & (trend5 > 0)
    return out


def compute(df: pd.DataFrame, days: list[str], uni: pd.DataFrame, n200_bit: int) -> dict:
    """df: every daily row (sym, date, series, close, prevClose, spike, ret1, streak, signal, flags);
    uni: sym, bucket, idx. `days`: ISO trading dates."""
    T = len(days)
    tix = {d: i for i, d in enumerate(days)}
    syms = sorted(df["sym"].unique())
    si = {s: i for i, s in enumerate(syms)}
    ti_all, sj_all = df["date"].map(tix).to_numpy(), df["sym"].map(si).to_numpy()
    close = np.full((T, len(syms)), np.nan)
    prev = np.full((T, len(syms)), np.nan)
    close[ti_all, sj_all] = df["close"].to_numpy(float)
    prev[ti_all, sj_all] = df["prevClose"].to_numpy(float)
    prev_c = np.vstack([np.full((1, len(syms)), np.nan), close[:-1]])
    with np.errstate(invalid="ignore", divide="ignore"):
        adj = np.abs(prev / prev_c - 1) > ADJ_THRESHOLD
    adj_cum = np.cumsum(np.nan_to_num(adj, nan=0).astype(int), axis=0)

    flags = df["flags"].fillna(0).astype(np.int64)
    d = df[((flags & EXCLUDED_FLAGS) == 0) & (df["series"] == "EQ")].reset_index(drop=True)
    ti, sj = d["date"].map(tix).to_numpy(), d["sym"].map(si).to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        tb = np.where(ti >= 5, ti - 5, 0)
        trend5 = np.where(ti >= 5, (close[ti, sj] / close[tb, sj] - 1) * 100, np.nan)
    masks = event_masks(d, trend5)

    ud = uni.set_index("sym")
    bucket = d["sym"].map(ud["bucket"]).to_numpy(dtype=object)
    idx = d["sym"].map(ud["idx"]).fillna(0).to_numpy(np.int64)
    members = {"ALL": np.ones(len(d), bool), "IDX:NIFTY200": (idx >> n200_bit) & 1 == 1,
               **{b: bucket == b for b in ("L", "M", "S", "U")}}

    rows: list[list] = []
    for lag, entry in ((1, "t1"), (0, "t0")):
        for k in HORIZONS:
            tk = ti + lag + k
            ok = tk < T
            a, b = np.where(ok, ti + lag, 0), np.where(ok, tk, 0)
            with np.errstate(invalid="ignore", divide="ignore"):
                r = close[b, sj] / close[a, sj] - 1
            clean = ok & (adj_cum[b, sj] == adj_cum[np.where(ok, ti, 0), sj])
            fwd = np.where(clean, r * 100, np.nan)
            for g in GROUPS:
                m = members[g]
                med = pd.Series(fwd[m]).groupby(ti[m]).median()
                ex = fwd - med.reindex(ti).to_numpy()
                ex[~m] = np.nan
                for eid, _ in EVENTS:
                    em = masks[eid] & m
                    x = ex[em]
                    keep = ~np.isnan(x)
                    n = int(keep.sum())
                    if n == 0:
                        rows.append([eid, g, entry, k, int(em.sum()), 0, 0, None, None, None])
                        continue
                    xv = x[keep]
                    rows.append([eid, g, entry, k, int(em.sum()), n, int(len(np.unique(ti[em][keep]))),
                                 round(float(np.median(xv)), 3), round(float(xv.mean()), 3),
                                 round(float((xv > 0).mean() * 100), 1)])
    return {
        "schemaVersion": 1, "asOf": days[-1], "window": {"from": days[0], "to": days[-1]},
        "horizons": list(HORIZONS), "entries": list(ENTRIES), "groups": list(GROUPS), "minN": MIN_N,
        "events": [{"id": i, "label": lab} for i, lab in EVENTS],
        "label": "Historical, one sample period, current index/cap membership, before costs. Not a prediction.",
        "columns": COLUMNS, "rows": rows,
    }
