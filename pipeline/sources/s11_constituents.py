"""S11: index constituents (+ sector). Current membership only."""

from __future__ import annotations

import io
from datetime import date

import pandas as pd

from .base import Parsed, SourceSpec, decode, read_csv_text, strip_df

BASE = "https://nsearchives.nseindia.com/content/indices/"
HEADER = ["Company Name", "Industry", "Symbol", "Series", "ISIN Code"]
# index key -> (file, expected rows)
FILES = {
    "NIFTY50": ("ind_nifty50list.csv", 50),
    "NIFTYNEXT50": ("ind_niftynext50list.csv", 50),
    "NIFTY100": ("ind_nifty100list.csv", 100),
    "NIFTY200": ("ind_nifty200list.csv", 200),
    "NIFTY500": ("ind_nifty500list.csv", 500),
    "MIDCAP150": ("ind_niftymidcap150list.csv", 150),
    "SMALLCAP250": ("ind_niftysmallcap250list.csv", 250),
    "MICROCAP250": ("ind_niftymicrocap250_list.csv", 250),
    "TOTALMARKET": ("ind_niftytotalmarket_list.csv", 750),
}


def urls(d: date) -> list[tuple[str, str]]:
    return [(k, BASE + f) for k, (f, _) in FILES.items()]


def parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    df = strip_df(read_csv_text(decode(body)))
    p.header = list(df.columns)
    if p.header != HEADER:
        p.errors.append(f"schema_mismatch: header {p.header}")
        return p
    p.rows = len(df)
    exp = FILES[label][1]
    if not exp * 0.95 <= p.rows <= exp * 1.05:
        p.errors.append(f"{label}: {p.rows} rows, expected about {exp}")
    p.data = df
    return p


def read_snapshot_csv(text: str) -> pd.DataFrame:
    return strip_df(pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False))


SPEC = SourceSpec("S11", "constituents", "Index constituents (+ sector)", "csv", urls, parse, history=False,
                  fetchable=True)
