"""Phase 4B trail indicators from holdings (holdInst, holdPromoter): no lookahead, the two-quarter base, thresholds,
revisions, and the 7-indicator flip switch. Synthetic extracts only; no store and no site data."""

from __future__ import annotations

import pytest

from pipeline import holdings_trail as HT
from pipeline import trail as T

QS = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]


def _f(q, filed, promoter=50.0, fii=10.0, dii=20.0, mf=5.0, rid="1"):
    cats = {"promoter": {"pct": promoter, "shares": 0}, "fpi1": {"pct": fii, "shares": 0},
            "mf": {"pct": mf, "shares": 0}, "bank": {"pct": dii - mf, "shares": 0},  # DII = mf + bank (+ others)
            "retailSmall": {"pct": 0.0, "shares": 0}}
    return {"quarter": q, "filedOn": filed, "broadcastDate": filed + "T12:00:00", "recordId": rid, "categories": cats}


def cfg():
    return T.trail_cfg({})


def test_no_lookahead_a_filing_counts_only_from_its_broadcast_day():
    filings = [_f("2025-12-31", "2026-01-20"), _f("2026-03-31", "2026-04-22"), _f("2026-06-30", "2026-07-20")]
    # 2026-07-19: June is not out yet, so the latest known quarter is March, which has no base two steps back
    assert HT.holding_change(filings, "2026-07-19", QS, "holdPromoter") is None
    # 2026-07-20 (its broadcast day): June counts, base Dec-25 is known, the promoter is flat (50 -> 50)
    assert HT.holding_change(filings, "2026-07-20", QS, "holdPromoter") == pytest.approx(0.0)


def test_change_is_latest_minus_two_quarters_earlier():
    filings = [_f("2025-12-31", "2026-01-20", promoter=60.0), _f("2026-03-31", "2026-04-22", promoter=59.0),
               _f("2026-06-30", "2026-07-20", promoter=58.0)]
    assert HT.holding_change(filings, "2026-07-21", QS, "holdPromoter") == pytest.approx(-2.0)  # Jun 58 minus Dec 60
    filings.append(_f("2026-09-30", "2026-10-20", promoter=57.0))
    assert HT.holding_change(filings, "2026-10-21", QS, "holdPromoter") == pytest.approx(-2.0)  # Sep 57 minus Mar 59


def test_holdinst_is_fii_plus_dii_and_mf_is_not_added_twice():
    filings = [_f("2025-12-31", "2026-01-20", fii=10, dii=20, mf=5),
               _f("2026-03-31", "2026-04-22", fii=10, dii=20, mf=5),
               _f("2026-06-30", "2026-07-20", fii=11, dii=21, mf=7)]
    # FII + DII: Jun 11 + 21 = 32, Dec 10 + 20 = 30 -> +2.0. MF is inside DII, so it is not added a second time.
    assert HT.holding_change(filings, "2026-07-21", QS, "holdInst") == pytest.approx(2.0)


@pytest.mark.parametrize("change,expected", [(0.51, 1), (0.5, 0), (0.0, 0), (-0.5, 0), (-0.51, -1), (None, T.MISSING)])
def test_thresholds_are_strict(change, expected):
    assert HT.code(change, cfg(), "holdPromoter") == expected


def test_missing_base_quarter_is_missing_not_neutral():
    filings = [_f("2026-03-31", "2026-04-22"), _f("2026-06-30", "2026-07-20")]  # Dec-25 never filed
    assert HT.holding_change(filings, "2026-08-01", QS, "holdPromoter") is None


def test_revision_is_used_only_after_its_broadcast():
    orig = _f("2025-12-31", "2026-01-20", promoter=60.0, rid="1")
    rev = _f("2025-12-31", "2026-05-10", promoter=55.0, rid="2")  # revised Dec-25 filing, broadcast in May
    rest = [_f("2026-03-31", "2026-04-22", promoter=60.0), _f("2026-06-30", "2026-07-20", promoter=60.0)]
    # before May only the original is known: the Dec-25 base is 60, and on 2026-07-21 the revision (55) is the one used
    assert HT.known_filings([orig, rev] + rest, "2026-02-01")["2025-12-31"]["recordId"] == "1"
    assert HT.known_filings([orig, rev] + rest, "2026-07-21")["2025-12-31"]["recordId"] == "2"
    assert HT.holding_change([orig, rev] + rest, "2026-07-21", QS, "holdPromoter") == pytest.approx(5.0)  # 60 - 55


def test_flip_minimum_is_2_below_six_indicators_and_3_from_six():
    c = cfg()
    assert HT.flip_min(5, c) == 2  # four delivery indicators and dealsNet, as before 4B
    assert HT.flip_min(6, c) == 3
    assert HT.flip_min(7, c) == 3  # plus holdInst and holdPromoter
    assert T._flip_min(c, 7) == 3 and T._flip_min(c, 5) == 2 and T._flip_min(c) == 3  # default: 7 indicators


def test_weekly_codes_show_no_change_until_the_base_and_the_latest_are_both_out():
    filings = [_f("2025-12-31", "2026-01-20", promoter=60.0), _f("2026-03-31", "2026-04-22", promoter=60.0),
               _f("2026-06-30", "2026-07-20", promoter=61.0)]
    weeks = ["2026-07-10", "2026-07-17", "2026-07-24"]
    codes = [HT.holding_codes(filings, w, QS, cfg())["holdPromoter"] for w in weeks]
    # Jul 10 and 17: June is not out, so the latest is March and has no base two steps back: missing.
    # Jul 24: June (61) minus December (60) = +1.0 pp, above +0.5: an A code.
    assert codes == [T.MISSING, T.MISSING, 1]


# ---- the 7-indicator trail: window and weekly codes, and the as-of snapshot (07 6A acceptance) ----------------------------

HQ = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30"]  # the synthetic calendar (2024-2025)


def test_window_and_weekly_codes_have_eight_positions_with_holdings_and_fo_last():
    from pipeline.tests.test_trail import CFG, DAYS, synth

    rows = synth(DAYS)
    fil = [_f("2024-12-31", "2025-01-20", promoter=60.0), _f("2025-03-31", "2025-04-22", promoter=60.0),
           _f("2025-06-30", "2025-07-20", promoter=58.0)]
    hold = {"quarters": HQ, "filings": [
        {"quarter": f["quarter"], "filedOn": f["filedOn"], "promoterPct": f["categories"]["promoter"]["pct"],
         "fiiPct": 10.0, "diiPct": 20.0, "mfPct": 5.0} for f in fil]}
    out = T.trail_for_rows(rows, DAYS, CFG, holdings=hold)
    for w in ("3M", "6M", "1Y"):
        rec = out["windows"][w]
        assert len(rec[0]) == 8 and rec[0][5] in "AND-" and rec[0][6] in "AND-" and rec[0][7] in "AND-"
    assert all(len(t["codes"]) == 8 for t in out["timeline"])
    # promoter 60 -> 58 over the last two quarters (base Dec-24, latest Jun-25, filed 2025-07-20): D on the last week
    assert out["windows"]["3M"][0][6] == "D" and out["timeline"][-1]["codes"][6] == "D"
    assert out["windows"]["3M"][16] == 0.0 and out["windows"]["3M"][17] == -2.0  # holdInst 0, holdPromoter -2 pp


def test_as_of_snapshot_uses_only_filings_broadcast_on_or_before_the_date():
    from pipeline.tests.test_trail import CFG, DAYS, synth

    rows = synth(DAYS)
    hold = {"quarters": HQ, "filings": [
        {"quarter": "2024-12-31", "filedOn": "2025-01-20",
                                                         "promoterPct": 60.0, "fiiPct": 10.0, "diiPct": 20.0},
        {"quarter": "2025-03-31", "filedOn": "2025-04-22", "promoterPct": 60.0, "fiiPct": 10.0, "diiPct": 20.0},
        # the June filing is broadcast on 2025-07-20: a -2 pp promoter change that must not reach any earlier day
        {"quarter": "2025-06-30", "filedOn": "2025-07-20", "promoterPct": 58.0, "fiiPct": 10.0, "diiPct": 20.0},
    ]}
    before = DAYS.index("2025-07-18")
    after = DAYS.index("2025-07-21")
    out_before = T.trail_for_rows(rows, DAYS, CFG, a=before, holdings=hold)
    out_after = T.trail_for_rows(rows, DAYS, CFG, a=after, holdings=hold)
    # as of 18 Jul the latest known quarter is March, which has no base two steps back: missing, not zero
    assert out_before["windows"]["3M"][0][6] == "-" and out_before["windows"]["3M"][17] is None
    assert out_after["windows"]["3M"][0][6] == "D" and out_after["windows"]["3M"][17] == -2.0
    # rows after the as-of date do not change its snapshot
    cut = [r for r in rows if r["date"] <= DAYS[before]]
    assert T.trail_for_rows(cut, DAYS[:before + 1], CFG, holdings=hold)["windows"]["3M"][0][6] == "-"
