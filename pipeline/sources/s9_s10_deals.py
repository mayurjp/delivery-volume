"""S9 / S10: bulk and block deals (latest trading day only at these URLs)."""

from __future__ import annotations

from datetime import date

from .base import Parsed, SourceSpec, decode, parse_dmy_mon, read_csv_text, strip_df

BULK_URL = "https://nsearchives.nseindia.com/content/equities/bulk.csv"
BLOCK_URL = "https://nsearchives.nseindia.com/content/equities/block.csv"
BULK_HEADER = ["Date", "Symbol", "Security Name", "Client Name", "Buy/Sell", "Quantity Traded",
               "Trade Price / Wght. Avg. Price", "Remarks"]
BLOCK_HEADER = BULK_HEADER[:-1]


def _make(expected: list[str]):
    def parse(body: bytes, d: date, label: str = "") -> Parsed:
        p = Parsed()
        df = strip_df(read_csv_text(decode(body)))
        p.header = list(df.columns)
        if p.header != expected:
            p.errors.append(f"schema_mismatch: header {p.header}")
            return p
        p.rows = len(df)
        dates = sorted({str(parse_dmy_mon(x)) for x in df["Date"].unique()})
        p.notes.append(f"file dates: {dates} (only the latest trading day is served; requested {d})")
        p.data = df
        return p

    return parse


SPEC_BULK = SourceSpec("S9", "deals", "Bulk deals", "csv", lambda d: [("", BULK_URL)], _make(BULK_HEADER),
                       history=False)
SPEC_BLOCK = SourceSpec("S10", "deals", "Block deals", "csv", lambda d: [("", BLOCK_URL)], _make(BLOCK_HEADER),
                        history=False)
