"""Shared test vectors for the range maths (04 intro): Python exports them, Vitest consumes them.

Expected values are computed directly from synthetic daily rows (not from the cum files), so this also checks the
cum-file shortcut X(b) - X(prev(a)) against a plain sum.
"""

import json
import random
from pathlib import Path

import pytest

from pipeline import metrics

VECTORS = Path(__file__).resolve().parents[2] / "site" / "src" / "lib" / "vectors.json"
DAYS = list(range(1, 31))
R_DAYS = list(range(21, 31))
B_DAYS = list(range(11, 21))


def build_vectors() -> dict:
    rng = random.Random(7)
    # sym -> {day: (delivValCr, turnoverCr, close, up-day delivValCr, down-day delivValCr, trades)}; B lists on day 12, C is absent in the baseline, D is illiquid
    spec = {"AAA": (1, 100.0, 40.0), "BBB": (12, 50.0, 20.0), "CCC": (21, 80.0, 30.0), "DDD": (1, 0.5, 0.2),
            "EEE": (1, 60.0, 25.0)}
    daily: dict[str, dict[int, tuple[float, float, float, float, float, int]]] = {}
    for sym, (first, tv, dv) in spec.items():
        rows, close = {}, 100.0
        for d in DAYS:
            if d < first or (sym == "EEE" and d % 3 == 0 and d > 10):  # EEE skips some days (low coverage)
                continue
            before = close
            close *= 1 + rng.uniform(-0.03, 0.04)
            t = tv * rng.uniform(0.7, 1.4)
            dval = round(t * min(0.95, dv / tv * rng.uniform(0.8, 1.3)), 4)
            rows[d] = (dval, round(t, 4), round(close, 2), dval if round(close, 2) > round(before, 2) else 0.0,
                       dval if round(close, 2) < round(before, 2) else 0.0, int(t * 25))
        daily[sym] = rows

    def cum(day: int) -> list[dict]:
        out = []
        for sym, rows in daily.items():
            upto = [(d, v) for d, v in rows.items() if d <= day]
            if not upto:
                continue
            out.append({"sym": sym, "lastClose": upto[-1][1][2], "lastTradeDate": f"d{upto[-1][0]}",
                        "cDelivValCr": round(sum(v[0] for _, v in upto), 4),
                        "cTurnoverCr": round(sum(v[1] for _, v in upto), 4),
                        "cDelivQty": 0, "cVol": 0, "cDays": len(upto),
                        "cDelivValUpCr": round(sum(v[3] for _, v in upto), 4),
                        "cDelivValDnCr": round(sum(v[4] for _, v in upto), 4), "cTrades": sum(v[5] for _, v in upto)})
        return out

    opts = {"tradingDaysR": len(R_DAYS), "tradingDaysB": len(B_DAYS), "minBaseDelivValCr": 0.5,
            "minTurnoverAvg20Cr": 1.0}
    cum_a0, cum_a1, cum_b0, cum_b1 = cum(R_DAYS[0] - 1), cum(R_DAYS[-1]), cum(B_DAYS[0] - 1), cum(B_DAYS[-1])
    got = metrics.range_metrics(cum_a0, cum_a1, cum_b0, cum_b1, opts["tradingDaysR"], opts["tradingDaysB"],
                                opts["minBaseDelivValCr"], opts["minTurnoverAvg20Cr"])
    # independent expectation straight from the daily rows
    for g in got:
        rows = daily[g["sym"]]
        r = [rows[d] for d in R_DAYS if d in rows]
        b = [rows[d] for d in B_DAYS if d in rows]
        assert g["nR"] == len(r)
        assert g["avgDelivValR"] == pytest.approx(sum(x[0] for x in r) / len(r), abs=1e-3)
        if r:
            up, dn = sum(x[3] for x in r), sum(x[4] for x in r)
            assert g["delivBalanceR"] == (pytest.approx(up / dn, abs=1e-3) if dn > 0 else None)
            assert g["avgTradeSizeR"] == pytest.approx(sum(x[1] for x in r) * 1e7 / sum(x[5] for x in r), rel=1e-6)
        if b:
            assert g["delivPctWB"] == pytest.approx(sum(x[0] for x in b) / sum(x[1] for x in b) * 100, abs=1e-3)
        last = rows[R_DAYS[-1]][2] if R_DAYS[-1] in rows else [rows[d] for d in rows if d <= R_DAYS[-1]][-1][2]
        prior = [rows[d] for d in rows if d <= R_DAYS[0] - 1]
        if prior:
            assert g["ret"] == pytest.approx((last / prior[-1][2] - 1) * 100, abs=1e-3)
        else:
            assert g["ret"] is None and g["listedDuringRange"]
    return {"opts": opts, "cumA0": cum_a0, "cumA1": cum_a1, "cumB0": cum_b0, "cumB1": cum_b1,
            "expected": json.loads(json.dumps(got))}


def test_range_vectors_hold_and_file_is_current():
    vec = build_vectors()
    by = {e["sym"]: e for e in vec["expected"]}
    assert by["BBB"]["listedDuringRange"] is False and by["CCC"]["listedDuringRange"] is True
    assert by["CCC"]["excluded"] is True  # no baseline data at all
    assert by["DDD"]["excluded"] is True  # baseline turnover below the floor
    assert by["AAA"]["excluded"] is False
    text = json.dumps(vec, indent=1, sort_keys=True) + "\n"
    VECTORS.parent.mkdir(parents=True, exist_ok=True)
    if not VECTORS.exists() or VECTORS.read_text(encoding="utf-8") != text:
        VECTORS.write_text(text, encoding="utf-8", newline="\n")  # regenerate; commit the new file


# ---- period aggregation vectors (08 section 6): aggregatePeriods / aggregateRange, Python twin vs TypeScript ----------

PERIOD_VECTORS = Path(__file__).resolve().parents[2] / "site" / "src" / "lib" / "periodVectors.json"


def _calendar() -> list[str]:
    from datetime import date, timedelta

    holidays = {"2026-02-27", "2026-04-03", "2026-05-01"}
    out, d = [], date(2026, 1, 5)
    while len(out) < 148:
        if d.weekday() < 5 and d.isoformat() not in holidays:
            out.append(d.isoformat())
        if d.isoformat() == "2026-03-06":
            out.append("2026-03-08")  # a Sunday session sits inside its ISO week
        d += timedelta(days=1)
    return sorted(out)


def build_period_vectors() -> dict:
    import numpy as np

    from pipeline import config

    settings, signals = config.settings(), config.signals()
    days = _calendar()
    # end mid-week so the newest week, month and quarter are partial
    while __import__("datetime").date.fromisoformat(days[-1]).weekday() != 2:
        days.pop()
    rng = np.random.default_rng(11)
    specs = {"AAA": dict(first=0, split=None), "BBB": dict(first=0, split=70), "CCC": dict(first=40, split=None, tiny=True)}
    stocks: dict[str, list[dict]] = {}
    for sym, sp in specs.items():
        rows, px = [], 100.0 * (1 if sym != "BBB" else 10)
        for i, d in enumerate(days):
            if i < sp["first"]:
                continue
            if sym == "BBB" and 20 <= i < 60 and i % 4 == 0:
                continue  # a stock that trades only some days
            pc = px
            px *= 1 + float(rng.uniform(-0.03, 0.035))
            if sp["split"] == i:
                px *= 0.5  # 1:2 split: NSE keeps prevClose raw
            o = round(pc * float(rng.uniform(0.99, 1.01)), 2)
            h = round(max(o, px) * float(rng.uniform(1.0, 1.02)), 2)
            lo = round(min(o, px) * float(rng.uniform(0.98, 1.0)), 2)
            c, vwap = round(px, 2), round((h + lo) / 2, 2)
            vol = int(rng.integers(50_000, 400_000)) * (3 if i % 37 == 0 else 1)
            dq = int(vol * float(rng.uniform(0.25, 0.7)))
            if sp.get("tiny"):
                vol, dq = vol // 400, dq // 400
            series = "BE" if sym == "BBB" and 100 <= i < 105 else "EQ"
            rows.append({"date": d, "series": series, "open": o, "high": h, "low": lo, "close": c,
                         "prevClose": round(pc, 2), "vwap": vwap, "vol": vol,
                         "turnoverCr": round(vol * vwap / 1e7, 4), "trades": int(vol // 40) + 3,
                         "delivQty": None if series == "BE" else dq, "flags": 1 if series == "BE" else (64 if i % 53 == 0 else 0)})
        stocks[sym] = rows
    cfg = {"minPeriodsFraction": settings["minPeriodsFraction"], "liquidity": settings["liquidity"],
           "periods": {tf: {**metrics.DEFAULT_PERIOD_CFG[tf], **signals["periods"][tf]} for tf in ("w", "m", "q")}}
    sets, sigs = {k: v for k, v in cfg.items() if k != "periods"}, {"periods": cfg["periods"]}
    ranges = [(days[10], days[30]), (days[60], days[90]), (days[3], days[-1])]
    expected = {}
    for sym, rows in stocks.items():
        e = {tf: metrics.aggregate_periods(rows, tf, days, sets, sigs) for tf in ("w", "m", "q")}
        e["n7"] = metrics.aggregate_periods(rows, ("n", 7), days, sets, sigs)
        e["ranges"] = [{"a": a, "b": b, "expected": metrics.aggregate_range(rows, a, b)} for a, b in ranges]
        expected[sym] = e
    return {"config": cfg, "tradingDays": days, "stocks": stocks, "expected": json.loads(json.dumps(expected))}


def test_period_vectors_cover_the_cases_and_file_is_current():
    vec = build_period_vectors()
    e = vec["expected"]
    assert any(p["partial"] for p in e["AAA"]["w"]) and e["AAA"]["w"][-1]["partial"] and e["AAA"]["m"][-1]["partial"]
    assert any(p["adjusted"] == 1 for p in e["BBB"]["w"]) and any(p["signal"] for k in e for p in e[k]["w"])
    assert e["BBB"]["w"][0]["key"] == "2026-W02" and any(p["daysIn"] == 6 and p["end"] == "2026-03-08" and not p["partial"] for p in e["AAA"]["w"])
    assert all(r["expected"] is not None for r in e["AAA"]["ranges"])
    text = json.dumps(vec, sort_keys=True, separators=(",", ":")) + "\n"
    if not PERIOD_VECTORS.exists() or PERIOD_VECTORS.read_text(encoding="utf-8") != text:
        PERIOD_VECTORS.write_text(text, encoding="utf-8", newline="\n")  # regenerate; commit the new file
