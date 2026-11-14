"""All formulas from docs/specs/04-analytics.md (single implementation).

Input frame: one row per (sym, date) for series EQ/BE/BZ, sorted by sym then date, with columns
sym, series, date, prevClose, open, high, low, close, vwap, vol, turnoverLacs, trades, delivQty, delivPct.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

# ---- elementary formulas (unit-tested with hand-computed values) ----------------------------------------------------

def turnover_cr(turnover_lacs):
    """S1 TURNOVER_LACS is rupees lakh: Rs Cr = lakh / 100 (tv = lakh * 1e5; tv / 1e7)."""
    return turnover_lacs / 100.0


def deliv_val_cr(deliv_qty, vwap):
    return deliv_qty * vwap / 1e7


def clv(high, low, close):
    """Close location value: +1 closed at the high, -1 at the low; 0 when high == low."""
    rng = high - low
    out = ((close - low) - (high - close)) / rng.where(rng != 0)
    return out.where(rng != 0, 0.0).where(rng.notna())


def ret_pct(close, prev_close):
    return (close / prev_close.where(prev_close > 0) - 1) * 100


def min_periods(window: int, fraction: float) -> int:
    return max(1, math.ceil(window * fraction))


def prior_roll(s: pd.Series, sym: pd.Series, window: int, how: str, mp: int) -> pd.Series:
    """Rolling statistic over the `window` valid days BEFORE each row (current day excluded), per symbol.

    Equivalent to s.shift(1).rolling(window, min_periods=mp) within each symbol. Requires a unique index.
    """
    sh = s.groupby(sym, sort=False).shift(1)
    r = sh.groupby(sym, sort=False).rolling(window, min_periods=mp)
    out = getattr(r, how)().reset_index(level=0, drop=True)
    return out.reindex(s.index)


def pctile_rank_trailing(values: np.ndarray, window: int, mp: int) -> np.ndarray:
    """Percentile rank (0-100) of each value among the last `window` values INCLUDING itself: share of window <= value."""
    n = len(values)
    out = np.full(n, np.nan)
    if n == 0:
        return out
    padded = np.concatenate([np.full(window - 1, np.nan), values.astype(float)])
    win = np.lib.stride_tricks.sliding_window_view(padded, window)
    cnt = (~np.isnan(win)).sum(axis=1)
    le = (win <= values[:, None]).sum(axis=1)
    ok = (cnt >= mp) & ~np.isnan(values)
    out[ok] = le[ok] / cnt[ok] * 100.0
    return out


def streak(diff: pd.Series, sym: pd.Series) -> pd.Series:
    """Signed run length of consecutive valid days with diff > 0 (+k) or diff < 0 (-k). NaN diff breaks the run."""
    sign = np.sign(diff)
    new_run = (sign != sign.shift()) | (sym != sym.shift()) | sign.isna()
    run_id = new_run.cumsum()
    length = sign.groupby(run_id).cumcount() + 1
    return (sign * length).where(sign.notna())


def classify_signal(d: pd.DataFrame, thr: dict) -> pd.Series:
    """Daily signal code (04 section 4.1). First matching rule wins. d needs eligibility column `sigOk`."""
    a, ds, ab, su, sd = thr["ACC"], thr["DIS"], thr["ABS"], thr["SPU"], thr["SPD"]
    acc = (d.ret1 >= a["ret1Min"]) & (d.spike >= a["spikeMin"]) & (d.delivPctDiff >= a["delivPctDiffMin"]) \
        & (d.clv >= a["clvMin"])
    dis = (d.ret1 <= ds["ret1Max"]) & (d.spike >= ds["spikeMin"]) & (d.delivPctDiff >= ds["delivPctDiffMin"]) \
        & (d.clv <= ds["clvMax"])
    absr = (d.ret1.abs() < ab["absRet1Max"]) & (d.spike >= ab["spikeMin"]) & (d.delivPctDiff >= ab["delivPctDiffMin"])
    spu = (d.ret1 >= su["ret1Min"]) & (d.relVol >= su["relVolMin"]) & (d.delivPctDiff <= su["delivPctDiffMax"])
    spd = (d.ret1 <= sd["ret1Max"]) & (d.relVol >= sd["relVolMin"]) & (d.delivPctDiff <= sd["delivPctDiffMax"])
    code = np.select([acc, dis, absr, spu, spd], ["ACC", "DIS", "ABS", "SPU", "SPD"], default="")
    sig = pd.Series(code, index=d.index, dtype=object)
    sig[~d.sigOk.fillna(False).astype(bool)] = ""
    return sig.where(sig != "", None)


# ---- full daily computation ----------------------------------------------------------------------------------------

def compute_daily(df: pd.DataFrame, settings: dict, signals: dict) -> pd.DataFrame:
    """Adds all per-stock daily metrics (04 section 2) and the signal. Returns a copy."""
    w = settings["windows"]
    frac = settings["minPeriodsFraction"]
    liq = settings["liquidity"]
    df = df.reset_index(drop=True).copy()

    # price-based metrics apply to every row (price continuity for BE/BZ too)
    df["ret1"] = ret_pct(df["close"], df["prevClose"])
    df["clv"] = clv(df["high"], df["low"], df["close"])
    df["vwapGap"] = (df["close"] - df["vwap"]) / df["vwap"].where(df["vwap"] > 0) * 100
    df["turnoverCr"] = turnover_cr(df["turnoverLacs"])

    valid = (df["series"].isin(settings["universeSeries"])) & df["delivQty"].notna() & (df["vol"] > 0)
    df["valid"] = valid
    v = df.loc[valid].copy()
    sym = v["sym"]
    v["delivValCr"] = deliv_val_cr(v["delivQty"], v["vwap"])
    v["avgTradeSize"] = v["turnoverCr"] * 1e7 / v["trades"].where(v["trades"] > 0)

    def mp(n: int) -> int:
        return min_periods(n, frac)

    for n, name in ((w["short"], "delivValAvg5"), (w["base"], "delivValAvg20"), (w["long"], "delivValAvg50")):
        v[name] = prior_roll(v["delivValCr"], sym, n, "mean", mp(n))
    n = w["base"]
    dv_sum = prior_roll(v["delivValCr"], sym, n, "sum", mp(n))
    tv_sum = prior_roll(v["turnoverCr"], sym, n, "sum", mp(n))
    v["delivPctAvg20"] = dv_sum / tv_sum.where(tv_sum > 0) * 100  # value-weighted, never an average of ratios
    v["volAvg20"] = prior_roll(v["vol"].astype(float), sym, n, "mean", mp(n))
    v["turnoverAvg20Cr"] = prior_roll(v["turnoverCr"], sym, n, "mean", mp(n))
    v["tradeSizeRatio"] = v["avgTradeSize"] / prior_roll(v["avgTradeSize"], sym, n, "mean", mp(n))

    v["spike"] = v["delivValCr"] / v["delivValAvg20"]
    v["spike"] = v["spike"].where(v["delivValAvg20"].notna() & (v["delivValAvg20"] >= liq["minBaseDelivValCr"]))
    v["delivPctDiff"] = v["delivPct"] - v["delivPctAvg20"]
    v["relVol"] = v["vol"] / v["volAvg20"]

    zn = w["z"]
    zmean = prior_roll(v["delivPct"], sym, zn, "mean", mp(zn))
    zstd = prior_roll(v["delivPct"], sym, zn, "std", mp(zn))
    v["delivPctZ60"] = (v["delivPct"] - zmean) / zstd.where(zstd > 0)

    pw = w["pctile"]
    pr = np.full(len(v), np.nan)
    dp_arr = v["delivPct"].to_numpy()
    for _, idx in v.groupby("sym", sort=False).indices.items():
        pr[idx] = pctile_rank_trailing(dp_arr[idx], pw, mp(pw))
    v["delivPctPctile"] = pr

    v["streak"] = streak(v["delivPct"] - v["delivPctAvg20"], sym)
    v["priorDays"] = v.groupby("sym", sort=False).cumcount()

    # flags that depend only on S1-derived values
    v["lowLiquidity"] = v["turnoverAvg20Cr"].notna() & (v["turnoverAvg20Cr"] < liq["minTurnoverAvg20Cr"])
    v["newListing"] = v["priorDays"] < 20
    v["sigOk"] = ~v["lowLiquidity"] & (v["priorDays"] >= signals["minHistoryDays"])
    v["signal"] = classify_signal(v, signals["daily"])

    new_cols = ["delivValCr", "delivValAvg5", "delivValAvg20", "delivValAvg50", "delivPctAvg20", "volAvg20",
                "turnoverAvg20Cr", "tradeSizeRatio", "spike", "delivPctDiff", "relVol", "delivPctZ60",
                "delivPctPctile", "streak", "priorDays", "lowLiquidity", "newListing", "signal"]
    for c in new_cols:
        df[c] = v[c].reindex(df.index)
    df["lowLiquidity"] = df["lowLiquidity"].fillna(False).astype(bool)
    df["newListing"] = df["newListing"].fillna(False).astype(bool)
    return df
