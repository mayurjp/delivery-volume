"""S17 NSE symbol changes (symbolchange.csv): old symbol -> new symbol with the effective date (docs/specs/02 S17)."""

from __future__ import annotations

from datetime import date

import pandas as pd

from .base import Parsed, SourceSpec, decode, parse_dmy_mon, read_csv_text, strip_df

URL = "https://nsearchives.nseindia.com/content/equities/symbolchange.csv"
HEADER = ["NAME OF THE COMPANY", "OLD SYMBOL", "NEW SYMBOL", "EFFECTIVE DATE"]


def parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    df = strip_df(read_csv_text(decode(body)))
    p.header = list(df.columns)
    if p.header != HEADER:
        p.errors.append(f"schema_mismatch: header {p.header}")
        return p
    p.rows = len(df)
    if p.rows < 500:
        p.errors.append(f"row count {p.rows} < 500")
    eff = df["EFFECTIVE DATE"].map(parse_dmy_mon)
    if eff.isna().mean() > 0.01:
        p.errors.append("more than 1% of EFFECTIVE DATE values do not parse")
    df["effective"] = eff.map(lambda x: x.isoformat() if x else None)
    p.data = df
    return p


def changes(text: str) -> pd.DataFrame:
    """Stored/served CSV text -> frame (old, new, effective ISO date, name), stripped, unparseable rows dropped."""
    df = strip_df(read_csv_text(text))
    eff = df["EFFECTIVE DATE"].map(parse_dmy_mon)
    out = pd.DataFrame({"old": df["OLD SYMBOL"], "new": df["NEW SYMBOL"],
                        "effective": eff.map(lambda x: x.isoformat() if x else None), "name": df["NAME OF THE COMPANY"]})
    out = out[out["effective"].notna() & (out["old"] != "") & (out["new"] != "") & (out["old"] != out["new"])]
    return out.reset_index(drop=True)


SPEC = SourceSpec("S17", "symbol_change", "NSE symbol changes (symbolchange.csv)", "csv", lambda d: [("", URL)], parse,
                  history=False, fetchable=True)
