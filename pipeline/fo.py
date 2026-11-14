"""F&O analytics (docs/specs/04-analytics.md section 4.4): futures open interest, its daily change, the build-up code and
the put/call ratio, from the reduced S3 extract (store/fo_extract, 03 section 3).

Rules (the same ones docs/research/scripts/signal_fwd3.py applies, so the study replicates):
* futOi(t) = sum of open interest over all stock-futures (STF) expiries of the symbol on day t. OI is in SHARES
  (SOURCE_STATUS.md, S3 units).
* futOiChgPct(t) = futOi(t) / futOi(t-1) - 1, in per cent. It is null (no change measured) when t-1 is not the previous
  trading day in the store, when no previous F&O row exists, or when an STF expiry falls in [t-1, t] (the roll: the OI
  of the expiring contract leaves the sum, DEVIATIONS #119).
* buildup: price direction from ret1 (the published, 2-dp value) and OI direction from the unrounded change, with
  thresholds config/signals.json -> buildup.oiChgPct (2):
  LB long build-up (price up, OI up), SB short build-up (price down, OI up), SC short covering (price up, OI down),
  LU long unwinding (price down, OI down). Null otherwise, including a flat price or a change inside the band.
* pcr = sum of put (PE) open interest / sum of call (CE) open interest over all stock-option (STO) expiries; null when
  there is no call open interest. Rounded to 3 dp.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

BUILDUP = ("LB", "SB", "SC", "LU")
BUILDUP_LABELS = {"LB": "Long build-up", "SB": "Short build-up", "SC": "Short covering", "LU": "Long unwinding"}


def classify_buildup(ret1, oi_chg_pct, thr: float = 2.0) -> str | None:
    """Scalar build-up code with the 04 section 4.4 boundaries: price (rounded to 2 dp, as published) strictly up (> 0) or
    strictly down (< 0); OI change at least +thr (>=) or at most -thr (<=). A missing value, a flat price (0) or an OI
    change inside (-thr, thr) is None."""
    if ret1 is None or oi_chg_pct is None or pd.isna(ret1) or pd.isna(oi_chg_pct):
        return None
    ret1 = round(float(ret1), 2)  # the published (2 dp) price change decides the direction
    up, dn = ret1 > 0, ret1 < 0
    oi_up, oi_dn = oi_chg_pct >= thr, oi_chg_pct <= -thr
    if up and oi_up:
        return "LB"
    if dn and oi_up:
        return "SB"
    if up and oi_dn:
        return "SC"
    if dn and oi_dn:
        return "LU"
    return None


def classify_buildup_vec(ret1: np.ndarray, oi_chg_pct: np.ndarray, thr: float = 2.0) -> np.ndarray:
    """Vectorised classify_buildup over arrays: an object array of codes, with "" where there is no code."""
    with np.errstate(invalid="ignore"):
        r = np.round(np.asarray(ret1, dtype="float64"), 2)
        o = np.asarray(oi_chg_pct, dtype="float64")
        up, dn = r > 0, r < 0
        oi_up, oi_dn = o >= thr, o <= -thr
    return np.select([up & oi_up, dn & oi_up, up & oi_dn, dn & oi_dn], ["LB", "SB", "SC", "LU"], default="").astype(object)


def _roll_or_gap(sym: np.ndarray, t: np.ndarray, prev_t: np.ndarray, days: list[str], exp: dict[str, np.ndarray],
                 dates: np.ndarray) -> np.ndarray:
    """True where the OI change must not be measured: no previous F&O row, the previous row is not the previous trading
    day, or a stock-futures expiry falls in [previous trading day, t] (the roll)."""
    gap = np.isnan(prev_t) | (t - np.nan_to_num(prev_t, nan=-99) != 1)
    days_arr = np.asarray(days)
    for s in np.unique(sym):
        m = (sym == s) & ~np.isnan(prev_t)
        e = exp.get(s)
        if e is None or not m.any() or len(e) == 0:
            continue
        lo = days_arr[prev_t[m].astype(np.int64)]
        hi = dates[m]
        # an expiry e with lo <= e <= hi: searchsorted counts
        n = np.searchsorted(e, hi, side="right") - np.searchsorted(e, lo, side="left")
        gap[np.flatnonzero(m)[n > 0]] = True
    return gap


def fo_frame(fo: pd.DataFrame, days: list[str]) -> pd.DataFrame:
    """Per (sym, date) F&O measures from the extract rows.

    fo: columns sym, date (ISO), instType, expiry (ISO), optType, oi, for every stored extract row (already alias-resolved).
    days: the store's trading days (ISO), ascending. Returns sym, date, futOi, dOi (unrounded per cent change, NaN when
    not measured), pcr (rounded 3 dp). The F&O universe is the set of (sym, date) with a stock-futures row (STF)."""
    fut = fo[fo["instType"] == "STF"]
    out = fut.groupby(["sym", "date"], as_index=False)["oi"].sum().rename(columns={"oi": "futOi"})
    out["futOi"] = out["futOi"].astype("float64")
    tix = {d: i for i, d in enumerate(days)}
    out["t"] = out["date"].map(tix)
    out = out.dropna(subset=["t"]).sort_values(["sym", "t"], kind="stable").reset_index(drop=True)
    out["t"] = out["t"].astype(np.int64)
    sym = out["sym"].to_numpy(dtype=object)
    t = out["t"].to_numpy(dtype=np.float64)
    fut_oi = out["futOi"].to_numpy(dtype=np.float64)
    same = np.r_[False, sym[1:] == sym[:-1]] if len(sym) else np.zeros(0, bool)
    prev_oi = np.where(same, np.r_[np.nan, fut_oi[:-1]], np.nan)
    prev_t = np.where(same, np.r_[np.nan, t[:-1]], np.nan)
    # every stock-futures expiry of the symbol across the store, sorted, for the roll test
    exp = {s: np.array(sorted(set(g["expiry"])), dtype=object) for s, g in fut.groupby("sym")}
    gap = _roll_or_gap(sym, t, prev_t, days, exp, out["date"].to_numpy(dtype=object))
    with np.errstate(invalid="ignore", divide="ignore"):
        d_oi = (fut_oi / prev_oi - 1) * 100
    out["dOi"] = np.where(gap, np.nan, d_oi)
    # put/call open interest over the stock-option expiries
    opt = fo[(fo["instType"] == "STO") & fo["optType"].isin(["CE", "PE"])]
    oi_by = opt.groupby(["sym", "date", "optType"])["oi"].sum().unstack("optType")
    if len(oi_by):
        ce = oi_by["CE"] if "CE" in oi_by else pd.Series(np.nan, index=oi_by.index)
        pe = oi_by["PE"] if "PE" in oi_by else pd.Series(np.nan, index=oi_by.index)
        pcr = (pe / ce).where(ce > 0).rename("pcr").reset_index()
        out = out.merge(pcr, on=["sym", "date"], how="left")
    else:
        out["pcr"] = np.nan
    out["pcr"] = out["pcr"].round(3)
    return out[["sym", "date", "futOi", "dOi", "pcr"]]


def attach(df: pd.DataFrame, fo_d: pd.DataFrame, days: list[str]) -> pd.DataFrame:
    """Adds futOi, dOi (unrounded per cent change) and pcr from fo_frame() to each (sym, date) row of df: NaN where the stock
    has no stock futures that day. Integer keys (symbol code x day index) replace a pandas merge (1.8 million rows)."""
    out = df.copy()
    for c in ("futOi", "dOi", "pcr"):
        out[c] = np.nan
    if not len(fo_d):
        return out
    syms = pd.Index(sorted(set(df["sym"]) | set(fo_d["sym"])))
    T = len(days)
    tix = {d: i for i, d in enumerate(days)}
    kd = syms.get_indexer(df["sym"].to_numpy(dtype=object)) * T + df["date"].map(tix).to_numpy(dtype=np.float64)
    kf = syms.get_indexer(fo_d["sym"].to_numpy(dtype=object)) * T + fo_d["date"].map(tix).to_numpy(dtype=np.float64)
    order = np.argsort(kf, kind="stable")
    ks = kf[order]
    pos = np.clip(np.searchsorted(ks, kd), 0, len(ks) - 1)
    hit = ks[pos] == kd
    src = order[pos]
    for c in ("futOi", "dOi", "pcr"):
        out[c] = np.where(hit, fo_d[c].to_numpy(dtype=np.float64)[src], np.nan)
    return out
