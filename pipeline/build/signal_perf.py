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


def adjustment_matrix(close: np.ndarray, prev: np.ndarray) -> np.ndarray:
    """True on a day whose forward windows must be dropped: prevClose(t) differs from close(t-1) by more than 3% (04 section 6)
    OR close(t) / close(t-1) is at most 0.78 or at least 1.8, a one-day move beyond the 20% circuit band. NSE's prevClose
    is RAW on a split/bonus ex-date, so the prevClose rule alone misses almost every split; this also drops the windows
    around a genuine crash of more than 22%, which is the safe direction."""
    prev_c = np.vstack([np.full((1, close.shape[1]), np.nan), close[:-1]])
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = close / prev_c
        return (np.abs(prev / prev_c - 1) > ADJ_THRESHOLD) | (ratio <= 0.78) | (ratio >= 1.8)

# F&O combinations (04 section 6, Phase 5): measured against the F&O-stock benchmark (the median of the eligible F&O stocks
# of the group on the same day, as docs/research/scripts/signal_fwd3.py does for group ALL). Build-up codes: pipeline/fo.py.
FO_EVENTS = [
    ("BU_LB", "Long build-up: price up, open interest up 2% or more"),
    ("BU_SB", "Short build-up: price down, open interest up 2% or more"),
    ("BU_SC", "Short covering: price up, open interest down 2% or more"),
    ("BU_LU", "Long unwinding: price down, open interest down 2% or more"),
    ("ACC_LB", "Heavy delivery up, plus long build-up"),
    ("ACC_SC", "Heavy delivery up, plus short covering"),
    ("DIS_SB", "Heavy delivery down, plus short build-up"),
    ("DIS_LU", "Heavy delivery down, plus long unwinding"),
]
# delivery and price events (the study's own list, Phases 3 and 4 combinations are below)
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
# Named bulk and block deals (Phase 4, 04 section 6): the stock-day's net value via deals per category, round trips
# excluded (pipeline/deals.py flows). Measured against the same all-liquid-stocks benchmark as the delivery events.
DEAL_EVENTS = [
    ("DL_FII_BUY", "FII net bought via deals"), ("DL_FII_SELL", "FII net sold via deals"),
    ("DL_DII_BUY", "DII net bought via deals"), ("DL_DII_SELL", "DII net sold via deals"),
    ("DL_FII_BUY25", "FII bought Rs 25 Cr or more via deals"), ("DL_DII_BUY25", "DII bought Rs 25 Cr or more via deals"),
    ("DL_FII_SELL25", "FII sold Rs 25 Cr or more via deals"), ("DL_DII_SELL25", "DII sold Rs 25 Cr or more via deals"),
    ("DL_BOTH_BUY", "FII and DII both net bought via deals"), ("DL_HANDOVER", "FII sold, DII bought (handover to DII)"),
    ("DL_FII_BUY_DII_SELL", "FII bought, DII sold"),
    ("DL_INST_HEAVY", "FII + DII net bought, delivery 2x or more"),
    ("DL_INST_ACC", "FII + DII net bought, heavy delivery up (ACC)"),
    ("DL_OTHER_BUY", "Other (unclassified) net bought only"),
]


def deal_matrix(flows: pd.DataFrame, category: str, tix: dict, pos: dict, T: int, S: int) -> np.ndarray:
    """(T, S) net value (Rs Cr) via deals of one category; zero where the stock had no deal that day."""
    out = np.zeros((T, S))
    f = flows[flows["category"] == category]
    ti = f["date"].map(tix).to_numpy()
    sj = f["sym"].map(pos).to_numpy()
    keep = ~(pd.isna(ti) | pd.isna(sj))
    np.add.at(out, (ti[keep].astype(np.int64), sj[keep].astype(np.int64)), f["netValueCr"].to_numpy(float)[keep])
    return out


def deal_event_masks(F: np.ndarray, D: np.ndarray, O: np.ndarray, heavy: np.ndarray, acc: np.ndarray) -> dict:
    inst = F + D
    return {
        "DL_FII_BUY": F > 0, "DL_FII_SELL": F < 0, "DL_DII_BUY": D > 0, "DL_DII_SELL": D < 0,
        "DL_FII_BUY25": F >= 25, "DL_DII_BUY25": D >= 25, "DL_FII_SELL25": F <= -25, "DL_DII_SELL25": D <= -25,
        "DL_BOTH_BUY": (F > 0) & (D > 0), "DL_HANDOVER": (F < 0) & (D > 0), "DL_FII_BUY_DII_SELL": (F > 0) & (D < 0),
        "DL_INST_HEAVY": (inst > 0) & heavy, "DL_INST_ACC": (inst > 0) & acc,
        "DL_OTHER_BUY": (O > 0) & (F == 0) & (D == 0),
    }


def fo_event_masks(d: pd.DataFrame, masks: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """The F&O combinations, from the published build-up code (null outside F&O stock-days)."""
    bu = d["buildup"].to_numpy(dtype=object) if "buildup" in d else np.full(len(d), None, dtype=object)
    out = {f"BU_{c}": bu == c for c in ("LB", "SB", "SC", "LU")}
    out.update({"ACC_LB": masks["ACC"] & (bu == "LB"), "ACC_SC": masks["ACC"] & (bu == "SC"),
                "DIS_SB": masks["DIS"] & (bu == "SB"), "DIS_LU": masks["DIS"] & (bu == "LU")})
    return out


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


def compute(df: pd.DataFrame, days: list[str], uni: pd.DataFrame, n200_bit: int,
            flows: pd.DataFrame | None = None) -> dict:
    """df: every daily row (sym, date, series, close, prevClose, spike, ret1, streak, signal, flags);
    uni: sym, bucket, idx. `days`: ISO trading dates. flows: deals/flows (date, sym, category, netValueCr) or None."""
    T = len(days)
    tix = {d: i for i, d in enumerate(days)}
    syms = sorted(df["sym"].unique())
    si = {s: i for i, s in enumerate(syms)}
    ti_all, sj_all = df["date"].map(tix).to_numpy(), df["sym"].map(si).to_numpy()
    close = np.full((T, len(syms)), np.nan)
    prev = np.full((T, len(syms)), np.nan)
    close[ti_all, sj_all] = df["close"].to_numpy(float)
    prev[ti_all, sj_all] = df["prevClose"].to_numpy(float)
    adj = adjustment_matrix(close, prev)
    adj_cum = np.cumsum(np.nan_to_num(adj, nan=0).astype(int), axis=0)

    flags = df["flags"].fillna(0).astype(np.int64)
    d = df[((flags & EXCLUDED_FLAGS) == 0) & (df["series"] == "EQ")].reset_index(drop=True)
    ti, sj = d["date"].map(tix).to_numpy(), d["sym"].map(si).to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        tb = np.where(ti >= 5, ti - 5, 0)
        trend5 = np.where(ti >= 5, (close[ti, sj] / close[tb, sj] - 1) * 100, np.nan)
    masks = event_masks(d, trend5)
    isfo = d["futOi"].notna().to_numpy() if "futOi" in d else np.zeros(len(d), bool)
    masks.update(fo_event_masks(d, masks))
    if flows is not None and len(flows):
        pos = {s_: i for i, s_ in enumerate(syms)}
        mats = {c: deal_matrix(flows, c, tix, pos, T, len(syms)) for c in ("FII", "DII", "Other")}
        F, Dv, O = (mats[c][ti, sj] for c in ("FII", "DII", "Other"))
    else:
        F = Dv = O = np.zeros(len(d))
    heavy = np.round(d["spike"].to_numpy(float), 3) >= 2
    masks.update(deal_event_masks(F, Dv, O, heavy, d["signal"].to_numpy(dtype=object) == "ACC"))

    ud = uni.set_index("sym")
    bucket = d["sym"].map(ud["bucket"]).to_numpy(dtype=object)
    idx = d["sym"].map(ud["idx"]).fillna(0).to_numpy(np.int64)
    members = {"ALL": np.ones(len(d), bool), "IDX:NIFTY200": (idx >> n200_bit) & 1 == 1,
               **{b: bucket == b for b in ("L", "M", "S", "U")}}

    members_fo = {g: m & isfo for g, m in members.items()}  # the F&O-stock benchmark for the F&O combinations
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
                for bench, evs, pool in ((members[g], EVENTS + DEAL_EVENTS, members[g]),
                                         (members_fo[g], FO_EVENTS, members_fo[g])):
                    m = bench
                    med = pd.Series(fwd[m]).groupby(ti[m]).median()
                    ex = fwd - med.reindex(ti).to_numpy()
                    ex[~m] = np.nan
                    for eid, _ in evs:
                        em = masks[eid] & pool
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
        "events": [{"id": i, "label": lab} for i, lab in EVENTS + FO_EVENTS + DEAL_EVENTS],
        "label": "Historical, one sample period, current index/cap membership, before costs. Not a prediction.",
        "columns": COLUMNS, "rows": rows,
    }
