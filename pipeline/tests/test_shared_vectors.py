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
    # sym -> {day: (delivValCr, turnoverCr, close)}; B lists on day 12, C is absent in the baseline, D is illiquid
    spec = {"AAA": (1, 100.0, 40.0), "BBB": (12, 50.0, 20.0), "CCC": (21, 80.0, 30.0), "DDD": (1, 0.5, 0.2),
            "EEE": (1, 60.0, 25.0)}
    daily: dict[str, dict[int, tuple[float, float, float]]] = {}
    for sym, (first, tv, dv) in spec.items():
        rows, close = {}, 100.0
        for d in DAYS:
            if d < first or (sym == "EEE" and d % 3 == 0 and d > 10):  # EEE skips some days (low coverage)
                continue
            close *= 1 + rng.uniform(-0.03, 0.04)
            t = tv * rng.uniform(0.7, 1.4)
            rows[d] = (round(t * min(0.95, dv / tv * rng.uniform(0.8, 1.3)), 4), round(t, 4), round(close, 2))
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
                        "cDelivQty": 0, "cVol": 0, "cDays": len(upto)})
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
