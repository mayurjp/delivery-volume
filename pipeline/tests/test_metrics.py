import numpy as np
import pandas as pd
import pytest

from pipeline import config, metrics


def frame(n=30, sym="AAA", dp=50.0, vol=1000, price=1000.0, dq=None):
    rows = []
    for i in range(n):
        d = f"2026-01-{i + 1:02d}"
        q = vol * (1 + i) if dq is None else dq
        rows.append(dict(sym=sym, series="EQ", date=d, prevClose=price, open=price, high=price + 2, low=price - 2,
                         close=price + 1, vwap=price, vol=q * 2, turnoverLacs=q * 2 * price / 1e5, trades=100,
                         delivQty=q, delivPct=50.0))
    return pd.DataFrame(rows)


def run(df):
    return metrics.compute_daily(df, config.settings(), config.signals())


def test_elementary_formulas():
    assert metrics.turnover_cr(pd.Series([68.90]))[0] == pytest.approx(0.689)  # lakh -> crore
    assert metrics.deliv_val_cr(pd.Series([20990.0]), pd.Series([184.85]))[0] == pytest.approx(20990 * 184.85 / 1e7)
    h, l, c = pd.Series([10.0, 10.0, 10.0]), pd.Series([0.0, 10.0, 0.0]), pd.Series([10.0, 10.0, 5.0])
    assert list(metrics.clv(h, l, c)) == [1.0, 0.0, 0.0]  # at the high / h==l / mid-range
    assert metrics.ret_pct(pd.Series([110.0]), pd.Series([100.0]))[0] == pytest.approx(10.0)


def test_prior_window_excludes_today_and_min_periods():
    df = run(frame())
    q = np.arange(1, 31) * 1000.0
    dv = q * 1000 / 1e7
    # delivValAvg20 on day index 25 = mean of days 5..24 (prior 20)
    assert df.loc[25, "delivValAvg20"] == pytest.approx(dv[5:25].mean())
    assert df.loc[25, "delivValAvg5"] == pytest.approx(dv[20:25].mean())
    assert np.isnan(df.loc[0, "delivValAvg20"])  # no prior day
    assert np.isnan(df.loc[9, "delivValAvg20"])  # 9 prior days < ceil(20*0.5) = 10
    assert df.loc[10, "delivValAvg20"] == pytest.approx(dv[0:10].mean())
    assert np.isnan(df.loc[20, "delivValAvg50"])  # 20 prior days < 25


def test_spike_and_min_base_floor():
    df = run(frame())
    q = np.arange(1, 31) * 1000.0
    dv = q * 1000 / 1e7
    assert df.loc[25, "spike"] == pytest.approx(dv[25] / dv[5:25].mean())
    # tiny delivery value base (< 0.5 Cr) -> spike null
    small = frame(dq=10)
    assert run(small)["spike"].isna().all()


def test_value_weighted_delivery_pct_avg():
    df = frame()
    df.loc[:, "delivQty"] = 100.0
    df.loc[24, "delivQty"] = 900.0  # a heavy day inside the window
    df["turnoverLacs"] = df["vol"] * df["vwap"] / 1e5
    out = run(df)
    win = df.loc[5:24]
    expect = (win["delivQty"] * win["vwap"]).sum() / (win["vol"] * win["vwap"]).sum() * 100
    assert out.loc[25, "delivPctAvg20"] == pytest.approx(expect)  # ratio of sums, not mean of 50.0 percentages


def test_ret_clv_vwapgap_relvol_and_diff():
    df = run(frame())
    assert df.loc[3, "ret1"] == pytest.approx(0.1)  # 1001 / 1000 - 1, in percent
    assert df.loc[3, "clv"] == pytest.approx(((1001 - 998) - (1002 - 1001)) / 4)
    assert df.loc[3, "vwapGap"] == pytest.approx(0.1)
    q = np.arange(1, 31) * 1000.0
    assert df.loc[25, "relVol"] == pytest.approx(q[25] * 2 / (q[5:25] * 2).mean())
    assert df.loc[25, "delivPctDiff"] == pytest.approx(0.0)


def test_streak_signed_runs():
    diff = pd.Series([1, 2, -1, -1, -3, 0.5, np.nan, 2.0])
    sym = pd.Series(["A"] * 7 + ["B"])
    assert list(metrics.streak(diff, sym).fillna(99)) == [1, 2, -1, -2, -3, 1, 99, 1]


def test_zscore_and_percentile():
    df = frame(n=70)
    rng = np.random.default_rng(1)
    dp = rng.uniform(30, 70, 70)
    df["delivPct"] = dp
    out = run(df)
    prior = dp[9:69]
    assert out.loc[69, "delivPctZ60"] == pytest.approx((dp[69] - prior.mean()) / prior.std(ddof=1))
    # percentile: share of the last 250 (here all 70, since min_periods=125 is not met) -> null
    assert np.isnan(out.loc[69, "delivPctPctile"])
    v = metrics.pctile_rank_trailing(np.array([1.0, 2.0, 3.0, 2.0]), window=3, mp=2)
    assert list(np.round(v, 4)) == [np.nan, 100.0, 100.0, 66.6667] or np.isnan(v[0])
    assert v[1] == pytest.approx(100.0) and v[3] == pytest.approx(2 / 3 * 100)


def test_t2t_rows_excluded_from_delivery_metrics():
    df = frame(n=15)
    df.loc[14, ["series", "delivQty", "delivPct"]] = ["BE", np.nan, np.nan]
    out = run(df)
    assert np.isnan(out.loc[14, "delivValCr"]) and np.isnan(out.loc[14, "spike"])
    assert out.loc[14, "ret1"] == pytest.approx(0.1)  # price continuity kept


def _sig_frame(**kw):
    base = dict(ret1=0.0, spike=3.0, delivPctDiff=0.0, clv=0.0, relVol=1.0, sigOk=True)
    base.update(kw)
    return pd.DataFrame([base])


THR = config.signals()["daily"]


@pytest.mark.parametrize("kw,exp", [
    (dict(ret1=1.0, spike=1.5, delivPctDiff=5, clv=0.3), "ACC"),  # exact boundaries are inclusive
    (dict(ret1=0.99, spike=1.5, delivPctDiff=5, clv=0.3), None),
    (dict(ret1=1.0, spike=1.49, delivPctDiff=5, clv=0.3), None),
    (dict(ret1=-1.0, spike=1.5, delivPctDiff=5, clv=-0.3), "DIS"),
    (dict(ret1=-1.0, spike=1.5, delivPctDiff=5, clv=-0.29), None),
    (dict(ret1=0.5, spike=2.0, delivPctDiff=10, clv=0.0), "ABS"),
    (dict(ret1=1.0, spike=2.0, delivPctDiff=10, clv=0.0), None),  # |ret| must be < 1
    (dict(ret1=2.0, spike=0.5, delivPctDiff=-10, relVol=2), "SPU"),
    (dict(ret1=-2.0, spike=0.5, delivPctDiff=-10, relVol=2), "SPD"),
    (dict(ret1=2.0, spike=0.5, delivPctDiff=-9.9, relVol=2), None),
    (dict(ret1=2.0, spike=0.5, delivPctDiff=-10, relVol=1.9), None),
    (dict(ret1=1.5, spike=2.0, delivPctDiff=10, clv=0.5), "ACC"),  # first matching rule wins over ABS-like values
    (dict(ret1=1.5, spike=5, delivPctDiff=20, clv=0.5, sigOk=False), None),
])
def test_signal_boundaries(kw, exp):
    assert metrics.classify_signal(_sig_frame(**kw), THR).iloc[0] == exp


def test_signal_needs_history_and_liquidity():
    df = run(frame(n=30))
    assert df["signal"].isna().iloc[:10].all()
