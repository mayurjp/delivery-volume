"""Daily footprint indicators (docs/specs/07-run-forensics.md section 3): a pure reference for the browser.

They are NOT stored in daily/ or symbols/ (DEVIATIONS #139: about 30-40 MB). The Stock page's Footprints pane computes
them from the symbol rows with a TypeScript twin (site/src/lib/footprints.ts), which must match this module on the
shared vectors in site/src/lib/footprintVectors.json (written by pytest, tests/test_footprints.py).

Input: one record per trading day in date order, with the symbol-row fields close, prevClose, turnoverCr, trades,
delivValCr (None on a day without delivery data, such as BE/BZ days). Only days with delivery data count.

Definitions (windows count valid delivery days, newest last):
  delivBal{N}      sum of delivValCr on up days / sum on down days, over the last N valid days (N = 20, 60, 120).
                   Up means close > prevClose, down means close < prevClose: the raw rule of cDelivValUpCr/DnCr (trail).
  delivValRatio60  mean delivValCr over the last 20 valid days / mean over the 60 valid days before those.
  tradeSizeRatio60 average trade size (sum of turnoverCr / sum of trades, Rs Cr per trade) over the last 20 valid days
                   / the same over the 60 before. Ratio of sums, never an average of ratios.
  delivPctTrend    delivery % over the last 20 valid days minus the same over the last 120 (percentage points), with
                   delivery % = sum delivValCr / sum turnoverCr x 100.
A value is None when its window is incomplete or its denominator is zero. Results are rounded to 3 dp (ratios) and 2 dp
(pp), so the twin compares rounded numbers.
"""

from __future__ import annotations

from typing import Iterable

KEYS = ("delivBal20", "delivBal60", "delivBal120", "delivValRatio60", "tradeSizeRatio60", "delivPctTrend")


def _valid(records: Iterable[dict]) -> list[dict]:
    return [r for r in records if r.get("delivValCr") is not None and r.get("turnoverCr") is not None]


def _bal(rows: list[dict], n: int) -> float | None:
    if len(rows) < n:
        return None
    win = rows[-n:]
    up = sum(r["delivValCr"] for r in win if r["close"] > r["prevClose"])
    dn = sum(r["delivValCr"] for r in win if r["close"] < r["prevClose"])
    if dn <= 0:
        return None
    return round(up / dn, 3)


def _sum(rows: list[dict], key: str) -> float:
    return float(sum(r[key] for r in rows))


def indicators(records: list[dict]) -> dict:
    """The six daily footprint indicators on the last record of `records` (all windows end on the last valid day)."""
    rows = _valid(records)
    out: dict[str, float | None] = {k: None for k in KEYS}
    out["delivBal20"] = _bal(rows, 20)
    out["delivBal60"] = _bal(rows, 60)
    out["delivBal120"] = _bal(rows, 120)
    if len(rows) >= 80:
        last20, prior60 = rows[-20:], rows[-80:-20]
        m_last = _sum(last20, "delivValCr") / 20
        m_prior = _sum(prior60, "delivValCr") / 60
        if m_prior > 0:
            out["delivValRatio60"] = round(m_last / m_prior, 3)
        ts_last = _sum(last20, "turnoverCr") / _sum(last20, "trades") if _sum(last20, "trades") > 0 else None
        ts_prior = _sum(prior60, "turnoverCr") / _sum(prior60, "trades") if _sum(prior60, "trades") > 0 else None
        if ts_last is not None and ts_prior:
            out["tradeSizeRatio60"] = round(ts_last / ts_prior, 3)
    if len(rows) >= 120:
        d20, t20 = _sum(rows[-20:], "delivValCr"), _sum(rows[-20:], "turnoverCr")
        d120, t120 = _sum(rows[-120:], "delivValCr"), _sum(rows[-120:], "turnoverCr")
        if t20 > 0 and t120 > 0:
            out["delivPctTrend"] = round(d20 / t20 * 100 - d120 / t120 * 100, 2)
    return out
