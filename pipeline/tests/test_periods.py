"""08 section 6: aggregation unit tests (OHLC, value-weighted delivery %, split-adjusted returns, partial periods, holiday
weeks, the Sunday session, sparse stocks), period-signal boundaries, custom N-day bars and ranges."""

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from pipeline import metrics
from pipeline.metrics import aggregate_periods, aggregate_range, periods_for

SETTINGS = {"minPeriodsFraction": 0.5, "liquidity": {"minTurnoverAvg20Cr": 1.0, "minBaseDelivValCr": 0.5}}
CFG = {"w": {"base": 10, "long": 52, "minHistory": 6, "daysPerPeriod": 5,
             "ACC": {"retMin": 3, "spikeMin": 1.5, "delivPctDiffMin": 5, "clvMin": 0.3},
             "DIS": {"retMax": -3, "spikeMin": 1.5, "delivPctDiffMin": 5, "clvMax": -0.3},
             "ABS": {"absRetMax": 2, "spikeMin": 2, "delivPctDiffMin": 8},
             "SPU": {"retMin": 5, "relTurnoverMin": 2, "delivPctDiffMax": -8},
             "SPD": {"retMax": -5, "relTurnoverMin": 2, "delivPctDiffMax": -8}}}
SIGNALS = {"periods": CFG}


def row(d, o, h, l, c, pc, vol=1000, dq=500, series="EQ", flags=0, trades=10):
    vwap = (h + l) / 2
    return {"date": d, "series": series, "open": o, "high": h, "low": l, "close": c, "prevClose": pc, "vwap": vwap,
            "vol": vol, "turnoverCr": vol * vwap / 1e7, "trades": trades, "delivQty": dq, "flags": flags}


def weekdays(start: str, n: int, skip=()):
    out, d = [], date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5 and d.isoformat() not in skip:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


# ---- calendar ----------------------------------------------------------------------------------------------------

def test_period_keys_and_bounds():
    assert metrics.period_key("2026-11-08", "w") == "2026-W45"  # a Sunday session stays in its Monday-Sunday week
    assert metrics.period_key("2026-11-09", "w") == "2026-W46"
    assert metrics.period_key("2026-01-01", "w") == "2026-W01" and metrics.period_key("2024-12-30", "w") == "2025-W01"
    assert metrics.period_key("2026-12-31", "q") == "2026-Q4" and metrics.period_key("2026-04-01", "q") == "2026-Q2"
    assert metrics.period_bounds("2026-W45", "w") == ("2026-11-02", "2026-11-08")
    assert metrics.period_bounds("2026-02", "m") == ("2026-02-01", "2026-02-28")
    assert metrics.period_bounds("2026-Q4", "q") == ("2026-10-01", "2026-12-31")
    assert metrics.period_bounds("2026-Q1", "q") == ("2026-01-01", "2026-03-31")


def test_holiday_week_and_sunday_session_are_not_partial():
    # Fri 6 Nov is a holiday and a Sunday (8 Nov) session exists; the following week is complete too
    days = weekdays("2026-10-26", 14, skip={"2026-11-06"})
    days = days[:days.index("2026-11-09")] + ["2026-11-08"] + days[days.index("2026-11-09"):]
    days = [d for d in days if d <= "2026-11-13"]
    ps = {p["key"]: p for p in periods_for(days, "w")}
    w45 = ps["2026-W45"]
    assert w45["dates"][-1] == "2026-11-08" and w45["daysIn"] == 5 and w45["daysExpected"] == 5 and not w45["partial"]
    assert not ps["2026-W46"]["partial"] and ps["2026-W46"]["end"] == "2026-11-13"


def test_partial_current_and_first_periods():
    days = weekdays("2026-10-28", 11)  # starts on a Wednesday, ends Wednesday of the 3rd week
    ps = periods_for(days, "w")
    assert ps[0]["partial"] and ps[0]["daysIn"] == 3 and ps[0]["daysExpected"] == 5  # truncated at the start
    assert not ps[1]["partial"]
    assert ps[-1]["partial"] and ps[-1]["daysIn"] == 3 and ps[-1]["daysExpected"] == 5  # "in progress (3 of 5 days)"
    m = periods_for(days, "m")
    assert all(p["partial"] for p in m)


def test_n_day_bars_end_at_the_latest_date():
    days = weekdays("2026-10-01", 23)
    ps = periods_for(days, ("n", 10))
    assert [p["tradingDays"] for p in ps] == [3, 10, 10] and ps[-1]["end"] == days[-1]
    assert ps[0]["partial"] and not ps[1]["partial"] and ps[0]["daysExpected"] == 10


# ---- aggregation -------------------------------------------------------------------------------------------------

def week_rows():
    # previous Friday (2026-11-06) close 100; the week of 9-13 Nov
    return [
        row("2026-11-06", 99, 101, 98, 100, 99),
        row("2026-11-09", 100, 110, 95, 105, 100, vol=1000, dq=600),
        row("2026-11-10", 105, 108, 102, 103, 105, vol=3000, dq=900),
        row("2026-11-11", 103, 120, 101, 118, 103, vol=2000, dq=1400),
        row("2026-11-12", 118, 119, 112, 114, 118, vol=1000, dq=200),
        row("2026-11-13", 114, 116, 110, 112, 114, vol=2000, dq=1000),
    ]


def test_ohlc_value_weighted_delivery_and_return():
    days = [r["date"] for r in week_rows()]
    p = [x for x in aggregate_periods(week_rows(), "w", days) if x["key"] == "2026-W46"][0]
    assert (p["open"], p["high"], p["low"], p["close"], p["prevClose"]) == (100, 120, 95, 112, 100)
    assert p["ret"] == pytest.approx(12.0)
    assert p["days"] == 5 and p["vol"] == 9000 and p["delivQty"] == 4100 and p["trades"] == 50
    tv = sum(r["turnoverCr"] for r in week_rows()[1:])
    dv = sum(r["delivQty"] * r["vwap"] / 1e7 for r in week_rows()[1:])
    assert p["turnoverCr"] == pytest.approx(tv) and p["delivValCr"] == pytest.approx(dv)
    assert p["delivPct"] == pytest.approx(dv / tv * 100)  # value-weighted, never the mean of daily %
    daily_pcts = [r["delivQty"] / r["vol"] * 100 for r in week_rows()[1:]]
    assert abs(p["delivPct"] - float(np.mean(daily_pcts))) > 0.3  # a plain mean would differ
    assert p["vwap"] == pytest.approx(tv * 1e7 / 9000)
    assert p["clv"] == pytest.approx(((112 - 95) - (120 - 112)) / (120 - 95))
    assert p["avgTradeSize"] == pytest.approx(tv * 1e7 / 50)
    # delivery value on up days (close > prevClose: 9th, 11th) over down days (10th, 12th, 13th)
    up = sum(r["delivQty"] * r["vwap"] for r in [week_rows()[1], week_rows()[3]])
    dn = sum(r["delivQty"] * r["vwap"] for r in [week_rows()[2], week_rows()[4], week_rows()[5]])
    assert p["delivBalance"] == pytest.approx(up / dn)
    assert p["partial"] is False and p["adjusted"] == 0


def test_return_is_split_adjusted_across_a_split():
    rows = [
        row("2026-11-06", 990, 995, 985, 990, 985),
        row("2026-11-09", 995, 1020, 990, 1000, 990),
        row("2026-11-10", 1000, 1015, 995, 1010, 1000),
        row("2026-11-11", 506, 512, 500, 510, 1010, vol=2000, dq=900),  # 1:2 split; NSE keeps prevClose RAW (1010)
        row("2026-11-12", 510, 525, 508, 520, 510),
        row("2026-11-13", 520, 535, 515, 530, 520),
    ]
    days = [r["date"] for r in rows]
    p = [x for x in aggregate_periods(rows, "w", days) if x["key"] == "2026-W46"][0]
    assert p["adjusted"] == 1
    assert p["prevClose"] == pytest.approx(495.0)  # 990 expressed in post-split prices
    assert p["ret"] == pytest.approx((530 / 495 - 1) * 100)  # not 530/990 - 1 = -46%
    assert p["open"] == pytest.approx(497.5) and p["high"] == pytest.approx(535) and p["low"] == pytest.approx(495)
    # vwap divides turnover by post-split quantities of the pre-split days (x2)
    tv = sum(r["turnoverCr"] for r in rows[1:]) * 1e7
    q = 1000 * 2 + 1000 * 2 + 2000 + 1000 + 1000
    assert p["vwap"] == pytest.approx(tv / q)
    # the price adjustment needs no corporate-action file: the same rows give the same factors in any year
    sym = np.array(["X"] * 6, dtype=object)
    closes = np.array([990, 1000, 1010, 510, 520, 530.0])
    assert list(metrics.price_adjustment(sym, closes)) == [0.5, 0.5, 0.5, 1.0, 1.0, 1.0]
    ev, factor = metrics.adjustment_events(sym, closes)
    assert list(ev) == [False, False, False, True, False, False] and factor[3] == 0.5


def test_split_on_the_first_day_of_a_period_still_adjusts_the_prior_close():
    rows = [row("2026-11-06", 990, 995, 985, 1000, 985),
            row("2026-11-09", 500, 510, 495, 505, 1000),  # ex-date is the first day of the week
            row("2026-11-10", 505, 512, 500, 510, 505)]
    p = [x for x in aggregate_periods(rows, "w", [r["date"] for r in rows]) if x["key"] == "2026-W46"][0]
    assert p["prevClose"] == pytest.approx(500.0) and p["adjusted"] == 1 and p["ret"] == pytest.approx(2.0)


def test_stock_that_trades_only_some_days_and_t2t_days():
    rows = [row("2026-11-04", 50, 52, 49, 51, 50), row("2026-11-09", 51, 53, 50, 52, 51, vol=500, dq=100),
            row("2026-11-11", 52, 54, 51, 53, 52, vol=700, dq=300),
            row("2026-11-12", 53, 55, 52, 54, 53, vol=900, dq=None, series="BE", flags=1)]
    days = weekdays("2026-11-02", 9)
    p = [x for x in aggregate_periods(rows, "w", days) if x["key"] == "2026-W46"][0]
    assert p["days"] == 2 and p["vol"] == 1200  # sums over valid delivery days only; the BE day is excluded
    assert p["close"] == 54 and p["high"] == 55  # price fields still use every traded day
    assert p["flags"] & 1  # the t2t flag is carried (OR of the daily flags)
    # a stock whose only trading in a week is T2T has no row for it
    assert not [x for x in aggregate_periods(rows[-1:], "w", days) if x["key"] == "2026-W46"]


def weekly_series(n_weeks, last_dq_factor=1.0, last_ret=0.0, start="2026-01-05"):
    """n_weeks full weeks of flat price and constant delivery; the last week's delivery is scaled and its price moved."""
    days = weekdays(start, n_weeks * 5)
    rows, close = [], 100.0
    for i, d in enumerate(days):
        last = i >= (n_weeks - 1) * 5
        pc = close
        if last and i == (n_weeks - 1) * 5 and last_ret:
            close = close * (1 + last_ret)
        dq = 1_000_000 * (last_dq_factor if last else 1)
        rows.append(row(d, pc, max(pc, close) * 1.01, min(pc, close) * 0.99, close, pc, vol=2_000_000, dq=dq))
    return days, rows


def test_baselines_spike_and_delivery_pct_diff_partial_periods_excluded():
    days, rows = weekly_series(13, last_dq_factor=2.0)
    ps = aggregate_periods(rows, "w", days, SETTINGS, SIGNALS)
    last = ps[-1]
    assert last["key"] == metrics.period_key(days[-1], "w") and not last["partial"]
    assert last["spike"] == pytest.approx(2.0) and last["delivPctDiff"] == pytest.approx(last["delivPct"] - 50.0, abs=1e-6)
    assert ps[5]["spike"] == pytest.approx(1.0)  # baseline needs ceil(10 x 0.5) = 5 prior complete weeks
    assert ps[4]["spike"] is None and ps[0]["spike"] is None
    # cut the data mid-week: the in-progress week is partial, never part of a baseline, but shows its own spike
    cut = days[:-2]
    pc = aggregate_periods([r for r in rows if r["date"] in cut], "w", cut, SETTINGS, SIGNALS)[-1]
    assert pc["partial"] and pc["daysIn"] == 3 and pc["daysExpected"] == 5 and pc["delivPctPctile"] is None
    assert pc["spike"] == pytest.approx(1.2)  # 3 days at 2x against the mean of full weeks: sums are not scaled
    assert aggregate_periods(rows, "w", days)[0]["partial"] is False  # starts on a Monday


def test_streak_counts_periods_above_baseline():
    days, rows = weekly_series(16)
    for r in rows[-15:]:  # three heavier weeks at the end
        r["delivQty"] = 1_600_000
    ps = aggregate_periods(rows, "w", days, SETTINGS, SIGNALS)
    assert [p["streak"] for p in ps[-3:]] == [1, 2, 3]


def sig_frame(**kw):
    base = dict(ret=0.0, spike=1.0, delivPctDiff=0.0, clv=0.0, relTurnover=1.0, sigOk=True)
    base.update(kw)
    return pd.DataFrame([base])


@pytest.mark.parametrize("kw,expect", [
    (dict(ret=3.0, spike=1.5, delivPctDiff=5.0, clv=0.3), "ACC"),
    (dict(ret=2.99, spike=1.5, delivPctDiff=5.0, clv=0.3), None),
    (dict(ret=3.0, spike=1.49, delivPctDiff=5.0, clv=0.3), None),
    (dict(ret=-3.0, spike=1.5, delivPctDiff=5.0, clv=-0.3), "DIS"),
    (dict(ret=-3.0, spike=1.5, delivPctDiff=5.0, clv=-0.29), None),
    (dict(ret=1.99, spike=2.0, delivPctDiff=8.0), "ABS"),
    (dict(ret=2.0, spike=2.0, delivPctDiff=8.0), None),
    (dict(ret=5.0, relTurnover=2.0, delivPctDiff=-8.0), "SPU"),
    (dict(ret=-5.0, relTurnover=2.0, delivPctDiff=-8.0), "SPD"),
    (dict(ret=-5.0, relTurnover=1.99, delivPctDiff=-8.0), None),
    (dict(ret=3.0, spike=1.5, delivPctDiff=5.0, clv=0.3, sigOk=False), None),
])
def test_weekly_signal_boundaries(kw, expect):
    assert metrics.period_signal(sig_frame(**kw), CFG["w"]).iloc[0] == expect


def test_signal_exclusions_etf_low_liquidity_and_short_history():
    days, rows = weekly_series(9, last_dq_factor=2.0, last_ret=0.05)
    sig = [p["signal"] for p in aggregate_periods(rows, "w", days, SETTINGS, SIGNALS)]
    assert sig[-1] == "ACC" and all(s is None for s in sig[:-1])
    assert aggregate_periods(rows, "w", days, SETTINGS, SIGNALS, etf=True)[-1]["signal"] is None
    # fewer than 6 prior complete weeks: no signal even with a qualifying move
    d2, r2 = weekly_series(6, last_dq_factor=2.0, last_ret=0.05)
    last = aggregate_periods(r2, "w", d2, SETTINGS, SIGNALS)[-1]
    assert last["signal"] is None and last["flags"] & 1024
    # low liquidity: tiny turnover
    d3, r3 = weekly_series(9, last_dq_factor=2.0, last_ret=0.05)
    for r in r3:
        r["turnoverCr"] /= 1e4
    assert aggregate_periods(r3, "w", d3, SETTINGS, SIGNALS)[-1]["flags"] & 256


# ---- custom bars and ranges --------------------------------------------------------------------------------------

def test_custom_n_bars_and_range_match_direct_sums():
    days, rows = weekly_series(8)
    bars = aggregate_periods(rows, ("n", 7), days, SETTINGS, SIGNALS)
    assert bars[-1]["end"] == days[-1] and bars[-1]["days"] == 7 and bars[0]["partial"] and bars[0]["days"] == 40 % 7
    assert all(b["signal"] is None for b in bars)  # custom bars carry no signal
    a, b = days[3], days[20]
    r = aggregate_range(rows, a, b)
    sel = [x for x in rows if a <= x["date"] <= b]
    assert r["days"] == len(sel) and r["vol"] == sum(x["vol"] for x in sel)
    assert r["delivValCr"] == pytest.approx(sum(x["delivQty"] * x["vwap"] / 1e7 for x in sel))
    assert r["prevClose"] == rows[2]["close"] and r["close"] == sel[-1]["close"]
    assert aggregate_range(rows, "2030-01-01", "2030-02-01") is None


def test_adjustment_rule_catches_splits_and_leaves_real_moves_alone():
    """NSE's PREV_CLOSE is raw on an ex-date, so the rule works on close-to-close ratios matching a corporate action."""
    sym = np.array(["X"] * 8 + ["Y"] * 3, dtype=object)
    close = np.array([100, 50.5, 50, 33.9, 25, 20, 12, 12.1, 100, 28, 28.5], dtype=float)
    ev, f = metrics.adjustment_events(sym, close)
    # 100 -> 50.5 (1:1 bonus = 1/2), 50 -> 33.9 (2/3), 33.9 -> 25 (0.737 ~ 3/4), 25 -> 20 (-20%: a circuit-size move, no
    # event), 20 -> 12 (0.6 within 12% of 2/3); Y: 100 -> 28 (0.28 matches no ratio: a crash, left alone)
    assert list(np.flatnonzero(ev)) == [1, 3, 4, 6]
    assert f[1] == 0.5 and f[3] == pytest.approx(2 / 3) and f[4] == 0.75
    up, fu = metrics.adjustment_events(np.array(["Z"] * 3, dtype=object), np.array([10.0, 99.0, 100.0]))
    assert list(up) == [False, True, False] and fu[1] == 10.0  # 10:1 consolidation
    assert not metrics.adjustment_events(np.array(["Z", "W"], dtype=object), np.array([100.0, 40.0]))[0].any()  # new symbol
