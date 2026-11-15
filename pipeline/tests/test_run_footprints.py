"""stats/run_footprints.json against docs/research/scripts/run_footprints.py on the same store (07 section 5, DEVIATIONS #139).

Slow: runs the study script end to end (about two minutes), then compares its JSON with the shipped statistics.
Tolerances (measured on the 2026-11-15 store, see DEVIATIONS #139): medians within 0.1 (pp or x), lift cells within 0.25 pp,
run counts within 3.5%. The remaining run-count difference is documented there; the pivots of the zig-zag agree.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SHIPPED = ROOT / "site/public/data/stats/run_footprints.json"
SCRIPT = ROOT / "docs/research/scripts/run_footprints.py"
MED_TOL, LIFT_TOL, COUNT_TOL = 0.1, 0.25, 0.035


@pytest.mark.slow
@pytest.mark.skipif(not SHIPPED.exists(), reason="needs generated data (run `python -m pipeline build`); CI has none")
def test_run_footprints_reproduce_the_research_script(tmp_path):
    out = tmp_path / "study.json"
    subprocess.run([sys.executable, "-I", str(SCRIPT), str(ROOT), str(ROOT / ".history_staging"), "--json", str(out)],
                   check=True, capture_output=True, text=True, timeout=900)
    ref = json.loads(out.read_text(encoding="utf-8"))
    shipped = json.loads(SHIPPED.read_text(encoding="utf-8"))

    # run counts (the universe is the top 750 by market cap; the statistics use the same runs)
    for d in ("UP", "DOWN"):
        assert abs(shipped["runs"][d] - ref["runs"][d]) <= COUNT_TOL * ref["runs"][d], d

    med = {(r[0], r[1], r[2], r[3]): r[4] for r in shipped["medians"]["rows"]}
    checked = 0
    for name, dirs in (("pre", ("UP", "DOWN", "ORDINARY")), ("early", ("UP", "DOWN"))):
        for feature, by_dir in ref["pre" if name == "pre" else "early"].items():
            for d in dirs:
                if d not in by_dir:
                    continue
                key = (name, d if d != "ORDINARY" else "ORDINARY", "ALL", feature)
                if key not in med or med[key] is None:
                    continue
                assert abs(med[key] - by_dir[d]) <= MED_TOL, (key, med[key], by_dir[d])
                checked += 1
    assert checked >= 20

    # lift tables: P(big up) and P(big down) by quintile, 20 days, entry at close(t+1)
    lift = {(r[0], r[1], r[2]): (r[4], r[5]) for r in shipped["lift"]["rows"]}
    for feature, quints in ref["lift"].items():
        for q, (up, dn) in enumerate(quints, start=1):
            got = lift[(20, feature, q)]
            assert abs(got[0] - up) <= LIFT_TOL and abs(got[1] - dn) <= LIFT_TOL, (feature, q, got, up, dn)
    assert abs(shipped["lift"]["base"]["bigUpPct"] - ref["base"]["bigUp"]) <= LIFT_TOL
    assert abs(shipped["lift"]["base"]["bigDownPct"] - ref["base"]["bigDown"]) <= LIFT_TOL
