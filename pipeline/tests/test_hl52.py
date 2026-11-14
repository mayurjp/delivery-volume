"""52-week high/low flags: file(T) holds values through T-1, so a break is high(T) > file(T).high52."""

import numpy as np
import pandas as pd
import pytest

from pipeline import store
from pipeline.build.outputs import hl52_breaks


def test_boundaries_and_missing_values():
    hi, lo = hl52_breaks(pd.Series([101.0, 100.0, 99.0, 50.0]), pd.Series([10.0, 10.0, 10.0, 10.0]),
                         pd.Series([100.0, 100.0, np.nan, np.nan]), pd.Series([10.0, 11.0, np.nan, 5.0]))
    assert hi.tolist() == [True, False, False, False]  # equal is not a new high; missing never flags
    assert lo.tolist() == [False, True, False, False]


@pytest.mark.skipif(len(store.list_dates("hl52")) < 2, reason="needs stored hl52")
def test_real_day_pair_new_highs_match_manual_check():
    d = store.list_dates("hl52")[-1]
    f = pd.read_csv(store.path_for("hl52", d), dtype=str, keep_default_na=False)
    f = f[f["series"] == "EQ"]
    s1 = pd.read_csv(store.path_for("cm_delivery", d), dtype=str, keep_default_na=False)
    s1.columns = [c.strip() for c in s1.columns]
    s1 = s1[s1["SERIES"].str.strip() == "EQ"]
    m = f.merge(s1, left_on="symbol", right_on="SYMBOL")
    hi, lo = hl52_breaks(m["HIGH_PRICE"], m["LOW_PRICE"], m["high52"], m["low52"])
    # the stored file's newest high date is the previous trading day, never d itself, so the old rule could not fire
    assert not (f["high52Date"].str.upper() == f"{d.day:02d}-{d:%b}-{d.year}".upper()).any()
    assert hi.sum() > 0 and lo.sum() > 0
    manual = sum(float(h) > float(x) for h, x in zip(m["HIGH_PRICE"], m["high52"]) if x not in ("", "-"))
    assert hi.sum() == manual
