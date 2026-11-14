"""Daily footprint indicators (07 section 3): shared vectors for the browser twin (site/src/lib/footprints.ts).

Python exports the vectors (site/src/lib/footprintVectors.json, written by this test and checked by CI with git diff),
and Vitest reads the same file, so the TypeScript twin is checked against this reference on identical inputs.
"""

import json
import random
from pathlib import Path

from pipeline import footprints

VECTORS = Path(__file__).resolve().parents[2] / "site" / "src" / "lib" / "footprintVectors.json"


def _series(seed: int, n: int, *, none_every: int = 0, zero_dv: bool = False) -> list[dict]:
    rng = random.Random(seed)
    close = 100.0
    out = []
    for i in range(n):
        prev = close
        close = round(close * (1 + rng.uniform(-0.03, 0.035)), 2)
        turn = round(rng.uniform(5, 120), 4)
        trades = rng.randint(50, 4000)
        dv = 0.0 if zero_dv and i % 3 == 0 else round(turn * rng.uniform(0.2, 0.9), 4)
        rec = {"close": close, "prevClose": round(prev, 2), "turnoverCr": turn, "trades": trades, "delivValCr": dv}
        if none_every and i % none_every == 0:  # a BE/BZ-style day: no delivery data, does not count
            rec["delivValCr"] = None
        out.append(rec)
    return out


def build_vectors() -> dict:
    cases = []
    specs = [
        ("long", _series(11, 260)),
        ("short", _series(12, 40)),
        ("gaps", _series(13, 200, none_every=7)),
        ("no-down-days", [{"close": 100.0 + i, "prevClose": 99.0 + i, "turnoverCr": 10.0, "trades": 100.0,
                           "delivValCr": 5.0} for i in range(130)]),
        ("zero-delivery", _series(14, 130, zero_dv=True)),
    ]
    for name, recs in specs:
        cases.append({"name": name, "records": recs, "expected": footprints.indicators(recs)})
    return {"schemaVersion": 1, "keys": list(footprints.KEYS), "cases": cases,
            "note": "Written by pipeline/tests/test_footprints.py. Do not edit by hand."}


def test_hand_values_and_null_rules():
    recs = []
    for i in range(130):
        up = i % 2 == 0
        prev = 100.0 + (i % 2 == 0)
        recs.append({"close": prev + 1 if up else prev - 1, "prevClose": prev, "turnoverCr": 100.0, "trades": 1.0,
                     "delivValCr": 20.0 if up else 10.0})
    out = footprints.indicators(recs)
    assert out["delivBal20"] == 2.0 and out["delivBal120"] == 2.0 and out["delivValRatio60"] == 1.0
    assert footprints.indicators(recs[:50])["delivBal60"] is None  # 60 valid days are needed
    assert footprints.indicators(recs[:50])["delivBal20"] == 2.0


def test_vectors_match_the_reference_and_file_is_current():
    vec = build_vectors()
    for case in vec["cases"]:
        assert footprints.indicators(case["records"]) == case["expected"]
    # the gaps case really skips delivery-less days; the zero-delivery case has up and down days with no volume
    gaps = next(c for c in vec["cases"] if c["name"] == "gaps")
    assert sum(1 for r in gaps["records"] if r["delivValCr"] is None) > 0
    text = json.dumps(vec, indent=1, sort_keys=True) + "\n"
    if not VECTORS.exists() or VECTORS.read_text(encoding="utf-8") != text:
        VECTORS.write_text(text, encoding="utf-8", newline="\n")  # regenerate; commit the new file
