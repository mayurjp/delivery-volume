"""signal_perf: unit check on a tiny hand-computed frame, and the replication check (04 section 6, 06 Phase 3):
the shipped stats/signal_perf.json must match the research scripts' printed output, programmatically, on the same
store and with the same entry timing."""

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pipeline.build import columns as C
from pipeline.build import signal_perf

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "site/public/data"
SCRIPTS = ROOT / "docs/research/scripts"


def test_hand_computed_excess_and_adjustment_drop():
    days = [f"2026-01-{d:02d}" for d in range(1, 8)]
    closes = {"A": [100, 110, 121, 121, 121, 121, 121], "B": [100, 100, 100, 100, 100, 100, 100],
              "C": [100, 90, 90, 90, 90, 90, 90]}
    rows = []
    for s, cl in closes.items():
        for i, d in enumerate(days):
            rows.append({"sym": s, "date": d, "series": "EQ", "close": float(cl[i]),
                         "prevClose": float(cl[i - 1]) if i else float(cl[0]), "spike": 3.0 if (s == "A" and i == 0) else 1.0,
                         "ret1": 0.0, "streak": 0, "delivPctZ60": 0.0, "signal": "ACC" if (s == "A" and i == 0) else None, "flags": 0})
    df = pd.DataFrame(rows)
    uni = pd.DataFrame({"sym": list(closes), "bucket": ["L", "L", "L"], "idx": [0, 0, 0]})
    out = signal_perf.compute(df, days, uni, 3)
    got = {(r[0], r[1], r[2], r[3]): r for r in out["rows"]}
    # event A on day 0, entry t0, +1d: A +10%, B 0%, C -10% -> median 0 -> excess +10
    r = got[("ACC", "ALL", "t0", 1)]
    assert (r[4], r[5], r[7], r[9]) == (1, 1, 10.0, 100.0)
    # entry t1, +1d: close(2)/close(1) = +10% for A, 0 for B, 0 for C -> median 0 -> excess +10
    assert got[("ACC", "ALL", "t1", 1)][7] == 10.0
    # +20d: window runs off the end of the data -> no observation
    assert got[("ACC", "ALL", "t0", 20)][5] == 0


def _run(*args) -> str:
    return subprocess.run([sys.executable, "-I", *map(str, args)], capture_output=True, text=True, check=True,
                          timeout=600).stdout


def _cell(text: str):
    m = re.search(r"([+-]\d+\.\d+)\s+(\d+)%", text)
    return (float(m.group(1)), float(m.group(2))) if m else None


def _lines(out: str):
    """(name, n, days, [cell...]) for every printed table row of signal_fwd*.py."""
    for ln in out.splitlines():
        parts = ln.split("|")
        head = re.match(r"^\s*(.*\S)\s+(\d+)\s+(\d+)\s*$", parts[0])
        if len(parts) >= 3 and head:
            yield head.group(1), int(head.group(2)), parts[1:]


FWD2 = {
    **{f"[{lab}] {code}": (code, g) for g, lab in (("L", "Large 1-100"), ("M", "Mid 101-250"), ("S", "Small 251-500"),
                                                  ("U", "Micro 501+")) for code in ("ACC", "ABS", "DIS", "SPU")},
    "ACC accumulation": ("ACC", "IDX:NIFTY200"), "ABS absorption": ("ABS", "IDX:NIFTY200"),
    "DIS distribution": ("DIS", "IDX:NIFTY200"), "SPU speculative rise": ("SPU", "IDX:NIFTY200"),
    "Delivery >=2x & price up >=1%": ("UPSPIKE", "IDX:NIFTY200"),
    "streak hits 5, any price": ("STREAK5", "ALL"), "streak hits 5, price up over last 5 days": ("STREAK5_UP", "ALL"),
    "streak hits 10, any price": ("STREAK10", "ALL"), "streak hits 10, price up over last 5 days": ("STREAK10_UP", "ALL"),
    "streak hits 5, price up 5d, Nifty 200 only": ("STREAK5_UP", "IDX:NIFTY200"),
    "streak hits 10, price up 5d, Nifty 200 only": ("STREAK10_UP", "IDX:NIFTY200"),
    "all 52-week-high breakouts": ("BO_ALL", "ALL"), "breakout on LOW delivery (spike < 1)": ("BO_LOW", "ALL"),
    "breakout + delivery >=2x normal": ("BO_HEAVY", "ALL"),
    "breakout + delivery >=2x, Nifty 200 only": ("BO_HEAVY", "IDX:NIFTY200"),
    "breakout on low delivery, Nifty 200 only": ("BO_LOW", "IDX:NIFTY200"),
}
FWD1 = {"ACC": "ACC", "DIS": "DIS", "ABS": "ABS", "SPU": "SPU", "SPD": "SPD",
        "Delivery spike >=2x, price up >=1%": "UPSPIKE", "Delivery spike >=2x, price down <=-1%": "DNSPIKE"}


@pytest.fixture(scope="module")
def shipped():
    p = DATA / "stats/signal_perf.json"
    if not p.exists():
        pytest.skip("no generated data")
    doc = json.loads(p.read_text(encoding="utf-8"))
    return {(r[0], r[1], r[2], r[3]): dict(zip(doc["columns"], r)) for r in doc["rows"]}


def _compare(shipped, event, group, entry, horizon, n, cell, who):
    row = shipped[(event, group, entry, horizon)]
    assert row["events"] == n, f"{who}: {event}/{group} events {row['events']} != {n}"
    if cell is None:  # script prints n<30
        assert row["n"] < signal_perf.MIN_N, f"{who}: {event}/{group}/{horizon}d expected a thin cell"
        return 0
    med, hit = cell
    assert abs(row["medianExcess"] - med) <= 0.1, f"{who}: {event}/{group}/{entry}/{horizon}d median {row['medianExcess']} vs {med}"
    assert np.sign(row["medianExcess"]) == np.sign(med) or abs(med) < 0.1
    assert abs(row["hitRate"] - hit) <= 1.0, f"{who}: {event}/{group}/{entry}/{horizon}d hit {row['hitRate']} vs {hit}"
    return 1


@pytest.mark.slow
@pytest.mark.skipif(not (DATA / "stats/signal_perf.json").exists(), reason="needs generated data")
def test_signal_perf_replicates_research_scripts(shipped):
    checked = 0
    out = _run(SCRIPTS / "signal_fwd.py", DATA / "daily")
    for name, n, cells in _lines(out):
        code = next((v for k, v in FWD1.items() if name.startswith(k)), None)
        if code is None:
            continue
        for horizon, cell in zip((1, 5, 20), cells):
            m = re.findall(r"[+-]\d+\.\d+|\d+(?=%)", cell)
            checked += _compare(shipped, code, "ALL", "t0", horizon, n, (float(m[1]), float(m[2])) if len(m) == 3 else None,
                                "signal_fwd.py")
    for lag, entry in ((0, "t0"), (1, "t1")):
        out = _run(SCRIPTS / "signal_fwd2.py", ROOT, lag)
        seen = 0
        for name, n, cells in _lines(out):
            if name not in FWD2:
                continue
            seen += 1
            event, group = FWD2[name]
            for horizon, cell in zip((5, 20), cells):
                checked += _compare(shipped, event, group, entry, horizon, n, _cell(cell), f"signal_fwd2.py {lag}")
        assert seen == len(FWD2), f"signal_fwd2.py lag {lag}: parsed {seen} of {len(FWD2)} rows"
    assert checked >= 140, f"only {checked} cells compared"


def test_flag_bit_used_for_breakouts():
    assert C.FLAG["high52"] == 64
