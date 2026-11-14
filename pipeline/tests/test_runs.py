"""Run forensics (07 sections 1 to 5), fast tests on synthetic series and committed fixtures: zig-zag pivots with a known
answer, the split adjustment and the notSplits demerger, the no-hindsight rule (features use data <= t, the entry is
close(t+1)), the daily footprint reference, the board-meetings parser and the holdings change rule."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from pipeline import footprints, metrics
from pipeline import runs as R
from pipeline.build import run_outputs
from pipeline.build.schema import validate
from pipeline.sources import s4_pr_zip as s4

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _days(n: int) -> list[str]:
    start = pd.Timestamp("2025-01-01")
    out = []
    d = start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.strftime("%Y-%m-%d"))
        d += pd.Timedelta(days=1)
    return out


def _frame(sym: str, days: list[str], closes, dq: float = 1000.0, flags: int = 0) -> pd.DataFrame:
    """EQ rows with valid delivery: delivery value = close x quantity / 1e7, turnover 100 Cr, 1,000 trades."""
    c = np.asarray(closes, dtype=float)
    return pd.DataFrame({
        "sym": sym, "date": days, "series": "EQ", "close": c, "prevClose": np.r_[c[0], c[:-1]],
        "delivQty": dq, "delivValCr": c * dq / 1e7, "turnoverCr": 100.0, "trades": 1000.0, "flags": flags,
    })


def _path(points: list[tuple[int, float]], n: int) -> np.ndarray:
    """Piecewise-linear closes through (day, close) points, flat before the first and after the last point."""
    xs, ys = zip(*points)
    return np.interp(np.arange(n), xs, ys)


# The known path: flat 100 to day 84, up to 130 at day 94, down to 100 at day 104, up to 140 at day 114, flat to the end.
KNOWN = [(0, 100), (84, 100), (94, 130), (104, 100), (114, 140), (150, 140)]
N = 160


def _grids(closes, sym="AAA", notsplits=None):
    days = _days(N)
    df = _frame(sym, days, closes)
    return R.build_grids(df, days, [sym], notsplits or []), days


def test_zigzag_finds_the_known_pivots():
    g, days = _grids(_path(KNOWN, N))
    runs = R.detect_runs(g, R.run_cfg(None))
    # the first leg starts at day 0 (before day 79) and is excluded; the two legs from day 94 are the runs. The price
    # then stays at 140, and a tie moves the extreme to the latest equal day (the study's rule), so the UP leg ends at 159
    got = [(r.dir, r.s, r.e, round(r.move, 2)) for r in runs.itertuples()]
    assert got == [("DOWN", 94, 104, -23.08), ("UP", 104, N - 1, 40.0)]
    assert runs.iloc[0]["start"] == days[94] and runs.iloc[0]["end"] == days[104]
    assert runs.iloc[1]["end"] == days[114] or runs.iloc[1]["e"] == N - 1


def test_run_thresholds_and_minimum_days():
    # the 100 -> 115 rise is a 15% leg: below minMovePct 20, so no UP run. The 115 -> 75 fall is 35% over 13 days: a DOWN run.
    p = [(0, 100), (84, 100), (94, 115), (104, 100), (107, 75), (150, 75)]
    g, _ = _grids(_path(p, N))
    runs = R.detect_runs(g, R.run_cfg(None))
    assert all(abs(m) >= 20 for m in runs["move"]) and all(d >= 5 for d in runs["days"])
    assert not any(r.dir == "UP" for r in runs.itertuples())
    down = [r for r in runs.itertuples() if r.dir == "DOWN"]
    assert len(down) == 1 and down[0].s == 94 and round(down[0].move, 1) == -34.8
    # a 4-day fall of 30% is below minDays 5: no run
    short = [(0, 100), (84, 100), (94, 100), (98, 70), (150, 70)]
    g2, _ = _grids(_path(short, N))
    assert len(R.detect_runs(g2, R.run_cfg(None))) == 0


def test_split_is_adjusted_and_creates_no_run():
    closes = _path(KNOWN, N)
    split = closes.copy()
    split[100:] = split[100:] * 0.5  # a 1:2 split on day 100: the raw close halves
    base, _ = _grids(closes)
    adjusted, _ = _grids(split)
    a = R.detect_runs(base, R.run_cfg(None))
    b = R.detect_runs(adjusted, R.run_cfg(None))
    assert [(r.dir, r.s, r.e) for r in a.itertuples()] == [(r.dir, r.s, r.e) for r in b.itertuples()]
    np.testing.assert_allclose(a["move"].to_numpy(), b["move"].to_numpy(), rtol=1e-9)
    # the adjustment factor is the exact 1:2 ratio on the rows before the split, and 1 after it
    days = _days(N)
    fac = metrics.price_adjustment(np.array(["AAA"] * N, dtype=object), split, np.array(days, dtype=object), [])
    assert np.isclose(fac[99], 0.5) and np.isclose(fac[100], 1.0)


def test_demerger_in_not_splits_is_not_adjusted():
    closes = _path(KNOWN, N)
    demerged = closes.copy()
    demerged[100:] = demerged[100:] * 0.6  # a 3:5 price drop, which is a demerger here, not a split
    days = _days(N)
    dt = np.array(days, dtype=object)
    sym = np.array(["AAA"] * N, dtype=object)
    plain = metrics.price_adjustment(sym, demerged, dt, [])
    assert np.isclose(plain[99], 0.6)  # without the list the 3:5 ratio is taken as a split
    listed = [{"sym": "AAA", "date": days[100], "kind": "DEMERGER"}]
    kept = metrics.price_adjustment(sym, demerged, dt, listed)
    assert np.isclose(kept[99], 1.0)  # displayed prices and periods: the listed demerger is not adjusted (#71)
    ratio = demerged[100] / demerged[99]
    runs_basis = metrics.price_adjustment(sym, demerged, dt, listed, demergers_adjust=True)
    assert np.isclose(runs_basis[99], ratio) and np.isclose(runs_basis[100], 1.0)  # runs: the observed ratio (#168)
    # so the demerger does not create a run: the runs match those of the series without the drop
    g, _ = _grids(demerged, notsplits=listed)
    g0, _ = _grids(closes)
    runs = R.detect_runs(g, R.run_cfg({"notSplits": listed}))
    runs0 = R.detect_runs(g0, R.run_cfg({}))
    assert len(runs0) > 0  # the known path has runs, so the comparison below is not vacuous
    assert [(r.dir, r.start, r.end) for r in runs.itertuples()] == [(r.dir, r.start, r.end) for r in runs0.itertuples()]


def test_features_use_only_data_up_to_t():
    rng = np.random.default_rng(3)
    closes = 100 * np.exp(np.cumsum(rng.normal(0, 0.02, N)))
    g, days = _grids(closes)
    cut = 130
    perturbed = closes.copy()
    perturbed[cut + 1:] = perturbed[cut + 1:] * 3.0  # the future moves a lot
    df = _frame("AAA", days, perturbed)
    df.loc[cut + 1:, "delivValCr"] *= 7.0
    g2 = R.build_grids(df, days, ["AAA"], [])
    d1, d2 = R.day_features(g), R.day_features(g2)
    for f in R.FEATURES:  # adjusted prices are rounded to 12 places, so compare with a tolerance
        a, b = d1["pre"][f][:cut + 1], d2["pre"][f][:cut + 1]
        assert np.allclose(a, b, rtol=1e-9, atol=1e-9, equal_nan=True), f


def test_forward_return_enters_at_the_next_close():
    adj = np.full((30, 1), 100.0)
    adj[10] = 200.0  # a jump on day t = 10 itself: the feature day's own move must not count
    fwd = R.forward_return(adj, np.array([10]), 5)
    assert fwd[10, 0] == 0.0  # entry close(11) = 100, exit close(16) = 100
    adj[11:] = 150.0
    assert R.forward_return(adj, np.array([10]), 5)[10, 0] == 0.0
    adj[16] = 180.0
    assert np.isclose(R.forward_return(adj, np.array([10]), 5)[10, 0], 20.0)


def test_daily_footprints_match_hand_values():
    recs = []
    for i in range(130):
        up = i % 2 == 0
        prev = 100.0 + (i % 2 == 0)  # any prevClose: only the sign of close - prevClose matters
        recs.append({"close": prev + 1 if up else prev - 1, "prevClose": prev, "turnoverCr": 100.0, "trades": 1.0,
                     "delivValCr": 20.0 if up else 10.0})
    out = footprints.indicators(recs)
    assert out["delivBal20"] == 2.0 and out["delivBal60"] == 2.0 and out["delivBal120"] == 2.0
    assert out["delivValRatio60"] == 1.0 and out["tradeSizeRatio60"] == 1.0 and out["delivPctTrend"] == 0.0


def test_daily_footprints_are_null_without_enough_history():
    recs = [{"close": 101.0, "prevClose": 100.0, "turnoverCr": 50.0, "trades": 10.0, "delivValCr": 5.0}] * 30
    out = footprints.indicators(recs)
    assert out["delivBal20"] == footprints._bal(recs, 20) and out["delivBal60"] is None
    assert out["delivValRatio60"] is None and out["delivPctTrend"] is None
    # a day without delivery data (BE/BZ) does not count
    recs2 = recs + [{"close": 99.0, "prevClose": 100.0, "turnoverCr": 50.0, "trades": 10.0, "delivValCr": None}]
    assert footprints.indicators(recs2) == out


def test_board_meetings_parse_and_results_filter():
    text = (FIXTURES / "bm_sample.txt").read_text(encoding="utf-8")
    bm = s4.parse_bm(text)
    assert len(bm) == 5
    assert bm.iloc[0]["symbol"] == "BLSPOLY" and bm.iloc[0]["meetingDate"] == "2026-11-18"
    # a purpose that repeats " : " (a re-scheduled notice) keeps its full text
    assert "re-scheduled" in bm.iloc[2]["purpose"] and bm.iloc[2]["meetingDate"] == "2026-11-14"
    res = s4.results_dates(bm)
    assert set(res["symbol"]) == {"BLSPOLY", "NRVANDANA", "AHLWEST", "RAJESHEXPO", "ARCIIL"}
    assert len(res) == 5 and s4.results_dates(bm.iloc[0:0]).empty


def test_holdings_change_uses_broadcast_dates():
    cols = ["quarter", "filedOn", "promoterPct", "fiiPct", "diiPct", "mfPct"]
    rows = [
        ["2025-12-31", "2026-01-20", 50.0, 10.0, 8.0, 5.0],
        ["2026-03-31", "2026-04-22", 49.5, 10.5, 8.2, 5.4],
        ["2026-06-30", "2026-07-25", 49.0, 11.0, 8.5, 5.9],
        ["2026-09-30", None, 48.5, 11.5, 8.9, 6.1],
    ]
    # pivot 2026-06-10: the latest quarter ending before it and broadcast by then is 2026-03-31 (filed 2026-04-22)
    # run ends 2026-08-01: the first quarter ending after that is 2026-09-30, which is not filed yet -> null
    out = run_outputs.holdings_change(rows, cols, pivot_day="2026-06-10", end="2026-08-01")
    assert all(v is None for v in out.values())
    # run ends 2026-06-20: the first quarter ending after is 2026-06-30, filed 2026-07-25 -> change against 2026-03-31
    out = run_outputs.holdings_change(rows, cols, pivot_day="2026-06-10", end="2026-06-20")
    assert np.isclose(out["fiiPct"], 0.5) and np.isclose(out["promoterPct"], -0.5) and np.isclose(out["mfPct"], 0.5)
    # a pivot before the 2026-03-31 filing is public: the base falls back to 2025-12-31
    # the base is 2025-12-31 (the 2026-03-31 filing is broadcast on 2026-04-22, after the pivot); the first quarter ending
    # after 2026-04-10 is 2026-06-30 (11.0), so the change is +1.0
    out = run_outputs.holdings_change(rows, cols, pivot_day="2026-04-01", end="2026-04-10")
    assert np.isclose(out["fiiPct"], 11.0 - 10.0)
    assert run_outputs.holdings_change([], cols, "2026-06-10", "2026-06-20")["fiiPct"] is None


def test_run_outputs_validate_against_their_schemas():
    days = _days(N)
    closes = _path(KNOWN, N)
    frames = [_frame("AAA", days, closes), _frame("BBB", days, _path([(0, 50), (150, 50)], N))]
    df = pd.concat(frames, ignore_index=True)
    uni = pd.DataFrame({"sym": ["AAA", "BBB"], "etf": [False, False], "bucket": ["L", "M"], "sector": ["X", "Y"],
                        "mcapRank": [1.0, 300.0]})
    corp = pd.DataFrame(columns=["sym", "exDate", "kind", "purpose"])
    res = run_outputs.build_run_outputs(df, days, uni, {"runs": {}, "notSplits": []}, corp, {}, {}, None, None,
                                        days[-1])
    validate("runs_library", res["library"])
    validate("run_footprints", res["stats"])
    assert res["counts"]["runs"] == 2 and res["counts"]["up"] == 1 and res["counts"]["down"] == 1
    summary = res["sym"]["AAA"]["runSummary"]["rows"]
    assert [r[0] for r in summary] == ["UP", "DOWN", "ORDINARY"]
    assert summary[1][1] == 1 and summary[1][2] is False  # one DOWN run: not enough runs yet
    assert res["sym"]["BBB"]["runs"]["rows"] == []
    # the stats universe is the top 750 by market cap, so both stocks are in it (ranks 1 and 300)
    assert res["counts"]["studyUniverse"] == 2


def test_no_null_where_a_source_is_missing():
    """Cells of a missing source are null, never 0 (07 section 2)."""
    days = _days(N)
    df = _frame("AAA", days, _path(KNOWN, N))
    g = R.build_grids(df, days, ["AAA"], [])
    runs = R.run_rows(g, R.detect_runs(g, R.run_cfg(None)), R.run_cfg(None))
    extras = run_outputs.run_extras(g, runs, days, pd.DataFrame(columns=["sym", "exDate", "kind", "purpose"]),
                                    {}, {}, {c: np.zeros((N, 1)) for c in R.DEAL_CATS}, None)
    assert extras["futOiChgPct"].isna().all() and extras["buildLB"].isna().all()
    assert extras["holdFiiPp"].isna().all() and extras["dealsPreFII"].isna().all()
    assert (extras["results"] == 0).all() and (extras["circuits"] == 0).all()
