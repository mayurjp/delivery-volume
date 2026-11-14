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

def compute_daily(df: pd.DataFrame, settings: dict, signals: dict, etf: set[str] | frozenset[str] = frozenset()) -> pd.DataFrame:
    """Adds all per-stock daily metrics (04 section 2) and the signal. Returns a copy.

    Symbols in `etf` keep every metric but never get a signal (04 section 4.1: their delivery reflects
    creation/redemption and arbitrage, not investor interest)."""
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
    sym = pd.Series(pd.factorize(v["sym"])[0], index=v.index)  # int group keys: grouping text keys is much slower
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
    for _, idx in v.groupby(sym, sort=False).indices.items():
        pr[idx] = pctile_rank_trailing(dp_arr[idx], pw, mp(pw))
    v["delivPctPctile"] = pr

    v["streak"] = streak(v["delivPct"] - v["delivPctAvg20"], sym)
    v["priorDays"] = v.groupby(sym, sort=False).cumcount()

    # flags that depend only on S1-derived values
    v["lowLiquidity"] = v["turnoverAvg20Cr"].notna() & (v["turnoverAvg20Cr"] < liq["minTurnoverAvg20Cr"])
    v["newListing"] = v["priorDays"] < 20
    v["sigOk"] = ~v["lowLiquidity"] & (v["priorDays"] >= signals["minHistoryDays"]) & ~v["sym"].isin(etf)
    v["signal"] = classify_signal(v, signals["daily"])

    new_cols = ["delivValCr", "delivValAvg5", "delivValAvg20", "delivValAvg50", "delivPctAvg20", "volAvg20",
                "turnoverAvg20Cr", "tradeSizeRatio", "spike", "delivPctDiff", "relVol", "delivPctZ60",
                "delivPctPctile", "streak", "priorDays", "lowLiquidity", "newListing", "signal"]
    for c in new_cols:
        df[c] = v[c].reindex(df.index)
    df["lowLiquidity"] = df["lowLiquidity"].fillna(False).astype(bool)
    df["newListing"] = df["newListing"].fillna(False).astype(bool)
    return df


# ---- range comparison (04 section 3); the TypeScript twin is site/src/lib/metrics.ts computeRange ------------------

def range_metrics(cum_a0, cum_a1, cum_b0, cum_b1, trading_days_r: int, trading_days_b: int,
                  min_base_deliv_val_cr: float, min_turnover_cr: float) -> list[dict]:
    """Per-symbol range vs baseline comparison from four cum files (lists of dicts with the cum/ columns).

    cum_a0 / cum_b0 may be None (the range starts at the first stored date): the prior sum is then 0 and the row is
    flagged listedDuringRange. Value-based fields only.
    """
    def idx(rows):
        return {r["sym"]: r for r in (rows or [])}

    a0, b0, b1 = idx(cum_a0), idx(cum_b0), idx(cum_b1)

    def span(prior, end):
        if end is None:
            return None
        p = prior or {}
        return {"n": end["cDays"] - p.get("cDays", 0), "dv": end["cDelivValCr"] - p.get("cDelivValCr", 0.0),
                "tv": end["cTurnoverCr"] - p.get("cTurnoverCr", 0.0), "last": end["lastClose"],
                "up": end.get("cDelivValUpCr", 0.0) - p.get("cDelivValUpCr", 0.0),
                "dn": end.get("cDelivValDnCr", 0.0) - p.get("cDelivValDnCr", 0.0),
                "trades": end.get("cTrades", 0) - p.get("cTrades", 0),
                "prior_close": p.get("lastClose"), "listed": prior is None}

    out = []
    for r1 in cum_a1:
        R = span(a0.get(r1["sym"]), r1)
        B = span(b0.get(r1["sym"]), b1.get(r1["sym"]))
        avg_r = R["dv"] / R["n"] if R["n"] > 0 else None
        avg_b = B["dv"] / B["n"] if B and B["n"] > 0 else None
        pct_r = R["dv"] / R["tv"] * 100 if R["tv"] > 0 else None
        pct_b = B["dv"] / B["tv"] * 100 if B and B["tv"] > 0 else None
        turn_r = R["tv"] / R["n"] if R["n"] > 0 else None
        turn_b = B["tv"] / B["n"] if B and B["n"] > 0 else None
        coverage = R["n"] / trading_days_r if trading_days_r > 0 else 0.0
        bal_r = R["up"] / R["dn"] if R["dn"] > 0 else None  # delivery value on up days / on down days (08 section 5A)
        bal_b = B["up"] / B["dn"] if B and B["dn"] > 0 else None
        ats_r = R["tv"] * 1e7 / R["trades"] if R["trades"] > 0 else None  # average trade size, Rs
        ats_b = B["tv"] * 1e7 / B["trades"] if B and B["trades"] > 0 else None
        reasons = []
        if coverage < 0.6:
            reasons.append("range")
        if B is None or B["n"] < 0.6 * trading_days_b:
            reasons.append("baseline days")
        if avg_b is None or avg_b < min_base_deliv_val_cr:
            reasons.append("baseline delivery")
        if turn_b is None or turn_b < min_turnover_cr:
            reasons.append("baseline turnover")
        out.append({
            "sym": r1["sym"], "nR": R["n"], "nB": B["n"] if B else 0,
            "avgDelivValR": avg_r, "avgDelivValB": avg_b, "delivPctWR": pct_r, "delivPctWB": pct_b,
            "delivValChgPct": (avg_r / avg_b - 1) * 100 if avg_r is not None and avg_b and avg_b > 0 else None,
            "delivPctChgPp": pct_r - pct_b if pct_r is not None and pct_b is not None else None,
            "turnoverChgPct": (turn_r / turn_b - 1) * 100 if turn_r is not None and turn_b and turn_b > 0 else None,
            "ret": (R["last"] / R["prior_close"] - 1) * 100 if R["last"] is not None and R["prior_close"] else None,
            "delivBalanceR": bal_r, "delivBalanceB": bal_b, "avgTradeSizeR": ats_r, "avgTradeSizeB": ats_b,
            "tradeSizeRatio": ats_r / ats_b if ats_r is not None and ats_b else None,
            "coverage": coverage, "listedDuringRange": R["listed"], "excluded": bool(reasons),
        })
    return out


# ---- timeframes (docs/specs/08-timeframes.md): period aggregation -------------------------------------------------
# aggregate_periods / aggregate_range are the Python twins of site/src/lib/aggregate.ts (shared vectors:
# site/src/lib/vectors.json). The vectorised core `aggregate_frame` is what `build` uses for the weekly/monthly
# snapshots, so a stock's period rows are the same whether they come from a snapshot or from the client.

PRICE_ADJ_THRESHOLD = 0.03  # the 04 section 6 prevClose rule (still used to drop forward-return windows)
PERIOD_TFS = ("w", "m", "q")
DEFAULT_PERIOD_CFG = {
    "w": {"base": 10, "long": 52, "minHistory": 6, "daysPerPeriod": 5},
    "m": {"base": 6, "long": 24, "minHistory": 4, "daysPerPeriod": 21},
    "q": {"base": 4, "long": 8, "minHistory": 3, "daysPerPeriod": 63},
}
FLAG_LOWLIQ, FLAG_ETF, FLAG_NEWLISTING = 256, 512, 1024


def _iso(o: int) -> str:
    from datetime import date

    return date.fromordinal(o).isoformat()


def period_key(iso: str, tf: str) -> str:
    """Key of the calendar period holding `iso`: ISO week 2026-W46 (Mon-Sun, so a Sunday session stays in its week),
    month 2026-11, quarter 2026-Q4."""
    from datetime import date

    if tf == "m":
        return iso[:7]
    if tf == "q":
        return f"{iso[:4]}-Q{(int(iso[5:7]) - 1) // 3 + 1}"
    y, w, _ = date.fromisoformat(iso).isocalendar()
    return f"{y}-W{w:02d}"


def period_bounds(key: str, tf: str) -> tuple[str, str]:
    """Calendar start and end (inclusive) of a period key."""
    from datetime import date

    if tf == "w":
        mon = date.fromisocalendar(int(key[:4]), int(key[6:]), 1).toordinal()
        return _iso(mon), _iso(mon + 6)
    y = int(key[:4])
    if tf == "m":
        m = int(key[5:7])
        nxt = date(y + (m == 12), m % 12 + 1, 1).toordinal()
        return f"{y}-{m:02d}-01", _iso(nxt - 1)
    q = int(key[6:])
    m0 = (q - 1) * 3 + 1
    nxt = date(y + (q == 4), (m0 + 2) % 12 + 1, 1).toordinal()
    return f"{y}-{m0:02d}-01", _iso(nxt - 1)


def periods_for(trading_days: list[str], tf) -> list[dict]:
    """The periods of the market calendar. tf: 'w' | 'm' | 'q' | ('n', N) (N-trading-day bars aligned to END at the
    latest date). Each: {key, start, end (the first and last TRADING day in it), tradingDays, daysIn, daysExpected,
    partial, dates}.

    partial (08 section 1): a calendar period is partial while a Monday-Friday date in it is neither a trading day nor a
    known holiday: a date after the latest trading day (not yet traded) or before the first stored day. A weekday
    between the first and the latest day that is not a trading day is a holiday. A Sunday session counts in daysIn."""
    from datetime import date

    days = list(trading_days)
    latest, first = days[-1], days[0]
    out: list[dict] = []
    if isinstance(tf, tuple):
        n = int(tf[1])
        for e in range(len(days), 0, -n):
            chunk = days[max(0, e - n):e]
            out.append({"key": chunk[-1], "start": chunk[0], "end": chunk[-1], "tradingDays": len(chunk),
                        "daysIn": len(chunk), "daysExpected": n, "partial": len(chunk) < n, "dates": chunk})
        return out[::-1]
    by: dict[str, list[str]] = {}
    for d in days:
        by.setdefault(period_key(d, tf), []).append(d)
    have = set(days)
    for key, ds in by.items():
        cal_start, cal_end = period_bounds(key, tf)
        missing = 0
        for o in range(date.fromisoformat(cal_start).toordinal(), date.fromisoformat(cal_end).toordinal() + 1):
            iso = _iso(o)
            if iso in have or date.fromordinal(o).weekday() >= 5:
                continue
            if iso > latest or iso < first:
                missing += 1
        out.append({"key": key, "start": ds[0], "end": ds[-1], "tradingDays": len(ds), "daysIn": len(ds),
                    "daysExpected": len(ds) + missing, "partial": missing > 0, "dates": ds})
    return out


# Price adjustments (splits, bonuses, consolidations). NSE's S1 PREV_CLOSE is the RAW previous close on an ex-date (it
# equals close(t-1) even on the day a 1:5 split drops the price by 80%), so the "prevClose vs close(t-1) mismatch"
# rule of 04 section 6 fires only for a handful of rare restatements. The close-to-close rule below is what finds
# splits: a one-day price ratio far outside any price band that matches a corporate-action ratio.
SPLIT_RATIOS_DOWN = (1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 8, 1 / 10, 1 / 20, 1 / 25, 1 / 50, 1 / 100, 2 / 3, 3 / 4, 2 / 5,
                     3 / 5)
SPLIT_RATIOS_UP = (2.0, 3.0, 4.0, 5.0, 10.0, 20.0, 50.0, 100.0)  # consolidations (reverse splits)
SPLIT_MAX_DOWN, SPLIT_MIN_UP, SPLIT_TOL = 0.78, 1.8, 0.10  # tolerance 10%: on the year of S4 ex-dates, 85% recall at 87% precision
_SPLIT_CANDIDATES = np.array(sorted(set(SPLIT_RATIOS_DOWN) | set(SPLIT_RATIOS_UP)))


def adjustment_events(sym: np.ndarray, close: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(event, factor) per row. An event is a day whose close(t) / close(t-1) (same stock, previous stored row) is at most
    0.78 (or at least 1.8) AND within 10% of a corporate-action ratio (1:2, 1:3, 1:5, 1:10, bonus 1:1 = 1/2, 1:2 = 2/3,
    consolidations 2..100). `factor` is that exact ratio (the observed ratio also contains the day's own move). A fall
    of 22% or more in one day is beyond the 20% circuit band; ratios that match no corporate action are left alone.
    Rows sorted by (sym, date). Needs no corporate-action file, so it works for years before S4 was stored."""
    n = len(sym)
    prev_row = np.full(n, np.nan)
    prev_row[1:] = close[:-1]
    same = np.zeros(n, dtype=bool)
    same[1:] = sym[1:] == sym[:-1]
    with np.errstate(invalid="ignore", divide="ignore"):
        obs = np.where(same & (prev_row > 0), close / prev_row, np.nan)
        cand = _SPLIT_CANDIDATES[np.abs(np.log(obs[:, None] / _SPLIT_CANDIDATES[None, :])).argmin(axis=1)]             if n else np.empty(0)
        near = np.abs(obs / cand - 1) <= SPLIT_TOL
        ev = ((obs <= SPLIT_MAX_DOWN) | (obs >= SPLIT_MIN_UP)) & near & ((cand < 1) == (obs < 1))
    return ev, np.where(ev, cand, 1.0)


def price_adjustment(sym: np.ndarray, close: np.ndarray) -> np.ndarray:
    """Factor A(t) turning day-t prices into the prices of the LATEST day's basis: A(t) = product of the factors of the
    adjustment events on the days j > t of the same stock (`adjustment_events`)."""
    n = len(sym)
    ev, f = adjustment_events(sym, close)
    lg = np.log(f)
    cum = np.cumsum(lg)
    starts = np.flatnonzero(np.r_[True, sym[1:] != sym[:-1]])
    sizes = np.diff(np.r_[starts, n])
    before = np.repeat(np.r_[0.0, cum[starts[1:] - 1]], sizes)  # cumulative sum before each symbol starts
    total = np.repeat(cum[np.r_[starts[1:], n] - 1], sizes) - before
    return np.round(np.exp(total - (cum - before)), 12)


def period_signal(d: pd.DataFrame, thr: dict) -> pd.Series:
    """Period signal (08 section 3). Same structure as classify_signal; thresholds: signals.json -> periods.<tf>."""
    a, ds, ab, su, sd = thr["ACC"], thr["DIS"], thr["ABS"], thr["SPU"], thr["SPD"]
    r = d["ret"]
    acc = (r >= a["retMin"]) & (d.spike >= a["spikeMin"]) & (d.delivPctDiff >= a["delivPctDiffMin"]) & (d.clv >= a["clvMin"])
    dis = (r <= ds["retMax"]) & (d.spike >= ds["spikeMin"]) & (d.delivPctDiff >= ds["delivPctDiffMin"]) & (d.clv <= ds["clvMax"])
    absr = (r.abs() < ab["absRetMax"]) & (d.spike >= ab["spikeMin"]) & (d.delivPctDiff >= ab["delivPctDiffMin"])
    spu = (r >= su["retMin"]) & (d.relTurnover >= su["relTurnoverMin"]) & (d.delivPctDiff <= su["delivPctDiffMax"])
    spd = (r <= sd["retMax"]) & (d.relTurnover >= sd["relTurnoverMin"]) & (d.delivPctDiff <= sd["delivPctDiffMax"])
    code = np.select([acc, dis, absr, spu, spd], ["ACC", "DIS", "ABS", "SPU", "SPD"], default="")
    sig = pd.Series(code, index=d.index, dtype=object)
    sig[~d.sigOk.fillna(False).astype(bool)] = ""
    return sig.where(sig != "", None)


def aggregate_frame(df: pd.DataFrame, periods: list[dict], tf, settings: dict | None = None,
                    signals: dict | None = None, etf: set | frozenset = frozenset(),
                    with_baselines: bool = True) -> pd.DataFrame:
    """One row per (stock, period) with the 08 section 2 fields. Vectorised segment reductions, no per-row Python.

    df: rows sorted by (sym, date) with sym, date, series, open, high, low, close, prevClose, vwap, vol, turnoverCr,
    trades, delivQty, delivValCr, valid (bool), and optionally flags (int). Rows of dates outside every period still
    feed the price adjustment and the prior close. A stock counts in a period when it has a valid delivery day in it;
    `days` is the number of valid days and every sum is over valid days (as in cum/).

    Prices (open, high, low, close, prevClose, vwap) are expressed in the basis of the period's LAST day, so
    ret = close / prevClose - 1 holds across a split (`adjusted` = 1 marks those periods). vol and delivQty are plain
    sums: across a split use the value fields."""
    df = df.reset_index(drop=True)
    sym = df["sym"].to_numpy(dtype=object)

    def f64(c: str) -> np.ndarray:
        return df[c].to_numpy(dtype="float64", na_value=np.nan)

    close, prev_close = f64("close"), f64("prevClose")
    A = price_adjustment(sym, close)
    pidx = {dt: i for i, p in enumerate(periods) for dt in p["dates"]}
    pi = df["date"].map(pidx).to_numpy(dtype="float64", na_value=-1).astype(np.int64)
    n_all = len(df)
    prev_close_row = np.full(n_all, np.nan)
    prev_A_row = np.full(n_all, np.nan)
    if n_all > 1:
        same = sym[1:] == sym[:-1]
        prev_close_row[1:] = np.where(same, close[:-1], np.nan)
        prev_A_row[1:] = np.where(same, A[:-1], np.nan)
    ix = np.flatnonzero(pi >= 0)
    n = len(ix)
    if n == 0:
        return pd.DataFrame()
    s_sym, s_pi = sym[ix], pi[ix]
    first = np.flatnonzero(np.r_[True, (s_sym[1:] != s_sym[:-1]) | (s_pi[1:] != s_pi[:-1])])
    counts = np.diff(np.r_[first, n])
    last = first + counts - 1
    g_of_row = np.repeat(np.arange(len(first)), counts)

    A_s = A[ix]
    A_last = A_s[last]
    B = A_s / A_last[g_of_row]  # price basis factor: day-t prices -> basis of the period's last day
    valid = df["valid"].to_numpy(dtype=bool)[ix]

    def vz(c: str) -> np.ndarray:
        return np.where(valid, np.nan_to_num(f64(c)[ix]), 0.0)

    def rsum(x: np.ndarray) -> np.ndarray:
        return np.add.reduceat(x, first)

    turn, dval, volv, tradesv, dq = vz("turnoverCr"), vz("delivValCr"), vz("vol"), vz("trades"), vz("delivQty")
    cl_s = close[ix]
    up = valid & (cl_s > prev_close[ix])
    dn = valid & (cl_s < prev_close[ix])
    days = rsum(valid.astype(np.float64))
    turnover_cr, deliv_val, trades = rsum(turn), rsum(dval), rsum(tradesv)
    vol_basis = rsum(volv / B)  # quantities in the period-end basis, for the vwap only
    hi = np.maximum.reduceat(f64("high")[ix] * B, first)
    lo = np.minimum.reduceat(f64("low")[ix] * B, first)
    cl = cl_s[last]
    op = f64("open")[ix][first] * B[first]
    pcr_first, pa_first = prev_close_row[ix][first], prev_A_row[ix][first]
    has_prior = ~np.isnan(pcr_first)
    pc = np.where(has_prior, pcr_first * pa_first / A_last, prev_close[ix][first] * A_s[first] / A_last)
    with np.errstate(invalid="ignore", divide="ignore"):
        rng = hi - lo
        clv_v = np.where(rng > 0, ((cl - lo) - (hi - cl)) / np.where(rng > 0, rng, 1.0), 0.0)
        within = np.abs(np.log(np.maximum.reduceat(A_s, first) / np.minimum.reduceat(A_s, first))) > 1e-9
        at_start = has_prior & (np.abs(pa_first / A_s[first] - 1) > 1e-9)
        up_v, dn_v = rsum(np.where(up, dval, 0.0)), rsum(np.where(dn, dval, 0.0))
        out = pd.DataFrame({
            "sym": s_sym[first], "pi": s_pi[first], "days": days.astype(np.int64),
            "open": op, "high": hi, "low": lo, "close": cl, "prevClose": pc,
            "vwap": np.where(vol_basis > 0, turnover_cr * 1e7 / np.where(vol_basis > 0, vol_basis, 1), np.nan),
            "vol": rsum(volv), "turnoverCr": turnover_cr, "trades": trades, "delivQty": rsum(dq),
            "delivValCr": deliv_val,
            "delivPct": np.where(turnover_cr > 0, deliv_val / np.where(turnover_cr > 0, turnover_cr, 1) * 100, np.nan),
            "ret": (cl / np.where(pc > 0, pc, np.nan) - 1) * 100,
            "clv": clv_v,
            "avgTradeSize": np.where(trades > 0, turnover_cr * 1e7 / np.where(trades > 0, trades, 1), np.nan),
            "delivBalance": np.where(dn_v > 0, up_v / np.where(dn_v > 0, dn_v, 1), np.nan),
            "delivValUpCr": up_v, "delivValDnCr": dn_v,
            "adjusted": (within | at_start).astype(np.int64),
        })
    flags = df["flags"].to_numpy(dtype=np.int64)[ix] if "flags" in df.columns else np.zeros(n, dtype=np.int64)
    out["flags"] = np.bitwise_or.reduceat(flags, first)
    out = out[out["days"] > 0].reset_index(drop=True)
    meta = pd.DataFrame(periods)
    out["key"] = out["pi"].map(meta["key"])
    out["partial"] = out["pi"].map(meta["partial"]).astype(bool)
    if with_baselines:
        out = _period_baselines(out, tf, settings, signals, etf)
    return out


def _period_baselines(out: pd.DataFrame, tf, settings: dict | None, signals: dict | None, etf) -> pd.DataFrame:
    from . import config

    settings = settings or config.settings()
    signals = signals or config.signals()
    kind = "w" if isinstance(tf, tuple) else tf
    cfg = {**DEFAULT_PERIOD_CFG[kind], **signals.get("periods", {}).get(kind, {})}
    N, L = cfg["base"], cfg["long"]
    frac, liq = settings["minPeriodsFraction"], settings["liquidity"]
    sym = pd.Series(pd.factorize(out["sym"])[0], index=out.index)
    comp = ~out["partial"]  # a partial period never enters a baseline

    def masked(col: str) -> pd.Series:
        return out[col].where(comp)

    def mp(k: int) -> int:
        return min_periods(k, frac)

    dv_m, tv_m = masked("delivValCr"), masked("turnoverCr")
    out["delivValAvgN"] = prior_roll(dv_m, sym, N, "mean", mp(N))
    dv_sum, tv_sum = prior_roll(dv_m, sym, N, "sum", mp(N)), prior_roll(tv_m, sym, N, "sum", mp(N))
    out["delivPctAvgN"] = dv_sum / tv_sum.where(tv_sum > 0) * 100
    out["turnoverAvgCr"] = prior_roll(masked("turnoverCr") / out["days"], sym, N, "mean", mp(N))
    out["spike"] = (out["delivValCr"] / out["delivValAvgN"]).where(
        out["delivValAvgN"].notna() & (out["delivValAvgN"] >= liq["minBaseDelivValCr"] * cfg["daysPerPeriod"]))
    out["delivPctDiff"] = out["delivPct"] - out["delivPctAvgN"]
    out["relTurnover"] = out["turnoverCr"] / prior_roll(tv_m, sym, N, "mean", mp(N))
    out["tradeSizeRatio"] = out["avgTradeSize"] / prior_roll(masked("avgTradeSize"), sym, N, "mean", mp(N))
    dp_m = masked("delivPct")
    zmean, zstd = prior_roll(dp_m, sym, L, "mean", mp(L)), prior_roll(dp_m, sym, L, "std", mp(L))
    out["delivPctZ"] = (out["delivPct"] - zmean) / zstd.where(zstd > 0)
    pr = np.full(len(out), np.nan)
    arr = dp_m.to_numpy(dtype="float64", na_value=np.nan)
    for _, ii in out.groupby(sym, sort=False).indices.items():
        pr[ii] = pctile_rank_trailing(arr[ii], L, mp(L))
    out["delivPctPctile"] = pr  # null for a partial period (the period itself is masked out of every window)
    out["streak"] = streak(out["delivPctDiff"], sym)
    out["priorPeriods"] = comp.astype(int).groupby(sym, sort=False).cumsum() - comp.astype(int)
    out["lowLiq"] = out["turnoverAvgCr"].notna() & (out["turnoverAvgCr"] < liq["minTurnoverAvg20Cr"])
    out["newListing"] = out["priorPeriods"] < cfg["minHistory"]
    is_etf = out["sym"].isin(etf)
    out["sigOk"] = ~out["lowLiq"] & ~out["newListing"] & ~is_etf
    out["signal"] = None if isinstance(tf, tuple) else period_signal(out, cfg)  # custom N-day bars carry no signal
    flags = out["flags"].to_numpy(dtype=np.int64)
    flags = (flags & ~(FLAG_LOWLIQ | FLAG_NEWLISTING | FLAG_ETF)) | np.where(out["lowLiq"], FLAG_LOWLIQ, 0) \
        | np.where(out["newListing"], FLAG_NEWLISTING, 0) | np.where(is_etf, FLAG_ETF, 0)
    out["flags"] = flags
    return out


def rows_to_frame(rows: list[dict], sym: str = "X") -> pd.DataFrame:
    """Symbol-file style rows (date, series, open, high, low, close, prevClose, vwap, vol, turnoverCr, trades,
    delivQty, flags) -> the frame aggregate_frame expects (valid = EQ with delivery and volume)."""
    df = pd.DataFrame(rows)
    for c in ("open", "high", "low", "close", "prevClose", "vwap", "vol", "turnoverCr", "trades", "delivQty", "flags"):
        if c not in df.columns:
            df[c] = np.nan
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["sym"] = sym
    df["valid"] = (df["series"] == "EQ") & df["delivQty"].notna() & (df["vol"] > 0)
    df["delivValCr"] = df["delivQty"] * df["vwap"] / 1e7
    df["flags"] = df["flags"].fillna(0).astype(np.int64)
    return df.sort_values("date", kind="stable").reset_index(drop=True)


PERIOD_FIELDS = ["days", "open", "high", "low", "close", "prevClose", "vwap", "vol", "turnoverCr", "trades",
                 "delivQty", "delivValCr", "delivPct", "ret", "clv", "avgTradeSize", "delivBalance", "delivValAvgN",
                 "delivPctAvgN", "turnoverAvgCr", "spike", "delivPctDiff", "relTurnover", "tradeSizeRatio",
                 "delivPctZ", "delivPctPctile", "streak", "signal", "flags", "adjusted"]
_INT_FIELDS = {"days", "streak", "flags", "adjusted", "trades", "vol", "delivQty"}


def period_records(pf: pd.DataFrame, periods: list[dict]) -> list[dict]:
    out = []
    for r in pf.to_dict("records"):
        p = periods[r["pi"]]
        rec = {"key": p["key"], "start": p["start"], "end": p["end"], "daysIn": p["daysIn"],
               "daysExpected": p["daysExpected"], "partial": bool(p["partial"])}
        for f in PERIOD_FIELDS:
            v = r.get(f)
            if v is None or (isinstance(v, float) and math.isnan(v)):
                v = None
            elif f in _INT_FIELDS:
                v = int(round(v))
            rec[f] = v
        out.append(rec)
    return out


def aggregate_periods(rows: list[dict], tf, trading_days: list[str], settings: dict | None = None,
                      signals: dict | None = None, etf: bool = False) -> list[dict]:
    """Python twin of aggregatePeriods(rows, tf) in site/src/lib/aggregate.ts: ONE stock's period rows (08 section 2).
    `trading_days` is the market calendar: it defines the periods and which of them are partial."""
    periods = periods_for(trading_days, tf)
    pf = aggregate_frame(rows_to_frame(rows), periods, tf, settings, signals, {"X"} if etf else frozenset())
    return period_records(pf, periods) if len(pf) else []


def aggregate_range(rows: list[dict], a: str, b: str) -> dict | None:
    """Python twin of aggregateRange(rows, a, b): ONE aggregate over the dates a..b (inclusive) of one stock's rows, for
    the custom single bar and the footprint card. Same fields as a period row, without baseline fields. None when the
    stock has no valid delivery day in the range."""
    df = rows_to_frame(rows)
    dates = [d for d in df["date"] if a <= d <= b]
    if not dates:
        return None
    period = {"key": f"{a}..{b}", "start": a, "end": b, "tradingDays": len(dates), "daysIn": len(dates),
              "daysExpected": len(dates), "partial": False, "dates": dates}
    pf = aggregate_frame(df, [period], ("n", len(dates)), with_baselines=False)
    return period_records(pf, [period])[0] if len(pf) else None
