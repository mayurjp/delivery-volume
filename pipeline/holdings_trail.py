"""Phase 4B trail indicators from quarterly holdings (07 6A, 07 6 thresholds in config/signals.json -> smartMoney).

* holdInst: FII + DII holding change over the last two quarters, in pp. MF is inside DII (03 5.10), so it is not added
  again (DEVIATIONS #100).
* holdPromoter: promoter holding change over the last two quarters, in pp. Promoter selling is a D.

No lookahead (07 6A): a filing counts only from its broadcastDate. For an as-of day, the latest quarter is the newest
quarter with a filing broadcast on or before that day, and the base is the quarter two steps earlier in the quarter
list. Both must be known on that day, or the code is missing.
"""

from __future__ import annotations

MISSING = 9  # the same "not enough history" code as trail.py
GROUPS = {
    "holdInst": lambda cats: cats.get("fiiPct", 0.0) + cats.get("diiPct", 0.0),
    "holdPromoter": lambda cats: cats.get("promoterPct", 0.0),
}


def _pct(filing: dict) -> dict[str, float]:
    """Grouped % of one filing: from the stored extract (`categories`, the 03 5.10 groupings applied here), or from a
    symbol-file holdings row (already grouped: promoterPct, fiiPct, diiPct, mfPct), so both twins read the same values."""
    if "categories" in filing:
        from .build.holdings import groupings

        return groupings({k: float(v["pct"]) for k, v in filing["categories"].items()})
    return {k: float(filing[k]) for k in ("promoterPct", "fiiPct", "diiPct") if filing.get(k) is not None}


def known_filings(filings: list[dict], asof: str) -> dict[str, dict]:
    """quarter -> filing, for the filings broadcast on or before `asof` (ISO day). A revision replaces the original
    only once it is broadcast (the latest broadcast known that day wins)."""
    out: dict[str, dict] = {}
    for f in filings:
        bd = (f.get("filedOn") or "")
        if not bd or bd > asof:  # no lookahead: not yet broadcast on the as-of day
            continue
        q = f["quarter"]
        if q not in out or (f.get("broadcastDate") or "") > (out[q].get("broadcastDate") or ""):
            out[q] = f
    return out


def holding_change(filings: list[dict], asof: str, quarters: list[str], group: str) -> float | None:
    """Change in pp over the last two quarters as known on `asof`; None when either quarter is not known."""
    known = known_filings(filings, asof)
    if not known:
        return None
    qs = sorted(quarters)
    latest = max(known)  # the newest quarter filed so far
    i = qs.index(latest)
    if i < 2:
        return None
    base = qs[i - 2]
    if base not in known:
        return None
    fn = GROUPS[group]
    return round(fn(_pct(known[latest])) - fn(_pct(known[base])), 6)


def code(change: float | None, cfg: dict, group: str) -> int:
    """A (+1) above aboveA, D (-1) below belowD, N (0) between, MISSING when there is no change."""
    if change is None:
        return MISSING
    t = cfg[group]
    return 1 if change > t["aboveA"] else (-1 if change < t["belowD"] else 0)


def flip_min(n_indicators: int, cfg: dict) -> int:
    """07 6A v1: flipMinIndicators is 2 while fewer than 6 indicators exist, and 3 from 6 on."""
    return cfg["flipMinIndicatorsFull"] if n_indicators >= cfg["fullIndicatorCount"] else cfg["flipMinIndicators"]


def holding_codes(filings: list[dict], asof: str, quarters: list[str], cfg: dict) -> dict[str, int]:
    """Both holdings codes for one stock on one as-of day."""
    return {g: code(holding_change(filings, asof, quarters, g), cfg, g) for g in GROUPS}


def hold_series(filings: list[dict], days: list[str], quarters: list[str], cfg: dict):
    """(codes, pp) for one stock over the market calendar `days`: codes (T, 2) int8 in GROUPS order (holdInst,
    holdPromoter) and pp (T, 2) float (NaN where the change is missing). Known filings change only on their filedOn
    day, so each day takes the value of the last such change on or before it (no lookahead)."""
    import bisect

    import numpy as np

    T = len(days)
    codes = np.full((T, len(GROUPS)), MISSING, dtype=np.int8)
    pp = np.full((T, len(GROUPS)), np.nan)
    changes = sorted({f["filedOn"] for f in filings if f.get("filedOn")})
    if not changes:
        return codes, pp
    last_k, cur = None, None
    for i, d in enumerate(days):
        k = bisect.bisect_right(changes, d)
        if k != last_k:
            cur = {}
            for g in GROUPS:
                ch = holding_change(filings, d, quarters, g)
                cur[g] = (code(ch, cfg, g), np.nan if ch is None else ch)
            last_k = k
        for j, g in enumerate(GROUPS):
            codes[i, j], pp[i, j] = cur[g]
    return codes, pp


def hold_matrices(filings_by_sym: dict[str, list[dict]], syms: list[str], days: list[str], quarters: list[str], cfg: dict):
    """(codes (T, S, 2), pp (T, S, 2)) for the trail's cumulative-matrix inputs; stocks without filings stay MISSING."""
    import numpy as np

    T, S = len(days), len(syms)
    codes = np.full((T, S, len(GROUPS)), MISSING, dtype=np.int8)
    pp = np.full((T, S, len(GROUPS)), np.nan)
    for j, sym in enumerate(syms):
        fl = filings_by_sym.get(sym)
        if fl:
            codes[:, j, :], pp[:, j, :] = hold_series(fl, days, quarters, cfg)
    return codes, pp
