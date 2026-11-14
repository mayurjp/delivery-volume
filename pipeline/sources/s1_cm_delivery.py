"""S1: security-wise delivery (sec_bhavdata_full). Primary source."""

from __future__ import annotations

from datetime import date

import pandas as pd

from .base import EXCLUDED_SERIES, Parsed, SourceSpec, decode, num, parse_dmy_mon, read_csv_text, tokens

EXPECTED_HEADER = [
    "SYMBOL", "SERIES", "DATE1", "PREV_CLOSE", "OPEN_PRICE", "HIGH_PRICE", "LOW_PRICE", "LAST_PRICE",
    "CLOSE_PRICE", "AVG_PRICE", "TTL_TRD_QNTY", "TURNOVER_LACS", "NO_OF_TRADES", "DELIV_QTY", "DELIV_PER",
]
NUMERIC = EXPECTED_HEADER[3:]
RENAME = {
    "SYMBOL": "sym", "SERIES": "series", "DATE1": "date", "PREV_CLOSE": "prevClose", "OPEN_PRICE": "open",
    "HIGH_PRICE": "high", "LOW_PRICE": "low", "LAST_PRICE": "last", "CLOSE_PRICE": "close", "AVG_PRICE": "vwap",
    "TTL_TRD_QNTY": "vol", "TURNOVER_LACS": "turnoverLacs", "NO_OF_TRADES": "trades",
    "DELIV_QTY": "delivQty", "DELIV_PER": "delivPct",
}


def url(d: date) -> str:
    return f"https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{tokens(d)['DDMMYYYY']}.csv"


def parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    df = read_csv_text(decode(body), skipinitialspace=True)
    df.columns = [c.strip() for c in df.columns]
    for c in ("SYMBOL", "SERIES", "DATE1"):  # numeric columns tolerate stray spaces in to_numeric; skip strip cost
        if c in df.columns:
            df[c] = df[c].str.strip()
    p.header = list(df.columns)
    if p.header != EXPECTED_HEADER:
        p.errors.append(f"schema_mismatch: header {p.header}")
        return p
    raw_rows = len(df)
    p.rows = raw_rows
    counts = df["SERIES"].value_counts().to_dict()
    p.notes.append("series counts: " + ", ".join(f"{k} {v}" for k, v in counts.items()))
    # date check: every row must carry the requested date
    dates = {parse_dmy_mon(x) for x in df["DATE1"].unique()}
    if dates != {d}:
        p.errors.append(f"DATE1 mismatch: {sorted(str(x) for x in dates)} != {d}")
    for c in NUMERIC:
        df[c] = num(df[c])
    # >= 99% of numeric fields parse (a '-' in the delivery columns is legitimate and not counted)
    core = df[NUMERIC[:-2]]
    if core.size and core.notna().to_numpy().mean() < 0.99:
        p.errors.append("fewer than 99% of numeric fields parse")
    if not 2000 <= raw_rows <= 8000:
        p.errors.append(f"row count {raw_rows} outside 2000-8000")
    if counts.get("EQ", 0) < 1500:
        p.errors.append(f"EQ rows {counts.get('EQ', 0)} < 1500")
    df = df[~df["SERIES"].isin(EXCLUDED_SERIES)].rename(columns=RENAME)
    df["date"] = d.isoformat()
    p.data = df.reset_index(drop=True)
    return p


def parse_stored(body: bytes, d: date) -> pd.DataFrame:
    """Parse a stored (already validated) file for build; raises on schema problems."""
    p = parse(body, d)
    if p.errors:
        raise ValueError("; ".join(p.errors))
    return p.data


SPEC = SourceSpec("S1", "cm_delivery", "Security-wise delivery (sec_bhavdata_full)", "csv",
                  lambda d: [("", url(d))], parse, fetchable=True)
