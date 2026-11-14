"""Run forensics (docs/specs/07-run-forensics.md sections 1, 2, 4 and 5): zig-zag runs on adjusted close and the footprint
features around them, plus the statistics (medians, lift tables, the long-horizon version).

Vectorised over stocks: one Python loop over the trading days, numpy across every stock at once (the zig-zag), and
prefix sums for the windows (the features). The definitions are those of docs/research/scripts/run_footprints.py, which
the slow test reproduces. Prices are adjusted with metrics.price_adjustment (DEVIATIONS #52, #71), never with the
prevClose rule of 04 section 6.

Windows, for a pivot at index s (the 20 days ending at s is `pre`; the 60 days before pre are `base`):
  pre [s-19, s], early [s+1, s+5], full [s, e], post [e+1, e+20]; every window is compared with base [s-79, s-20].
Windows are dropped (null) when they hold too few valid delivery days, or when the base turnover is below 2 Rs Cr.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import metrics

DEFAULT_RUNS = {"reversalPct": 12, "minMovePct": 20, "minDays": 5, "bigMovePct": 15}
BASE_DAYS, PRE_DAYS, EARLY_DAYS, POST_DAYS = 60, 20, 5, 20
MIN_HISTORY_DAYS = 150
LONG_DAYS, LONG_FWD = 60, (60, 120)
FEATURES = ["delivValRatio", "delivPctChgPp", "turnoverRatio", "tradeSizeRatio", "delivBalance", "spikeDays",
            "priceChgPct"]
WINDOWS = ["pre", "early", "full", "post"]
BUCKETS = ["L", "M", "S", "U"]

# ---- output columns (07 sections 4 and 5; shared by the build and the schemas) --------------------------------------
BUILD_CODES = ("LB", "SB", "SC", "LU")
DEAL_CATS = ("FII", "DII", "Other")
HOLD_FIELDS = {"holdFiiPp": "fiiPct", "holdDiiPp": "diiPct", "holdMfPp": "mfPct", "holdPromoterPp": "promoterPct"}
RUN_BASE_COLS = ["dir", "start", "end", "movePct", "days"]
WINDOW_COLS = [f"{w}{f[0].upper()}{f[1:]}" for w in WINDOWS for f in FEATURES]
EXTRA_COLS = (["results", "corpActions", "circuits", *HOLD_FIELDS, "futOiChgPct", *[f"build{c}" for c in BUILD_CODES]]
              + [f"dealsPre{c}" for c in DEAL_CATS] + [f"dealsFull{c}" for c in DEAL_CATS])
RUN_COLS = RUN_BASE_COLS + WINDOW_COLS + EXTRA_COLS
PRE_COLS = [f"pre{f[0].upper()}{f[1:]}" for f in FEATURES]
SUMMARY_COLS = ["group", "runs", "enough", *PRE_COLS]
LIBRARY_COLS = ["sym", "dir", "start", "end", "movePct", "days", "bucket", "sector", "preDelivValRatio",
                "preDelivPctChgPp", "preTurnoverRatio", "preTradeSizeRatio", "preDelivBalance", "preSpikeDays",
                "prePriceChgPct", "earlyDelivValRatio", "earlyDelivBalance"]
MIN_RUNS_PER_DIRECTION = 3  # 07 section 4: "not enough runs yet" below this
STUDY_TOP_N = 750  # the study universe: the top 750 by current market cap (DEVIATIONS #139)


def run_cfg(settings: dict | None) -> dict:
    return {**DEFAULT_RUNS, **((settings or {}).get("runs") or {})}


# ---- grids ---------------------------------------------------------------------------------------------------------

@dataclass
class Grids:
    """Days x stocks matrices for one universe. `syms` are the column order; `days` the ISO trading dates."""

    days: list[str]
    syms: list[str]
    adj: np.ndarray            # adjusted close, forward-filled over non-trading days (NaN before the first trade)
    trade: np.ndarray          # bool: an EQ row exists that day
    valid: np.ndarray          # bool: valid delivery day (EQ, delivery and turnover present, turnover > 0)
    up: np.ndarray             # bool: valid day with adjusted return > 0
    dn: np.ndarray             # bool: valid day with adjusted return < 0
    spk: np.ndarray            # bool: delivery at least 2x the mean of the prior 20 valid days (study rule)
    dv: np.ndarray             # delivery value Rs Cr (0 where not valid)
    tv: np.ndarray             # turnover Rs Cr (0 where not valid)
    ats: np.ndarray            # turnover / trades, Rs per trade (0 where not valid)
    deliv_pct: np.ndarray      # delivery % of the day (NaN where not valid)
    fo_oi: np.ndarray          # futures open interest (NaN where no F&O row)
    fo_bu: np.ndarray          # build-up code (object, None where none)
    band: np.ndarray           # bool: price band hit that day (flag bit 16)
    prefix: dict = field(default_factory=dict)

    @property
    def T(self) -> int:
        return len(self.days)

    @property
    def S(self) -> int:
        return len(self.syms)


def _to_grid(ti: np.ndarray, sj: np.ndarray, vals: np.ndarray, T: int, S: int, dtype=float, fill=np.nan) -> np.ndarray:
    out = np.full((T, S), fill, dtype=dtype)
    out[ti, sj] = vals
    return out


def build_grids(df: pd.DataFrame, days: list[str], syms: list[str], not_splits=None) -> Grids:
    """df: daily rows (sym, date, series, close, delivQty, delivValCr, turnoverCr, trades, flags, optionally futOi and
    buildup). Only the EQ rows of `syms` enter the grids; the adjustment factor is computed from the same EQ rows."""
    T, S = len(days), len(syms)
    tix = {d: i for i, d in enumerate(days)}
    sidx = {s: j for j, s in enumerate(syms)}
    eq = df[(df["series"] == "EQ") & df["sym"].isin(sidx)].sort_values(["sym", "date"], kind="stable")
    ti = eq["date"].map(tix).to_numpy()
    sj = eq["sym"].map(sidx).to_numpy()
    keep = ~pd.isna(ti)
    eq, ti, sj = eq[keep], ti[keep].astype(np.int64), sj[keep].astype(np.int64)
    close = eq["close"].to_numpy(dtype=float)
    # demergers_adjust: a listed demerger (notSplits) is not a market move for a run (DEVIATIONS #168)
    a = metrics.price_adjustment(eq["sym"].to_numpy(dtype=object), close, eq["date"].to_numpy(dtype=object),
                                 not_splits or [], demergers_adjust=True)
    adj_row = close * a
    raw_adj = _to_grid(ti, sj, adj_row, T, S)
    adj = pd.DataFrame(raw_adj).ffill().to_numpy()
    trade = _to_grid(ti, sj, True, T, S, dtype=bool, fill=False)
    dq = eq["delivQty"].to_numpy(dtype=float)
    dv_row = eq["delivValCr"].to_numpy(dtype=float)
    tv_row = eq["turnoverCr"].to_numpy(dtype=float)
    tr_row = eq["trades"].to_numpy(dtype=float)
    valid_row = np.isfinite(dv_row) & np.isfinite(tv_row) & (tv_row > 0) & np.isfinite(dq) & (tr_row > 0)
    valid = _to_grid(ti, sj, valid_row, T, S, dtype=bool, fill=False)
    dv = np.where(valid, _to_grid(ti, sj, np.nan_to_num(dv_row), T, S), 0.0)
    tv = np.where(valid, _to_grid(ti, sj, np.nan_to_num(tv_row), T, S), 0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        ats_row = tv_row * 1e7 / tr_row
    ats = np.where(valid, _to_grid(ti, sj, np.nan_to_num(ats_row), T, S), 0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        deliv_pct_row = np.where(tv_row > 0, dv_row / tv_row * 100, np.nan)
    deliv_pct = _to_grid(ti, sj, deliv_pct_row, T, S)
    deliv_pct = np.where(valid, deliv_pct, np.nan)
    # adjusted daily return on the traded days (study: ret = adj(t)/adj(t-1) - 1 where the stock traded on day t)
    with np.errstate(invalid="ignore", divide="ignore"):
        ret = np.full((T, S), np.nan)
        ret[1:] = adj[1:] / adj[:-1] - 1
    ret = np.where(trade, ret, np.nan)
    rn = np.nan_to_num(ret)
    up = valid & (rn > 0)
    dn = valid & (rn < 0)
    dv_pos = dv  # zero on invalid days, as the study's z()
    m20 = np.full((T, S), np.nan)
    cs_dv = np.vstack([np.zeros((1, S)), np.cumsum(dv_pos, axis=0)])
    cs_n = np.vstack([np.zeros((1, S)), np.cumsum(valid.astype(float), axis=0)])
    if T > 20:
        m20[20:] = (cs_dv[20:T] - cs_dv[0:T - 20]) / np.maximum(cs_n[20:T] - cs_n[0:T - 20], 1)
    with np.errstate(invalid="ignore"):
        spk = np.zeros((T, S), dtype=bool)
        spk[20:] = (dv_pos[20:] >= 2 * m20[20:]) & (m20[20:] > 0)
    fo_oi = _to_grid(ti, sj, eq["futOi"].to_numpy(float) if "futOi" in eq else np.nan, T, S)
    bu = np.full((T, S), None, dtype=object)
    if "buildup" in eq:
        bu_vals = eq["buildup"].to_numpy(dtype=object)
        bu[ti, sj] = bu_vals
    flags = eq["flags"].fillna(0).to_numpy(np.int64) if "flags" in eq else np.zeros(len(eq), np.int64)
    band = _to_grid(ti, sj, (flags & 16) != 0, T, S, dtype=bool, fill=False)
    g = Grids(days=days, syms=syms, adj=adj, trade=trade, valid=valid, up=up, dn=dn, spk=spk, dv=dv, tv=tv, ats=ats,
              deliv_pct=deliv_pct, fo_oi=fo_oi, fo_bu=bu, band=band)
    g.prefix = {
        "n": np.vstack([np.zeros((1, S)), np.cumsum(valid.astype(float), axis=0)]),
        "dv": np.vstack([np.zeros((1, S)), np.cumsum(dv, axis=0)]),
        "tv": np.vstack([np.zeros((1, S)), np.cumsum(tv, axis=0)]),
        "ats": np.vstack([np.zeros((1, S)), np.cumsum(ats, axis=0)]),
        "up": np.vstack([np.zeros((1, S)), np.cumsum(np.where(up, dv, 0.0), axis=0)]),
        "dn": np.vstack([np.zeros((1, S)), np.cumsum(np.where(dn, dv, 0.0), axis=0)]),
        "spk": np.vstack([np.zeros((1, S)), np.cumsum(spk.astype(float), axis=0)]),
    }
    return g


# ---- zig-zag -------------------------------------------------------------------------------------------------------

def zigzag(adj: np.ndarray, rev: float) -> tuple[np.ndarray, np.ndarray]:
    """Zig-zag pivots for every column at once (the same state machine as docs/research/scripts/run_footprints.py).

    Returns (stock, day) arrays of pivots in time order per stock: the first valid day, every reversal extreme, and the
    last extreme. Up and down legs alternate; a leg starts after 1 +/- rev from the last extreme."""
    T, S = adj.shape
    fin = np.isfinite(adj)
    started = np.zeros(S, bool)
    d = np.zeros(S, np.int8)
    ext_t = np.full(S, -1, dtype=np.int64)
    ext_p = np.full(S, np.nan)
    p0 = np.full(S, np.nan)
    ps, pt = [], []
    up_r, dn_r = 1.0 + rev, 1.0 - rev
    for t in range(T):
        p, f = adj[t], fin[t]
        if not f.any():
            continue
        new = f & ~started
        if new.any():
            started |= new
            p0[new] = p[new]
            ext_p[new] = p[new]
            ext_t[new] = t
            ns = np.flatnonzero(new)
            ps.append(ns)
            pt.append(np.full(len(ns), t, dtype=np.int64))
        act = f & started & ~new
        z = act & (d == 0)
        trig_up = z & (p >= p0 * up_r)
        trig_dn = z & ~trig_up & (p <= p0 * dn_r)
        trig = trig_up | trig_dn
        d[trig_up] = 1
        d[trig_dn] = -1
        ext_t[trig] = t
        ext_p[trig] = p[trig]
        tr = act & ~z
        u = tr & (d == 1)
        upd = u & (p >= ext_p)
        ext_t[upd] = t
        ext_p[upd] = p[upd]
        rv = u & (p <= ext_p * dn_r)
        ri = np.flatnonzero(rv)
        if len(ri):
            ps.append(ri)
            pt.append(ext_t[ri].copy())
        d[rv] = -1
        ext_t[rv] = t
        ext_p[rv] = p[rv]
        w = tr & (d == -1) & ~rv
        dupd = w & (p <= ext_p)
        ext_t[dupd] = t
        ext_p[dupd] = p[dupd]
        rv2 = w & (p >= ext_p * up_r)
        ri2 = np.flatnonzero(rv2)
        if len(ri2):
            ps.append(ri2)
            pt.append(ext_t[ri2].copy())
        d[rv2] = 1
        ext_t[rv2] = t
        ext_p[rv2] = p[rv2]
    fs = np.flatnonzero(started)
    ps.append(fs)
    pt.append(ext_t[fs].copy())
    s_all = np.concatenate(ps) if ps else np.empty(0, np.int64)
    t_all = np.concatenate(pt) if pt else np.empty(0, np.int64)
    # the start pivot is emitted before the reversal pivots of the same stock, and the final extreme last: a stable
    # sort by stock keeps the time order of each stock's pivots
    order = np.argsort(s_all, kind="stable")
    return s_all[order], t_all[order]


def detect_runs(g: Grids, cfg: dict) -> pd.DataFrame:
    """Runs (07 section 1): legs of the zig-zag with |move| >= minMovePct and >= minDays, with the window bounds
    (s >= 79 so the base exists, s + 5 < T so the early window exists)."""
    rev = cfg["reversalPct"] / 100.0
    s_all, t_all = zigzag(g.adj, rev)
    T = g.T
    same = np.zeros(len(s_all), bool)
    same[:-1] = s_all[:-1] == s_all[1:]
    a_idx = np.flatnonzero(same)
    j = s_all[a_idx]
    st = t_all[a_idx]
    en = t_all[a_idx + 1]
    p_a = g.adj[st, j]
    p_b = g.adj[en, j]
    with np.errstate(invalid="ignore", divide="ignore"):
        mv = p_b / p_a - 1
    first = BASE_DAYS + PRE_DAYS - 1  # the pre window and its base exist from this day on (study: s >= 79)
    # a stock needs MIN_HISTORY_DAYS of prices to have runs at all (the study's rule, DEVIATIONS #139)
    enough = np.isfinite(g.adj).sum(axis=0) >= MIN_HISTORY_DAYS
    ok = (np.abs(mv) >= cfg["minMovePct"] / 100.0) & (en - st >= cfg["minDays"]) & (st >= first) & \
        (st + EARLY_DAYS < T) & np.isfinite(mv) & enough[j]
    out = pd.DataFrame({"j": j[ok], "s": st[ok], "e": en[ok], "move": mv[ok] * 100})
    out["dir"] = np.where(out["move"] > 0, "UP", "DOWN")
    out["days"] = (out["e"] - out["s"]).astype(int)
    out["sym"] = [g.syms[k] for k in out["j"]]
    out["movePct"] = out["move"]
    out["start"] = [g.days[i] for i in out["s"]]
    out["end"] = [g.days[i] for i in out["e"]]
    return out.reset_index(drop=True)


# ---- windows and features ------------------------------------------------------------------------------------------

def _shift_prefix(P: np.ndarray, k: int, T: int) -> np.ndarray:
    """Y[t] = P[t + k] for t in 0..T-1 (NaN outside), P has T+1 rows."""
    S = P.shape[1]
    out = np.full((T, S), np.nan)
    lo, hi = max(0, -k), min(T, T + 1 - k)
    if hi > lo:
        out[lo:hi] = P[lo + k:hi + k]
    return out


def _shift_adj(adj: np.ndarray, k: int, T: int) -> np.ndarray:
    S = adj.shape[1]
    out = np.full((T, S), np.nan)
    lo, hi = max(0, -k), min(T, T - k)
    if hi > lo:
        out[lo:hi] = adj[lo + k:hi + k]
    return out


def window2d(g: Grids, lo: int, hi: int) -> dict:
    """Sums over the window [t+lo, t+hi] for every day t (NaN where the window leaves the store)."""
    T = g.T
    out = {}
    for key, P in g.prefix.items():
        out[key] = _shift_prefix(P, hi + 1, T) - _shift_prefix(P, lo, T)
    out["pc_adj"] = _shift_adj(g.adj, hi, T) / _shift_adj(g.adj, lo - 1, T)
    return out


def window_pairs(g: Grids, s: np.ndarray, j: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> dict:
    """Window sums for pairs (stock j, window [s+lo, s+hi] with per-pair offsets), NaN where out of range."""
    T = g.T
    a = s + lo
    b = s + hi
    ok = (a >= 0) & (b <= T - 1) & (a - 1 >= 0)
    a2 = np.clip(a, 0, T)
    b1 = np.clip(b + 1, 0, T)
    out = {}
    for key, P in g.prefix.items():
        v = P[b1, j] - P[a2, j]
        out[key] = np.where(ok, v, np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        pc = g.adj[np.clip(b, 0, T - 1), j] / g.adj[np.clip(a - 1, 0, T - 1), j]
    out["pc_adj"] = np.where(ok, pc, np.nan)
    return out


def features(w1: dict, w0: dict, min1: int, min0: int) -> tuple[dict, np.ndarray]:
    """The seven footprint features of a window against its base (study definitions) and the validity mask."""
    n1, n0 = w1["n"], w0["n"]
    with np.errstate(invalid="ignore", divide="ignore"):
        dv1 = w1["dv"] / np.maximum(n1, 1)
        dv0 = w0["dv"] / np.maximum(n0, 1)
        tv1 = w1["tv"] / np.maximum(n1, 1)
        tv0 = w0["tv"] / np.maximum(n0, 1)
        f = {
            "delivValRatio": dv1 / dv0,
            "delivPctChgPp": (w1["dv"] / w1["tv"] - w0["dv"] / w0["tv"]) * 100,
            "turnoverRatio": tv1 / tv0,
            "tradeSizeRatio": (w1["ats"] / np.maximum(n1, 1)) / (w0["ats"] / np.maximum(n0, 1)),
            "delivBalance": w1["up"] / np.maximum(w1["dn"], 1e-9),
            "spikeDays": w1["spk"],
            "priceChgPct": (w1["pc_adj"] - 1) * 100,
        }
        ok = (n1 >= min1) & (n0 >= min0) & (tv0 >= 2.0) & (dv0 > 0)
    return {k: np.where(ok, v, np.nan) for k, v in f.items()}, ok


def day_features(g: Grids) -> dict:
    """Features for every (day, stock) with the pre window ending that day (lift and ordinary days), plus the early
    window's features for the same pivot (early = [t+1, t+5])."""
    base = window2d(g, -(BASE_DAYS + PRE_DAYS - 1), -PRE_DAYS)
    pre = window2d(g, -(PRE_DAYS - 1), 0)
    early = window2d(g, 1, EARLY_DAYS)
    fpre, okpre = features(pre, base, 15, 45)
    fearly, _ = features(early, base, 4, 45)
    return {"pre": fpre, "early": fearly, "okPre": okpre, "base": base}


def long_features(g: Grids) -> dict:
    """60-day features (window [t-59, t] vs [t-119, t-60]) for the long-horizon lift."""
    base = window2d(g, -(BASE_DAYS + LONG_DAYS - 1), -LONG_DAYS)
    w = window2d(g, -(LONG_DAYS - 1), 0)
    f, ok = features(w, base, 45, 45)
    return {"f": f, "ok": ok}


def run_rows(g: Grids, runs: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """Per-run columns (07 section 4): the pre, early, full and post features against the base (the 60 days before pre)."""
    j, s, e = runs["j"].to_numpy(), runs["s"].to_numpy(), runs["e"].to_numpy()
    n = len(j)
    zeros = np.zeros(n, dtype=np.int64)
    w0 = window_pairs(g, s, j, np.full(n, -(BASE_DAYS + PRE_DAYS - 1)), np.full(n, -PRE_DAYS))
    windows = {
        "pre": (window_pairs(g, s, j, np.full(n, -(PRE_DAYS - 1)), zeros), 15),
        "early": (window_pairs(g, s, j, np.full(n, 1), np.full(n, EARLY_DAYS)), 4),
        "full": (window_pairs(g, s, j, zeros, e - s), 4),
        "post": (window_pairs(g, e, j, np.full(n, 1), np.full(n, POST_DAYS)), 15),
    }
    # a run needs its pre window and base to be valid (the study's rule, DEVIATIONS #139): a stock's first days, with no
    # 60-day base, make no run; the other windows that are not covered are null
    pre_f, pre_ok = features(windows["pre"][0], w0, windows["pre"][1], 45)
    keep = pre_ok
    out = runs[keep].copy()
    for name, (w1, min1) in windows.items():
        f, _ = features(w1, w0, min1, 45)
        for k, v in f.items():
            out[f"{name}{k[0].upper()}{k[1:]}"] = v[keep]
    return out.reset_index(drop=True)


# ---- statistics ----------------------------------------------------------------------------------------------------

def _median(x: np.ndarray) -> float | None:
    x = x[np.isfinite(x)]
    return round(float(np.median(x)), 2) if len(x) else None


def lift_table(feat: dict, fwd: np.ndarray, big: float, mask: np.ndarray, horizon_label: int) -> tuple[list, dict]:
    """Quintile table (Q1 lowest) of P(big up) and P(big down) per feature, from aligned arrays over the masked
    stock-days. fwd is the forward return in percent (entry close(t+1)); drops rows with any NaN (study dropna)."""
    names = list(feat.keys())
    mat = np.column_stack([feat[k][mask] for k in names] + [fwd[mask]])
    mat = mat[np.all(np.isfinite(mat), axis=1)]
    fw = mat[:, -1]
    if len(fw) < 5 * 2:  # too few stock-days for quintiles: no table, and no rates (never NaN in the JSON)
        return [], {"n": int(len(fw)), "bigUpPct": None, "bigDownPct": None}
    base_up = float((fw >= big).mean() * 100)
    base_dn = float((fw <= -big).mean() * 100)
    rows = []
    for c, k in enumerate(names):
        x = mat[:, c]
        q = pd.qcut(pd.Series(x).rank(method="first"), 5, labels=False).to_numpy()
        for qi in range(5):
            sel = q == qi
            if not sel.any():
                continue
            rows.append([horizon_label, k, qi + 1, int(sel.sum()), round(float((fw[sel] >= big).mean() * 100), 2),
                         round(float((fw[sel] <= -big).mean() * 100), 2)])
    return rows, {"n": int(len(fw)), "bigUpPct": round(base_up, 2), "bigDownPct": round(base_dn, 2)}


def forward_return(adj: np.ndarray, t: np.ndarray | int, h: int) -> np.ndarray:
    """Return in percent from close(t+1) to close(t+1+h) on the adjusted series: the entry is the close AFTER the
    feature day (no hindsight, 07 section 5). NaN where the window runs past the store."""
    t = np.asarray(t)
    T = adj.shape[0]
    out = np.full(adj.shape, np.nan)
    ok = t + 1 + h < T
    tt = t[ok] if t.ndim else t
    with np.errstate(invalid="ignore", divide="ignore"):
        out[tt] = (adj[tt + 1 + h] / adj[tt + 1] - 1) * 100
    return out


def run_stats(g: Grids, runs: pd.DataFrame, day: dict, uni_mask: np.ndarray, bucket_of: np.ndarray, cfg: dict,
              long: dict, asof: str) -> dict:
    """stats/run_footprints.json: medians by window x direction vs ordinary (overall and by bucket), the lift tables for
    the 20-day horizon, and the 60-day-feature version for the next 60 and 120 days (no hindsight)."""
    T = g.T
    big = cfg["bigMovePct"]
    feat20 = day["pre"]
    ok = day["okPre"]
    # ordinary: every 3rd day (the study's baseline sampling), stocks in the study universe
    samp = np.arange(79, T - 20, 3)
    ordinary = {}
    for f in FEATURES:
        x = feat20[f][samp][:, uni_mask][ok[samp][:, uni_mask]]
        ordinary[f] = x
    bucket_cells = bucket_of
    # run medians: runs of the study universe
    rr = runs[uni_mask[runs["j"].to_numpy()]].copy() if len(runs) else runs
    rr["bucket"] = bucket_cells[rr["j"].to_numpy()] if len(rr) else []
    ord_all = {f: np.concatenate([feat20[f][samp][:, uni_mask][ok[samp][:, uni_mask]]]) for f in FEATURES}
    ord_bucket = np.concatenate([np.broadcast_to(bucket_cells[uni_mask], (len(samp), int(uni_mask.sum())))[ok[samp][:, uni_mask]]])
    med = []
    for win in ("pre", "early", "full", "post"):
        for d in ("UP", "DOWN"):
            sel = rr["dir"].to_numpy() == d if len(rr) else np.empty(0, bool)
            for b in ["ALL", *BUCKETS]:
                m = sel if b == "ALL" else sel & (rr["bucket"].to_numpy() == b if len(rr) else False)
                for f in FEATURES:
                    col = f"{win}{f[0].upper()}{f[1:]}"
                    x = rr.loc[m, col].to_numpy(float) if len(rr) and col in rr else np.empty(0)
                    med.append([win, d, b, f, _median(x), int(np.isfinite(x).sum())])
    for b in ["ALL", *BUCKETS]:
        for f in FEATURES:
            x = ord_all[f] if b == "ALL" else ord_all[f][ord_bucket == b]
            med.append(["pre", "ORDINARY", b, f, _median(x), int(np.isfinite(x).sum())])

    # lift, 20 days (no hindsight): features at t, entry close(t+1), exit close(t+21)
    sel_days = np.arange(BASE_DAYS + PRE_DAYS - 1, T - 21)
    fwd = forward_return(g.adj, sel_days, 20)
    feat_t = {f: feat20[f][sel_days] for f in FEATURES}
    fwd_t = fwd[sel_days]
    mask_t = ok[sel_days] & uni_mask[None, :]
    lift_rows, lift_base = lift_table(
        {f: feat_t[f] for f in FEATURES}, fwd_t, big, mask_t, 20)
    # long horizon: 60-day features at t, forward 60 and 120 days from close(t+1)
    lf = long["f"]
    lok = long["ok"]
    long_rows, long_base = [], {}
    t_long = np.arange(BASE_DAYS + LONG_DAYS - 1, T - 121)
    for h in LONG_FWD:
        fw = forward_return(g.adj, t_long, h)
        mk = lok[t_long] & uni_mask[None, :]
        rows, base = lift_table({f: lf[f][t_long] for f in FEATURES}, fw[t_long], big, mk, h)
        long_rows += rows
        long_base[str(h)] = base
    return {
        "schemaVersion": 1, "asOf": asof, "window": {"from": g.days[0], "to": g.days[-1]},
        "universe": {"name": "top750", "label": f"Top {STUDY_TOP_N} stocks by current market cap (study universe)",
                     "stocks": int(uni_mask.sum())},
        "runs": {"UP": int((runs["dir"] == "UP")[uni_mask[runs["j"].to_numpy()]].sum()) if len(runs) else 0,
                 "DOWN": int((runs["dir"] == "DOWN")[uni_mask[runs["j"].to_numpy()]].sum()) if len(runs) else 0},
        "bigMovePct": big,
        "label": ("Historical, one sample period, current market-cap membership (survivorship bias), before costs. "
                  "Not a prediction. Evidence, not advice."),
        "medians": {"columns": ["window", "dir", "bucket", "feature", "median", "n"], "rows": med},
        "lift": {"columns": ["horizon", "feature", "quintile", "n", "bigUpPct", "bigDownPct"], "rows": lift_rows,
                 "base": {"horizon": 20, **lift_base}},
        "longHorizon": {"status": "computed", "columns": ["horizon", "feature", "quintile", "n", "bigUpPct", "bigDownPct"],
                        "rows": long_rows,
                        "base": {str(h): v for h, v in long_base.items()},
                        "featureDays": LONG_DAYS, "forwardDays": list(LONG_FWD)},
    }
