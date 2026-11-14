"""F&O analytics (docs/specs/04 section 4.4): build-up boundaries, futOi / roll / pcr rules, the S3 extract and the fetch
idempotency. Fast tests only: they use committed fixtures (pipeline/tests/fixtures/fo_extract) or synthetic data, never
site/public/data."""

from __future__ import annotations

import gzip
import io
import zipfile
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pipeline import fo, store
from pipeline.fetch import SKIPPED, STORED, fetch_s3
from pipeline.http import Response
from pipeline.sources import s3_fo_udiff as s3
from pipeline.sources.s2_cm_udiff import UDIFF_HEADER

FIX = Path(__file__).parent / "fixtures" / "fo_extract"


# ---- build-up classification: the boundaries (06 Phase 5 acceptance) ------------------------------------------------

@pytest.mark.parametrize("ret1, oi, want", [
    (0.01, 2.0, "LB"),      # price up, OI change exactly +2: included (>=)
    (0.01, 1.99, None),     # just inside the band: no code
    (0.0, 5.0, None),       # flat price is neither up nor down
    (-0.01, 2.0, "SB"),
    (-0.5, -2.0, "LU"),     # price down, OI change exactly -2: included (<=)
    (-0.5, -1.99, None),
    (0.5, -2.0, "SC"),
    (0.5, -1.99, None),
    (0.5, 0.0, None),
    (-0.5, 1.99, None),
    (None, 5.0, None),
    (0.5, None, None),
    (float("nan"), 5.0, None),
    (2.0, float("nan"), None),
])
def test_classify_buildup_boundaries(ret1, oi, want):
    assert fo.classify_buildup(ret1, oi) == want


def test_classify_threshold_is_a_parameter():
    assert fo.classify_buildup(0.5, 1.5, thr=1.5) == "LB"
    assert fo.classify_buildup(0.5, 1.5) is None


def test_vector_classifier_agrees_with_the_scalar_rule_on_a_grid():
    rets = np.array([-1.0, -0.01, -0.001, 0.0, 0.001, 0.01, 1.0])
    ois = np.array([-3.0, -2.0, -1.99, 0.0, 1.99, 2.0, 3.0])
    r, o = np.meshgrid(rets, ois, indexing="ij")
    vec = fo.classify_buildup_vec(r.ravel(), o.ravel())
    scalar = [fo.classify_buildup(a, b) for a, b in zip(r.ravel(), o.ravel())]
    assert [v or None for v in vec] == scalar


def test_price_is_the_published_two_dp_value():
    # a 0.004% move publishes as 0.00 and so has no direction (04 section 6: thresholds on the published values)
    assert fo.classify_buildup_vec(np.array([0.004]), np.array([5.0]))[0] == ""


# ---- futOi, roll, gap and pcr -----------------------------------------------------------------------------------------

DAYS = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"]


def _fo_rows(rows):
    return pd.DataFrame(rows, columns=["sym", "date", "instType", "expiry", "optType", "oi"])


def test_fo_frame_sums_futures_roll_gap_and_pcr():
    rows = [
        # A: two expiries on day 0; day 1 adds OI; an expiry falls on day 2 (a roll: change not measured)
        ("A", DAYS[0], "STF", "2026-01-29", "", 100), ("A", DAYS[0], "STF", "2026-02-26", "", 50),
        ("A", DAYS[0], "STO", "2026-01-29", "PE", 60), ("A", DAYS[0], "STO", "2026-01-29", "CE", 40),
        ("A", DAYS[1], "STF", "2026-01-29", "", 120), ("A", DAYS[1], "STF", "2026-02-26", "", 60),
        ("A", DAYS[2], "STF", "2026-01-06", "", 200), ("A", DAYS[2], "STF", "2026-02-26", "", 90),
        # B: no row on day 1, so day 2 is not compared with day 0 (not the previous trading day)
        ("B", DAYS[0], "STF", "2026-01-29", "", 10), ("B", DAYS[0], "STO", "2026-01-29", "PE", 5),
        ("B", DAYS[2], "STF", "2026-01-29", "", 12),
    ]
    rows.append(("C", DAYS[0], "STF", "2026-01-29", "", 30))  # C: no options, so pcr is null
    out = fo.fo_frame(_fo_rows(rows), DAYS).set_index(["sym", "date"])
    a0, a1, a2 = out.loc[("A", DAYS[0])], out.loc[("A", DAYS[1])], out.loc[("A", DAYS[2])]
    assert a0["futOi"] == 150 and np.isnan(a0["dOi"])  # first row: nothing to compare with
    assert a1["futOi"] == 180 and a1["dOi"] == pytest.approx(20.0)  # 180 / 150 - 1, per cent
    assert np.isnan(a2["dOi"])  # expiry 2026-01-06 is in [t-1, t]: roll
    assert a0["pcr"] == pytest.approx(1.5)  # 60 PE / 40 CE
    assert np.isnan(out.loc[("B", DAYS[2])]["dOi"])  # gap in the previous trading day
    assert np.isnan(out.loc[("B", DAYS[0])]["pcr"])  # put OI but no call OI: null
    assert np.isnan(out.loc[("C", DAYS[0])]["pcr"])


def test_fo_frame_universe_is_stock_futures_days_only():
    rows = [("A", DAYS[0], "STO", "2026-01-29", "CE", 10), ("A", DAYS[0], "STO", "2026-01-29", "PE", 10)]
    assert len(fo.fo_frame(_fo_rows(rows), DAYS)) == 0


# ---- the S3 extract: conversion from the raw UDiFF bhavcopy ------------------------------------------------------------

def _raw_csv(d: date) -> str:
    """A synthetic UDiFF CSV with the real header: 120 stock futures, one stock with 2 strikes of options, filler rows."""
    lines = [",".join(UDIFF_HEADER)]

    def row(**kw):
        base = {c: "" for c in UDIFF_HEADER}
        base.update({"TradDt": d.isoformat(), "BizDt": d.isoformat(), "FinInstrmTp": "STF", "TckrSymb": "X",
                     "XpryDt": "2026-12-29", "ClsPric": "100", "OpnIntrst": "0", "ChngInOpnIntrst": "0",
                     "TtlTradgVol": "0", "TtlTrfVal": "0", "SttlmPric": "100", "UndrlygPric": "100"})
        base.update({k: str(v) for k, v in kw.items()})
        return ",".join(base[c] for c in UDIFF_HEADER)

    for i in range(120):
        lines.append(row(TckrSymb=f"S{i:03d}", OpnIntrst=1000 + i, TtlTradgVol=5))
    lines.append(row(TckrSymb="S000", FinInstrmTp="STF", XpryDt="2027-01-25", OpnIntrst=7))  # second expiry
    lines.append(row(TckrSymb="S000", FinInstrmTp="STO", XpryDt="2026-12-29", OptnTp="CE", StrkPric="100",
                     OpnIntrst=40, ChngInOpnIntrst=2, TtlTradgVol=3, TtlTrfVal=9))
    lines.append(row(TckrSymb="S000", FinInstrmTp="STO", XpryDt="2026-12-29", OptnTp="CE", StrkPric="110",
                     OpnIntrst=60, ChngInOpnIntrst=1, TtlTradgVol=4, TtlTrfVal=8))
    lines.append(row(TckrSymb="S000", FinInstrmTp="STO", XpryDt="2026-12-29", OptnTp="PE", StrkPric="100",
                     OpnIntrst=50, TtlTradgVol=1, TtlTrfVal=1))
    for i in range(900):
        lines.append(row(TckrSymb=f"I{i:03d}", FinInstrmTp="IDO", XpryDt="2026-12-29", OptnTp="PE", StrkPric="20000"))
    return "\n".join(lines) + "\n"


def _zip(text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("BhavCopy_NSE_FO_0_0_0_20260113_F_0000.csv", text)
    return buf.getvalue()


def test_s3_parse_builds_the_reduced_extract_format():
    d = date(2026, 1, 13)
    p = s3.parse(_zip(_raw_csv(d)), d)
    assert p.ok, p.errors
    ext = p.data
    assert list(ext.columns) == s3.EXTRACT_COLS
    stf = ext[ext["instType"] == "STF"]
    assert len(stf) == 121  # 120 symbols + the second expiry of S000
    opt = ext[ext["instType"] == "STO"]
    ce = opt[(opt["symbol"] == "S000") & (opt["optType"] == "CE")]
    assert len(ce) == 1 and ce["oi"].iloc[0] == 100  # two strikes summed
    assert opt["close"].isna().all() and opt["settle"].isna().all()


def test_s3_extract_rejects_a_day_with_too_few_stock_futures():
    d = date(2026, 1, 13)
    lines = _raw_csv(d).splitlines()
    text = "\n".join([lines[0]] + [ln for ln in lines[1:] if ",STF," not in ln]) + "\n"
    with pytest.raises(ValueError, match="too few STF rows"):
        s3.extract(text, d)


def _fake_client(body: bytes):
    class C_:
        def __init__(self):
            self.calls: list[str] = []

        def get(self, url, source=None, date=None, **kw):
            self.calls.append(url)
            return Response(url=url, http=200, body=body, ms=1)

        def log(self, *a, **k):
            return None

    return C_()


@pytest.fixture()
def tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "STORE_DIR", tmp_path)
    return tmp_path


def test_fetch_s3_skips_an_existing_day_without_a_request(tmp_store):
    d = date(2026, 1, 13)
    dest = store.path_for("fo_extract", d)
    dest.parent.mkdir(parents=True)
    dest.write_bytes((FIX / "2026-11-13.csv.gz").read_bytes())
    client = _fake_client(_zip(_raw_csv(d)))
    assert fetch_s3(client, d, force=False) == SKIPPED
    assert client.calls == []  # idempotent: an existing extract is never re-fetched
    assert dest.read_bytes() == (FIX / "2026-11-13.csv.gz").read_bytes()


def test_fetch_s3_stores_a_missing_day_in_the_same_format(tmp_store):
    d = date(2026, 1, 13)
    client = _fake_client(_zip(_raw_csv(d)))
    assert fetch_s3(client, d, force=False) == STORED
    assert len(client.calls) == 1
    back = pd.read_csv(io.BytesIO(store.read_bytes(store.path_for("fo_extract", d))), keep_default_na=False,
                       dtype={"optType": str})
    assert list(back.columns) == s3.EXTRACT_COLS
    # a second run finds the file and makes no request
    assert fetch_s3(client, d, force=False) == SKIPPED and len(client.calls) == 1


def test_committed_fixture_has_the_stored_format_and_no_duplicate_keys():
    for name in ("2026-11-12.csv.gz", "2026-11-13.csv.gz"):
        df = pd.read_csv(io.BytesIO(gzip.decompress((FIX / name).read_bytes())), keep_default_na=False,
                         dtype={"optType": str})
        assert list(df.columns) == s3.EXTRACT_COLS
        assert not df.duplicated(["symbol", "instType", "expiry", "optType"]).any()
        assert set(df["symbol"]) == {"ABCAPITAL", "HDFCBANK", "RELIANCE", "TCS"}


def test_fixture_day_pair_gives_a_change_for_the_second_day():
    days = ["2026-11-12", "2026-11-13"]
    rows = []
    for d in days:
        df = pd.read_csv(io.BytesIO(gzip.decompress((FIX / f"{d}.csv.gz").read_bytes())), keep_default_na=False,
                         dtype={"optType": str})
        df["date"] = d
        rows.append(df.rename(columns={"symbol": "sym"})[["sym", "date", "instType", "expiry", "optType", "oi"]])
    out = fo.fo_frame(pd.concat(rows, ignore_index=True), days).set_index(["sym", "date"])
    r = out.loc[("RELIANCE", "2026-11-13")]
    prev = out.loc[("RELIANCE", "2026-11-12")]
    assert r["futOi"] > 0 and prev["futOi"] > 0
    assert np.isnan(prev["dOi"])  # first day of the pair
    assert r["dOi"] == pytest.approx((r["futOi"] / prev["futOi"] - 1) * 100)


def test_attach_matches_a_plain_merge_and_leaves_non_fo_rows_null():
    rows = [("A", DAYS[0], "STF", "2026-01-29", "", 100), ("A", DAYS[1], "STF", "2026-01-29", "", 120),
            ("A", DAYS[0], "STO", "2026-01-29", "PE", 30), ("A", DAYS[0], "STO", "2026-01-29", "CE", 60),
            ("B", DAYS[1], "STF", "2026-01-29", "", 7)]
    fo_d = fo.fo_frame(_fo_rows(rows), DAYS)
    daily = pd.DataFrame({"sym": ["A", "A", "B", "C"], "date": [DAYS[0], DAYS[1], DAYS[0], DAYS[1]]})
    got = fo.attach(daily, fo_d, DAYS)
    ref = daily.merge(fo_d, on=["sym", "date"], how="left")
    for c in ("futOi", "dOi", "pcr"):
        np.testing.assert_allclose(got[c].to_numpy(dtype=float), ref[c].to_numpy(dtype=float), equal_nan=True)
    assert got.loc[1, "dOi"] == pytest.approx(20.0)  # 120 / 100 - 1
    assert got.loc[2:, "futOi"].isna().all()  # B on day 0 has no row; C never has one
    assert got.loc[0, "pcr"] == pytest.approx(0.5)  # 30 PE / 60 CE
