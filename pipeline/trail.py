"""Smart Money Trail v1 (docs/specs/07-run-forensics.md section 6A): the four delivery footprints per stock, their
weekly codes and the window metrics (tally, consistency, strip, flip).

One vectorised implementation. Everything works on (days x stocks) cumulative-sum matrices, so a window sum is a
difference of two rows and every as-of date costs a few array operations. The TypeScript twin is
site/src/lib/trail.ts (shared vectors: site/src/lib/trailVectors.json, written by pytest); `trail_for_rows` is the
one-stock entry point both are tested through.

Eligible day (the only days that count): an EQ row with a delivery quantity, volume and trades, whose flags carry none
of lowLiquidity, newListing and etf. Inputs are the PUBLISHED (rounded) values, so the build and the browser agree.
Codes: A = leans accumulation, D = leans distribution, N = neutral, '-' = not enough history (null).
"""

from __future__ import annotations

import math

import numpy as np

from . import metrics

INDICATORS = ["delivBal", "delivPctTrend", "tradeSizeTrend", "spikePersist"]
FLAG_LOWLIQ, FLAG_ETF, FLAG_NEWLISTING = 256, 512, 1024
EXCLUDED = FLAG_LOWLIQ | FLAG_ETF | FLAG_NEWLISTING
MISSING = 9  # code value of "not enough history"
CH = {1: "A", -1: "D", 0: "N", MISSING: "-"}
CUM_KEYS = ["NE", "DV", "TV", "TR", "UP", "DN", "SP", "SPU", "SPD"]

DEFAULT_CFG = {
    "windows": {"3M": {"days": 63, "weeks": 13}, "6M": {"days": 126, "weeks": 26}, "1Y": {"days": 250, "weeks": 52}},
    "baselineDays": 250, "minBaselineDays": 120, "minWindowFraction": 0.5,
    "delivBal": {"aboveA": 1.2, "belowD": 0.8}, "delivPctTrendPp": 3, "tradeSizeTrendPct": 10,
    "spike": {"minSpike": 2, "minDays": 3, "rateMult": 1.5, "upDownMult": 2},
    "weekDays": 20, "weekMargin": 2, "flipDays": 30, "flipMinIndicators": 2, "flipMinIndicatorsFull": 3,
    "fullIndicatorCount": 6, "persistent": 0.6, "stripWeeks": 52, "listSize": 25,
    "forwardHorizons": [60, 120], "minN": 30, "trackUniverse": "NIFTY500",
}
# per-window record: the order of the cells in trail/latest.json rows
WINDOW_COLS = ["codes", "delivBal", "delivPctTrend", "tradeSizeTrend", "spikeDays", "spikeUp", "spikeDn", "baseSpikeRate",
               "upCr", "dnCr", "consA", "consD", "flip", "flipSince"]


def trail_cfg(signals: dict | None = None) -> dict:
    from . import config

    sm = (signals or config.signals()).get("smartMoney", {})
    return {**DEFAULT_CFG, **sm}


# ---- matrices -------------------------------------------------------------------------------------------------------

def eligible(series, delivq, vol, trades, flags) -> np.ndarray:
    """The eligible-day mask (see the module docstring); every argument an array over rows."""
    with np.errstate(invalid="ignore"):
        return ((series == "EQ") & ~np.isnan(delivq) & (vol > 0) & (trades > 0) & ((flags.astype(np.int64) & EXCLUDED) == 0))


def build_cums(ti: np.ndarray, sj: np.ndarray, T: int, S: int, close, prev, dval, turn, trades, spike, elig) -> dict:
    """Cumulative matrices (T+1, S) of the eligible-day quantities. Row i = days 0..i-1, so a window (a, b] is C[b+1] - C[a+1]."""
    e = elig
    d = np.where(e, np.nan_to_num(dval), 0.0)
    up = e & (close > prev)
    dn = e & (close < prev)
    sp = e & ~np.isnan(spike) & (spike >= DEFAULT_CFG["spike"]["minSpike"])
    parts = {"NE": e.astype(np.float64), "DV": d, "TV": np.where(e, np.nan_to_num(turn), 0.0),
             "TR": np.where(e, np.nan_to_num(trades), 0.0), "UP": np.where(up, d, 0.0), "DN": np.where(dn, d, 0.0),
             "SP": sp.astype(np.float64), "SPU": (sp & up).astype(np.float64), "SPD": (sp & dn).astype(np.float64)}
    out = {}
    for k, v in parts.items():
        m = np.zeros((T, S))
        m[ti, sj] = v
        c = np.zeros((T + 1, S))
        np.cumsum(m, axis=0, out=c[1:])
        out[k] = c
    el = np.zeros((T, S), dtype=bool)
    el[ti, sj] = e
    out["_elig"] = el
    return out


# ---- indicators -----------------------------------------------------------------------------------------------------

def indicators(cs: dict, end, n: int, cfg: dict) -> dict:
    """The four indicators over the `n` trading days ending at each index in `end` (inclusive), vs the baseline of the
    `baselineDays` days before the window. Arrays are (P, S) with P = len(end). `codes` is (P, S, 4) of 1 / -1 / 0 / 9."""
    end = np.asarray(end, dtype=np.int64)
    B = cfg["baselineDays"]
    lo = end + 1 - n
    full = (lo >= 0)[:, None]
    lo_c = np.maximum(lo, 0)
    blo = np.maximum(lo - B, 0)

    def w(k: str) -> np.ndarray:
        return cs[k][end + 1] - cs[k][lo_c]

    def b(k: str) -> np.ndarray:
        return cs[k][lo_c] - cs[k][blo]

    nw, nb = w("NE"), b("NE")
    ok_w = full & (nw >= math.ceil(cfg["minWindowFraction"] * n))
    ok_b = ok_w & (nb >= cfg["minBaselineDays"])
    up, dn = w("UP"), w("DN")
    dvw, tvw, trw = w("DV"), w("TV"), w("TR")
    dvb, tvb, trb = b("DV"), b("TV"), b("TR")
    spw, spb, spu, spd = w("SP"), b("SP"), w("SPU"), w("SPD")
    nan = np.nan
    with np.errstate(invalid="ignore", divide="ignore"):
        bal = np.where(ok_w & (dn > 0), up / dn, nan)
        okp = ok_b & (tvw > 0) & (tvb > 0)
        dpt = np.where(okp, dvw / tvw * 100 - dvb / tvb * 100, nan)
        okt = ok_b & (trw > 0) & (trb > 0) & (tvw > 0) & (tvb > 0)
        tst = np.where(okt, ((tvw / trw) / (tvb / trb) - 1) * 100, nan)
    sp = cfg["spike"]
    # persistent: >= minDays spike days AND the window spike-day rate >= rateMult x the baseline rate (kept in integers:
    # spw / nw >= m x spb / nb  <=>  spw x nb >= m x spb x nw)
    persist = ok_b & (spw >= sp["minDays"]) & (spw * nb >= sp["rateMult"] * spb * nw)
    mult = sp["upDownMult"]
    spike_a = persist & (spu >= mult * spd) & (spu > spd)
    spike_d = persist & (spd >= mult * spu) & (spd > spu)
    c_bal = np.where(np.isnan(bal), MISSING, np.where(bal > cfg["delivBal"]["aboveA"], 1,
                                                      np.where(bal < cfg["delivBal"]["belowD"], -1, 0)))
    thr = cfg["delivPctTrendPp"]
    c_dp = np.where(np.isnan(dpt), MISSING, np.where(dpt > thr, 1, np.where(dpt < -thr, -1, 0)))
    thr = cfg["tradeSizeTrendPct"]
    c_ts = np.where(np.isnan(tst), MISSING, np.where(tst > thr, 1, np.where(tst < -thr, -1, 0)))
    c_sp = np.where(~ok_b, MISSING, np.where(spike_a, 1, np.where(spike_d, -1, 0)))
    codes = np.stack([c_bal, c_dp, c_ts, c_sp], axis=-1).astype(np.int8)
    with np.errstate(invalid="ignore", divide="ignore"):
        brate = np.where(ok_b, spb / np.where(nb > 0, nb, 1) * 100, nan)
    return {"codes": codes, "bal": bal, "dp": dpt, "ts": tst, "spn": np.where(ok_w, spw, nan),
            "spu": np.where(ok_w, spu, nan), "spd": np.where(ok_w, spd, nan), "brate": brate,
            "up": np.where(ok_w, up, nan), "dn": np.where(ok_w, dn, nan), "ok": ok_w}


def overall(codes: np.ndarray, margin: int) -> np.ndarray:
    """Week code from the indicator codes (..., 4): A when A-count - D-count >= margin, D for the reverse, else N; 9 when
    no indicator has a value."""
    a = (codes == 1).sum(axis=-1)
    d = (codes == -1).sum(axis=-1)
    known = (codes != MISSING).sum(axis=-1)
    return np.where(known == 0, MISSING, np.where(a - d >= margin, 1, np.where(d - a >= margin, -1, 0))).astype(np.int8)


def tally(codes: np.ndarray) -> dict:
    return {"A": (codes == 1).sum(axis=-1), "D": (codes == -1).sum(axis=-1), "N": (codes == 0).sum(axis=-1),
            "missing": (codes == MISSING).sum(axis=-1)}


# ---- calendar and weekly codes --------------------------------------------------------------------------------------

def week_index(days: list[str]) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """(week number of each trading day, index of the last trading day of each week, week keys), ISO weeks Mon-Sun."""
    keys: list[str] = []
    wk = np.zeros(len(days), dtype=np.int64)
    for i, d in enumerate(days):
        k = metrics.period_key(d, "w")
        if not keys or keys[-1] != k:
            keys.append(k)
        wk[i] = len(keys) - 1
    ends = np.zeros(len(keys), dtype=np.int64)
    ends[wk] = np.arange(len(days))  # later days overwrite earlier ones: the last day of each week
    return wk, ends, keys


def weekly_codes(cs: dict, days: list[str], cfg: dict, extra_points=()) -> tuple[dict, np.ndarray]:
    """Per week-end (and per extra as-of index) the 20-day indicators and overall code. Returns ({idx: row}, point indexes);
    a dict of arrays keyed by name with rows aligned to `points`."""
    wk, ends, _ = week_index(days)
    points = np.unique(np.concatenate([ends, np.asarray(list(extra_points), dtype=np.int64)]))
    ind = indicators(cs, points, cfg["weekDays"], cfg)
    ind["overall"] = overall(ind["codes"], cfg["weekMargin"])
    return ind, points


def strip_codes(ind_w: dict, points: np.ndarray, days: list[str], a: int, cfg: dict):
    """Weekly codes (n_weeks, S) of the last `stripWeeks` weeks up to as-of index `a`, the week containing `a` coded at
    `a` itself, plus the week-end dates (None for weeks before the history)."""
    wk, ends, _ = week_index(days)
    last_w = int(wk[a])
    nweeks = cfg["stripWeeks"]
    first_w = last_w - nweeks + 1
    S = ind_w["overall"].shape[1]
    out = np.full((nweeks, S), MISSING, dtype=np.int8)
    dates: list[str | None] = []
    pos = {int(p): i for i, p in enumerate(points)}
    for j, wi in enumerate(range(first_w, last_w + 1)):
        if wi < 0:
            dates.append(None)
            continue
        e = min(int(ends[wi]), a)
        out[j] = ind_w["overall"][pos[e]]
        dates.append(days[e])
    return out, dates


# ---- window metrics -------------------------------------------------------------------------------------------------

def _flip_min(cfg: dict) -> int:
    return cfg["flipMinIndicators"]  # 2 while fewer than 6 indicators exist (v1 has 4); then flipMinIndicatorsFull


def window_metrics(cs: dict, a: int, strip: np.ndarray, strip_dates: list, wname: str, cfg: dict) -> dict:
    """The window metrics of every stock at as-of index `a`: indicators, tally, consistency, flip."""
    wc = cfg["windows"][wname]
    ind = indicators(cs, [a], wc["days"], cfg)
    codes = ind["codes"][0]  # (S, 4)
    t = tally(codes)
    wk = strip[-wc["weeks"]:]  # (weeks, S)
    defined = (wk != MISSING).sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        cons_a = np.where(defined >= math.ceil(wc["weeks"] / 2), (wk == 1).sum(axis=0) / np.where(defined > 0, defined, 1) * 100, np.nan)
        cons_d = np.where(defined >= math.ceil(wc["weeks"] / 2), (wk == -1).sum(axis=0) / np.where(defined > 0, defined, 1) * 100, np.nan)
    recent = indicators(cs, [a], cfg["flipDays"], cfg)["codes"][0]
    rt = tally(recent)
    fm = _flip_min(cfg)
    leans_a = (t["A"] >= 2) & (t["A"] > t["D"])
    leans_d = (t["D"] >= 2) & (t["D"] > t["A"])
    flip = np.where(leans_a & (rt["D"] >= fm), "A→D", np.where(leans_d & (rt["A"] >= fm), "D→A", ""))
    # since: the first week of the trailing run of opposite weekly codes; with no such run, the first of the last 6 weeks
    opp = np.where(flip == "A→D", -1, 1)
    run = np.cumprod((strip[::-1] == opp[None, :]), axis=0).sum(axis=0)
    nweeks = strip.shape[0]
    first_idx = np.where(run > 0, nweeks - run, nweeks - 6)
    since = [strip_dates[int(i)] if f else "" for i, f in zip(first_idx, flip)]
    return {"ind": {k: (v[0] if v.ndim >= 2 else v) for k, v in ind.items() if k != "codes"}, "codes": codes,
            "tally": t, "consA": cons_a, "consD": cons_d, "flip": flip, "since": since, "ok": ind["ok"][0]}


def _r(x: float, dp: int):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), dp)


def window_record(m: dict, i: int):
    """One stock's [WINDOW_COLS] cells from window_metrics output, or None when the window cannot be computed."""
    if not m["ok"][i]:
        return None
    ind = m["ind"]
    return ["".join(CH[int(c)] for c in m["codes"][i]), _r(ind["bal"][i], 3), _r(ind["dp"][i], 2), _r(ind["ts"][i], 2),
            _r(ind["spn"][i], 0) if _r(ind["spn"][i], 0) is None else int(ind["spn"][i]),
            None if math.isnan(ind["spu"][i]) else int(ind["spu"][i]),
            None if math.isnan(ind["spd"][i]) else int(ind["spd"][i]),
            _r(ind["brate"][i], 1), _r(ind["up"][i], 1), _r(ind["dn"][i], 1),
            None if math.isnan(m["consA"][i]) else int(round(m["consA"][i])),
            None if math.isnan(m["consD"][i]) else int(round(m["consD"][i])),
            str(m["flip"][i]) or None, m["since"][i] or None]


def snapshot(cs: dict, days: list[str], a: int, ind_w: dict, points: np.ndarray, cfg: dict, syms: list[str],
             keep: np.ndarray | None = None) -> dict:
    """The trail document body at as-of index `a`: columns/rows for every stock eligible on that day (and in `keep`)."""
    strip, strip_dates = strip_codes(ind_w, points, days, a, cfg)
    wm = {w: window_metrics(cs, a, strip, strip_dates, w, cfg) for w in cfg["windows"]}
    elig = cs["_elig"][a]
    if keep is not None:
        elig = elig & keep
    rows = []
    for i in np.flatnonzero(elig):
        recs = [window_record(wm[w], i) for w in cfg["windows"]]
        if all(r is None for r in recs):
            continue
        rows.append([syms[i], "".join(CH[int(c)] for c in strip[:, i]), *recs])
    return {"asOf": days[a], "stripWeeks": strip_dates, "rows": rows}, wm, strip


# ---- one stock, from published symbol rows (the twin's entry point) -------------------------------------------------

def stock_arrays(rows: list[dict], days: list[str]) -> tuple[dict, int]:
    """(cums, S=1) for one stock's symbol-file rows over the market calendar `days`."""
    pos = {d: i for i, d in enumerate(days)}
    keep = [r for r in rows if r["date"] in pos]
    ti = np.array([pos[r["date"]] for r in keep], dtype=np.int64)

    def col(name: str) -> np.ndarray:
        return np.array([np.nan if r.get(name) is None else float(r[name]) for r in keep])

    series = np.array([r["series"] for r in keep], dtype=object)
    flags = np.array([int(r.get("flags") or 0) for r in keep], dtype=np.int64)
    el = eligible(series, col("delivQty"), col("vol"), col("trades"), flags)
    cs = build_cums(ti, np.zeros(len(ti), dtype=np.int64), len(days), 1, col("close"), col("prevClose"),
                    col("delivValCr"), col("turnoverCr"), col("trades"), col("spike"), el)
    return cs, 1


def trail_for_rows(rows: list[dict], days: list[str], cfg: dict | None = None, a: int | None = None) -> dict:
    """ONE stock's trail at as-of index `a` (default: the latest day): the snapshot row (strip + three window records) and
    the weekly timeline of the last `stripWeeks` weeks. Python twin of trailForRows() in site/src/lib/trail.ts."""
    cfg = cfg or trail_cfg()
    a = len(days) - 1 if a is None else a
    cs, _ = stock_arrays(rows, days)
    ind_w, points = weekly_codes(cs, days, cfg, [a])
    strip, dates = strip_codes(ind_w, points, days, a, cfg)
    wm = {w: window_metrics(cs, a, strip, dates, w, cfg) for w in cfg["windows"]}
    pos = {int(p): i for i, p in enumerate(points)}
    wk, ends, keys = week_index(days)
    timeline = []
    for j, d in enumerate(dates):
        if d is None:
            continue
        p = pos[days.index(d)]
        codes = ind_w["codes"][p, 0]
        timeline.append({
            "end": d, "key": keys[int(wk[days.index(d)])], "codes": "".join(CH[int(c)] for c in codes),
            "overall": CH[int(ind_w["overall"][p, 0])], "delivBal": _r(ind_w["bal"][p, 0], 3),
            "delivPctTrend": _r(ind_w["dp"][p, 0], 2), "tradeSizeTrend": _r(ind_w["ts"][p, 0], 2),
            "spikeDays": None if math.isnan(ind_w["spn"][p, 0]) else int(ind_w["spn"][p, 0])})
    recs = {w: window_record(wm[w], 0) for w in cfg["windows"]}
    return {"asOf": days[a], "eligible": bool(cs["_elig"][a, 0]), "strip": "".join(CH[int(c)] for c in strip[:, 0]),
            "stripWeeks": dates, "windows": recs, "timeline": timeline}
