"""Smart Money Trail v1 (07 section 6A): indicator codes, weekly codes, flip, consistency, no lookahead, twin parity."""

import numpy as np
import pytest

from pipeline import trail as T

CFG = T.trail_cfg()


def weekdays(n: int, start=(2024, 1, 1)) -> list[str]:
    from datetime import date, timedelta

    d, out = date(*start), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def synth(days, up_dv=lambda i: 1.0, dn_dv=lambda i: 1.0, trades=lambda i: 1000, spike=lambda i: None, seed=1,
          flags=lambda i: 0, up=None):
    """One stock's symbol-file rows. Even days up, odd days down unless `up(i)` says otherwise."""
    rng = np.random.default_rng(seed)
    rows, px = [], 100.0
    for i, d in enumerate(days):
        is_up = (i % 2 == 0) if up is None else up(i)
        prev, px = px, px * (1.01 if is_up else 0.99)
        dv = round(10.0 * (up_dv(i) if is_up else dn_dv(i)) * float(rng.uniform(0.95, 1.05)), 2)
        rows.append({"date": d, "series": "EQ", "close": round(px, 2), "prevClose": round(prev, 2), "vol": 100000,
                     "delivQty": 50000, "turnoverCr": round(dv / 0.4, 2), "trades": int(trades(i)), "delivValCr": dv,
                     "spike": spike(i), "flags": flags(i)})
    return rows


DAYS = weekdays(420)
N = len(DAYS)
WIN = 63  # the 3M window


def last_window(i: int, n: int = WIN) -> bool:
    return i >= N - n


def window_codes(rows, w="3M"):
    return T.trail_for_rows(rows, DAYS, CFG)["windows"][w]


def test_codes_on_a_synthetic_series():
    rec = window_codes(synth(DAYS))
    assert rec[0] == "NNNN---" and 0.9 < rec[1] < 1.1  # balanced: neutral; no deal history and no holdings: missing
    rec = window_codes(synth(DAYS, up_dv=lambda i: 3.0 if last_window(i) else 1.0))
    assert rec[0][0] == "A" and rec[1] > 1.2
    rec = window_codes(synth(DAYS, dn_dv=lambda i: 3.0 if last_window(i) else 1.0))
    assert rec[0][0] == "D" and rec[1] < 0.8
    rows = synth(DAYS)
    for i, r in enumerate(rows):
        if last_window(i):
            r["delivValCr"] = round(r["delivValCr"] * 1.4, 2)  # turnover unchanged: delivery % rises
    rec = window_codes(rows)
    assert rec[0][1] == "A" and rec[2] > 3
    rec = window_codes(synth(DAYS, trades=lambda i: 700 if last_window(i) else 1000))  # fewer, larger trades
    assert rec[0][2] == "A" and rec[3] > 10
    rec = window_codes(synth(DAYS, trades=lambda i: 1500 if last_window(i) else 1000))
    assert rec[0][2] == "D" and rec[3] < -10


def test_spike_persistence_rules():
    rec = window_codes(synth(DAYS, spike=lambda i: 2.5 if (last_window(i) and i % 6 == 0) else None))
    assert rec[0][3] == "A" and rec[4] >= 3 and rec[5] >= 2 * rec[6]
    rec = window_codes(synth(DAYS, spike=lambda i: 2.5 if (last_window(i) and i % 6 == 1) else None))
    assert rec[0][3] == "D"
    rec = window_codes(synth(DAYS, spike=lambda i: 2.5 if i in (N - 2, N - 4) else None))  # fewer than 3 spike days
    assert rec[0][3] == "N"
    rec = window_codes(synth(DAYS, spike=lambda i: 2.5 if i % 6 == 0 else None))  # same rate as its baseline
    assert rec[0][3] == "N"


def test_not_enough_history_is_missing_not_neutral():
    rec = T.trail_for_rows(synth(DAYS[:150]), DAYS[:150], CFG)["windows"]["3M"]
    assert rec is not None and rec[0][1:] == "------"  # baseline short of 120 days; no deal history or holdings
    assert T.trail_for_rows(synth(DAYS[:40]), DAYS[:40], CFG)["windows"]["3M"] is None


def test_ineligible_days_do_not_count():
    rows = synth(DAYS, flags=lambda i: 256 if last_window(i) else 0)  # the whole window flagged low liquidity
    rec = window_codes(rows)
    assert rec is None or rec[0] == "----"


@pytest.mark.parametrize("codes,want", [
    ([1, 1, 0, 0], 1), ([1, 0, 0, 0], 0), ([-1, -1, 1, 0], 0), ([-1, -1, -1, 1], -1), ([1, 1, -1, 9], 0),
    ([1, 1, 1, 9], 1), ([9, 9, 9, 9], 9), ([1, -1, 1, -1], 0), ([-1, -1, 0, 9], -1),
])
def test_weekly_overall_code(codes, want):
    assert int(T.overall(np.array(codes, dtype=np.int8), 2)) == want


def test_strip_has_one_char_per_week_and_marks_missing():
    out = T.trail_for_rows(synth(DAYS), DAYS, CFG)
    assert len(out["strip"]) == CFG["stripWeeks"] == len(out["stripWeeks"])
    assert set(out["strip"]) <= set("ADN-")
    assert out["timeline"][-1]["end"] == DAYS[-1]
    assert out["strip"][-1] == out["timeline"][-1]["overall"]


def _split(fu, fd, ft, lu, ld, lt):
    """Within the 3M window the first 33 days and the last 30 days (6 weeks) lean opposite ways."""
    def part(i, first, last):
        return (last if i >= N - 30 else first) if i >= N - WIN else 1.0

    return synth(DAYS, up_dv=lambda i: part(i, fu, lu), dn_dv=lambda i: part(i, fd, ld),
                 trades=lambda i: 1000 * part(i, ft, lt))


def test_flip_a_to_d_and_d_to_a_and_since():
    # 7 indicators: a flip needs 3 opposite codes in the last 30 days. The split series gives 2 (named deals, delivery);
    # a promoter fall of 2 pp (holdPromoter D, filed 2025-07-20, inside the 30 days) is the third, so the flip shows.
    rec = window_codes(_split(8, 1, 0.5, 1, 3, 4))
    assert rec[0][0] == "A" and rec[12] is None, rec  # two opposite codes only: no flip
    rec = window_codes_held(_split(8, 1, 0.5, 1, 3, 4), _promoter(60.0, 58.0))
    assert rec[0][0] == "A" and rec[12] == "A→D", rec
    assert rec[13] is not None and DAYS[N - 40] <= rec[13] <= DAYS[-1]  # since: the first week of the opposite run
    rec = window_codes_held(_split(1, 8, 10, 3, 1, 0.5), _promoter(50.0, 52.0))
    assert rec[0][0] == "D" and rec[12] == "D→A", rec
    assert window_codes(synth(DAYS, up_dv=lambda i: 3.0 if last_window(i) else 1.0))[12] is None  # no change of lean


HOLD_QS = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30"]


def _promoter(dec: float, jun: float) -> dict:
    """Holdings with a promoter change from Dec-24 (filed Jan-25) to Jun-25 (filed 2025-07-20)."""
    return {"quarters": HOLD_QS, "filings": [
        {"quarter": "2024-12-31", "filedOn": "2025-01-20", "promoterPct": dec, "fiiPct": 10.0, "diiPct": 20.0, "mfPct": 0.0},
        {"quarter": "2025-03-31", "filedOn": "2025-04-22", "promoterPct": dec, "fiiPct": 10.0, "diiPct": 20.0, "mfPct": 0.0},
        {"quarter": "2025-06-30", "filedOn": "2025-07-20", "promoterPct": jun, "fiiPct": 10.0, "diiPct": 20.0, "mfPct": 0.0}]}


def window_codes_held(rows, holdings, w="3M"):
    return T.trail_for_rows(rows, DAYS, CFG, holdings=holdings)["windows"][w]


def test_consistency_is_the_share_of_weeks_coded():
    rows = synth(DAYS, up_dv=lambda i: 3.0 if last_window(i, 126) else 1.0,
                 trades=lambda i: 700 if last_window(i, 126) else 1000)
    out = T.trail_for_rows(rows, DAYS, CFG)
    strip = out["strip"][-26:]
    rec = out["windows"]["6M"]
    defined = sum(c != "-" for c in strip)
    assert rec[10] == round(strip.count("A") / defined * 100) and rec[11] == round(strip.count("D") / defined * 100)
    assert rec[10] >= 60  # persistent


def _multi(rows_by_sym, days):
    syms = sorted(rows_by_sym)
    mats = [T.stock_arrays(rows_by_sym[s], days)[0] for s in syms]
    return {k: (mats[0][k] if np.ndim(mats[0][k]) == 0 else np.concatenate([m[k] for m in mats], axis=1))
            for k in mats[0]}, syms


def test_market_snapshot_equals_the_one_stock_twin_path():
    rows = {"AAA": synth(DAYS, up_dv=lambda i: 3.0 if last_window(i) else 1.0, seed=3),
            "BBB": synth(DAYS, dn_dv=lambda i: 3.0 if last_window(i) else 1.0, seed=4)}
    cs, syms = _multi(rows, DAYS)
    ind_w, points = T.weekly_codes(cs, DAYS, CFG, [N - 1])
    snap, _, _ = T.snapshot(cs, DAYS, N - 1, ind_w, points, CFG, syms)
    assert len(snap["rows"]) == 2
    for sym, r in zip(syms, snap["rows"]):
        one = T.trail_for_rows(rows[sym], DAYS, CFG)
        assert r[0] == sym and r[1] == one["strip"] and r[2:] == [one["windows"][w] for w in CFG["windows"]]


def test_as_of_snapshot_uses_no_data_after_its_date():
    """No lookahead: the snapshot at day a is identical whether or not later days exist, and whatever they contain."""
    rows = {"AAA": synth(DAYS, up_dv=lambda i: 2.0 if i > 300 else 1.0, seed=5),
            "BBB": synth(DAYS, trades=lambda i: 700 if i > 330 else 1000, seed=6)}
    a = 380
    cs, syms = _multi(rows, DAYS)
    ind_w, points = T.weekly_codes(cs, DAYS, CFG, [a])
    full, _, _ = T.snapshot(cs, DAYS, a, ind_w, points, CFG, syms)
    assert full["rows"] and any(r[3] is not None for r in full["rows"])
    cut = DAYS[:a + 1]
    cs2, _ = _multi({k: [r for r in v if r["date"] <= cut[-1]] for k, v in rows.items()}, cut)
    ind2, pts2 = T.weekly_codes(cs2, cut, CFG, [a])
    trunc, _, _ = T.snapshot(cs2, cut, a, ind2, pts2, CFG, syms)
    assert full["rows"] == trunc["rows"] and full["stripWeeks"] == trunc["stripWeeks"]
    poisoned = {k: [dict(r, delivValCr=(r["delivValCr"] * 50 if r["date"] > cut[-1] else r["delivValCr"])) for r in v]
                for k, v in rows.items()}
    cs3, _ = _multi(poisoned, DAYS)
    ind3, pts3 = T.weekly_codes(cs3, DAYS, CFG, [a])
    pois, _, _ = T.snapshot(cs3, DAYS, a, ind3, pts3, CFG, syms)
    assert pois["rows"] == full["rows"]


def test_track_record_entry_is_close_t_plus_1_and_windows_do_not_pass_the_data():
    from pipeline.build import trail as B

    rows = {f"S{i}": synth(DAYS, up_dv=lambda j, i=i: 2.0 if (i % 2 and last_window(j)) else 1.0, seed=10 + i)
            for i in range(6)}
    cs, syms = _multi(rows, DAYS)
    inp = B.TrailInputs.__new__(B.TrailInputs)
    inp.days, inp.syms, inp.cs = DAYS, syms, cs
    close = np.full((N, len(syms)), np.nan)
    for j, s in enumerate(syms):
        for i, r in enumerate(rows[s]):
            close[i, j] = r["close"]
    inp.close, inp.adj_cum = close, np.zeros_like(close, dtype=int)
    allm = np.ones(len(syms), bool)
    ex = B.forward_excess(inp, 300, 60, allm)
    fwd = (close[361] / close[301] - 1) * 100  # entry at close(t+1), exit 60 days later
    assert np.allclose(ex, fwd - np.median(fwd))
    assert np.isnan(B.forward_excess(inp, N - 10, 60, allm)).all()
    ind_w, pts = T.weekly_codes(cs, DAYS, CFG, B.month_ends(DAYS))
    perf = B.track_record(inp, ind_w, pts, allm, CFG)
    assert perf["columns"][:4] == ["kind", "id", "window", "horizon"]
    assert {r[0] for r in perf["rows"]} == {"list", "indicator"}
    assert all(d <= DAYS[N - 1 - 61] for d in perf["asOfDates"])


# ---- shared vectors: the TypeScript twin (site/src/lib/trail.ts) is tested on the same numbers ------------------------

import json  # noqa: E402
from pathlib import Path  # noqa: E402

TRAIL_VECTORS = Path(__file__).resolve().parents[2] / "site" / "src" / "lib" / "trailVectors.json"


def build_trail_vectors() -> dict:
    days = weekdays(400, (2024, 3, 4))
    n = len(days)

    def lw(i, k=WIN):
        return i >= n - k

    def split(fu, fd, ft, lu, ld, lt):
        def part(i, first, last):
            return (last if i >= n - 30 else first) if i >= n - WIN else 1.0

        return synth(days, up_dv=lambda i: part(i, fu, lu), dn_dv=lambda i: part(i, fd, ld),
                     trades=lambda i: 1000 * part(i, ft, lt), seed=21)

    stocks = {
        "AAA": synth(days, up_dv=lambda i: 3.0 if lw(i, 126) else 1.0, trades=lambda i: 700 if lw(i) else 1000, seed=22,
                     spike=lambda i: 2.4 if (lw(i) and i % 6 == 0) else None),
        "BBB": split(8, 1, 0.5, 1, 3, 4),
        "CCC": synth(days, dn_dv=lambda i: 3.0 if lw(i) else 1.0, seed=23, flags=lambda i: 256 if 120 <= i < 150 else 0,
                     spike=lambda i: 2.2 if (lw(i) and i % 6 == 1) else None),
        "DDD": synth(days, seed=24)[n - 150:],  # listed late: little history
    }
    # named deals (Phase 4): FII and DII net Rs Cr per day; deal history starts at day 100 so the 1Y window of the
    # as-of date (n-61) starts before it and is missing, while the latest 1Y window is covered
    cfg = {**T.trail_cfg(), "dealsFrom": days[100]}
    deals = {
        "AAA": {d: [0.0, 1.0] for d in days[-126:]},  # DII buys 126 Cr over 6 months: A
        "BBB": {d: [-0.4, 0.0] for d in days[-63:]},  # FII sells 25 Cr over 3 months: D
        "CCC": {d: [0.05, 0.0] for d in days[-200:]},  # tiny: N
        "DDD": {},  # covered, no deals: N
    }
    # holdings (Phase 4B): AAA's June filing is broadcast on 2025-07-20, after the as-of day (2025-06-20), so the as-of
    # holdInst is missing (no lookahead) and the latest is +2 pp (FII + DII 32 against 30). BBB: promoter 60 -> 58 (D)
    # and FII + DII 30 -> 32 (A), so the window ties on A and D and the 3M flip shows once a third D (deals) is present.
    holdings = {
        "AAA": {"quarters": HOLD_Q, "filings": [
            _hf("2024-12-31", "2025-01-20", 50.0, 10.0, 20.0), _hf("2025-03-31", "2025-04-22", 50.0, 10.0, 20.0),
            _hf("2025-06-30", "2025-07-20", 50.0, 11.0, 21.0)]},
        "BBB": {"quarters": HOLD_Q, "filings": [
            _hf("2024-12-31", "2025-01-25", 60.0, 10.0, 20.0), _hf("2025-03-31", "2025-04-25", 60.0, 10.0, 20.0),
            _hf("2025-06-30", "2025-07-25", 58.0, 11.0, 21.0)]},
    }
    expected = {}
    for sym, rows in stocks.items():
        dl = {d: (v[0], v[1]) for d, v in deals[sym].items()}
        h = holdings.get(sym)
        expected[sym] = {"latest": T.trail_for_rows(rows, days, cfg, deals=dl, holdings=h),
                         "asOf": T.trail_for_rows(rows, days, cfg, a=n - 61, deals=dl, holdings=h)}
    return {"cfg": cfg, "tradingDays": days, "asOfIndex": n - 61, "stocks": stocks, "deals": deals,
            "holdings": holdings, "expected": json.loads(json.dumps(expected))}


HOLD_Q = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30"]


def _hf(q: str, filed: str, promoter: float, fii: float, dii: float) -> dict:
    """A holdings row as the symbol file stores it (grouped percentages, 2 dp)."""
    return {"quarter": q, "filedOn": filed, "promoterPct": promoter, "fiiPct": fii, "diiPct": dii, "mfPct": 0.0}


def test_trail_vectors_cover_the_cases_and_file_is_current():
    vec = build_trail_vectors()
    e = vec["expected"]
    assert e["AAA"]["latest"]["windows"]["6M"][0][0] == "A" and e["BBB"]["latest"]["windows"]["3M"][12] == "A→D"
    assert e["CCC"]["latest"]["windows"]["3M"][0][3] == "D" and e["DDD"]["latest"]["windows"]["1Y"][0][1:] == "---N--"
    assert e["AAA"]["latest"]["windows"]["3M"][0][4] == "A" and e["BBB"]["latest"]["windows"]["3M"][0][4] == "D"
    assert e["AAA"]["asOf"]["windows"]["1Y"][0][4] == "-"  # the as-of 1Y window starts before the deal history
    assert e["AAA"]["asOf"]["asOf"] == vec["tradingDays"][vec["asOfIndex"]]
    # holdings: 7 codes; latest holdInst A (+2 pp) for AAA; as-of missing (filing broadcast after the as-of day)
    assert e["AAA"]["latest"]["windows"]["6M"][0][5] == "A" and e["AAA"]["asOf"]["windows"]["6M"][0][5] == "-"
    assert e["BBB"]["latest"]["windows"]["6M"][0][6] == "D" and e["BBB"]["latest"]["windows"]["6M"][0][5] == "A"
    assert e["CCC"]["latest"]["windows"]["6M"][0][5:] == "--"
    text = json.dumps(vec, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    if not TRAIL_VECTORS.exists() or TRAIL_VECTORS.read_text(encoding="utf-8") != text:
        TRAIL_VECTORS.write_text(text, encoding="utf-8", newline="\n")  # regenerate; commit the new file
