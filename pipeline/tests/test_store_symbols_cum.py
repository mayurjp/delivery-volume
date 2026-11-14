import gzip
import json
from datetime import date, timedelta

import numpy as np
import pandas as pd

from pipeline import store
from pipeline.build import columns as C
from pipeline.build import outputs
from pipeline.build.schema import SCHEMA_DIR, schemas, validate
from pipeline.symbols import build_alias_map, file_key


def test_file_key():
    assert file_key("M&M") == "M_26M"
    assert file_key("BAJAJ-AUTO") == "BAJAJ-AUTO"
    assert file_key("A.B") == "A_2EB"


def test_alias_merge_by_isin():
    isin = pd.DataFrame([
        ("2026-01-01", "OLD", "INE1"), ("2026-01-02", "OLD", "INE1"),
        ("2026-01-03", "NEW", "INE1"), ("2026-01-04", "NEW", "INE1"),
        ("2026-01-01", "SAME", "INE2"), ("2026-01-02", "SAME", "INE2"),
        ("2026-01-01", "A", "INE3"), ("2026-01-01", "B", "INE3"),  # concurrent symbols: not a rename
        ("2026-01-01", "X", "INE4"), ("2026-01-02", "Y", "INE4"), ("2026-01-03", "Z", "INE4"),  # chain
    ], columns=["date", "symbol", "isin"])
    a = build_alias_map(isin)
    assert a == {"OLD": "NEW", "X": "Z", "Y": "Z"}
    assert build_alias_map(isin.iloc[0:0]) == {}


def test_atomic_write_never_overwrites_and_gzip_is_deterministic(tmp_path):
    p = tmp_path / "x" / "f.csv.gz"
    assert store.write_atomic(p, store.gz_bytes(b"a,b\n1,2\n")) is True
    first = p.read_bytes()
    assert store.write_atomic(p, store.gz_bytes(b"other")) is False  # existing dated file kept
    assert p.read_bytes() == first
    assert store.write_atomic(p, store.gz_bytes(b"other"), force=True) is True
    assert store.gz_bytes(b"same") == store.gz_bytes(b"same")  # mtime=0 -> identical bytes
    assert gzip.decompress(store.gz_bytes(b"hello")) == b"hello"
    assert not list(p.parent.glob(".tmp-*"))


def test_schema_files_in_sync():
    for name, sc in schemas().items():
        on_disk = json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))
        assert on_disk == sc, f"{name}.schema.json is stale: run write_schemas()"


def test_schema_rejects_bad_documents():
    import jsonschema
    import pytest

    good = {"schemaVersion": 1, "date": "2026-01-01", "columns": C.names(C.CUM), "rows": []}
    validate("cum", good)
    with pytest.raises(jsonschema.ValidationError):
        validate("cum", {**good, "columns": ["x"]})
    with pytest.raises(jsonschema.ValidationError):
        validate("cum", {**good, "rows": [["A", 1.0, "2026-01-01", 1.0, 1.0, 1, 1]]})  # 7 cells, expected 8


def test_cumulative_range_sums_equal_direct_sums(tmp_path):
    """Range sum X(b) - X(prev(a)) from cum files equals the direct sum over daily rows (incl. mid-range listing)."""
    rng = np.random.default_rng(7)
    days = [date(2026, 1, 1) + timedelta(days=i) for i in range(40)]
    syms = ["AAA", "BBB", "LATE", "GAP"]
    rows = []
    for di, d in enumerate(days):
        for s in syms:
            if s == "LATE" and di < 15:
                continue  # listed mid-range
            if s == "GAP" and 10 <= di < 14:
                continue  # did not trade for a few days -> carried forward
            q = float(rng.integers(100, 5000))
            vwap = float(rng.uniform(10, 500))
            rows.append(dict(sym=s, date=d.isoformat(), close=vwap, valid=True, delivQty=q, vol=q * 2,
                             delivValCr=q * vwap / 1e7, turnoverCr=q * 2 * vwap / 1e7))
    df = pd.DataFrame(rows)
    outputs.write_cum(df, days, syms, 60, tmp_path)
    outputs.flush()  # dump() writes on a thread pool; wait before reading the files back

    def cum(i):
        doc = json.loads((tmp_path / "cum" / f"{days[i].isoformat()}.json").read_text())
        return {r[0]: dict(zip(doc["columns"], r)) for r in doc["rows"]}

    for _ in range(5):
        a = int(rng.integers(1, 30))
        b = int(rng.integers(a + 3, 40))
        for s in syms:
            direct = df[(df.sym == s) & (df.date >= days[a].isoformat()) & (df.date <= days[b].isoformat())]
            cb = cum(b).get(s)
            ca = cum(a - 1).get(s)
            prior = ca["cDelivValCr"] if ca else 0.0  # absent from cum/prev(a) -> prior sum 0 (listedDuringRange)
            got = (cb["cDelivValCr"] - prior) if cb else 0.0
            assert abs(got - direct["delivValCr"].sum()) < 0.01 * (b - a + 1)  # daily/cum rounded to 2 dp
            pv = ca["cDays"] if ca else 0
            assert (cb["cDays"] - pv if cb else 0) == len(direct)
    assert "LATE" not in cum(5)  # absent before listing
    assert cum(12)["GAP"]["lastTradeDate"] == days[9].isoformat()  # carried forward with last values
