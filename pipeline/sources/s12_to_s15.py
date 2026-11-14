"""S12 indices close, S13 52-week high/low, S14 F&O ban list, S15 equity master list."""

from __future__ import annotations

import io
import re
from datetime import date

import pandas as pd

from .base import Parsed, SourceSpec, decode, num, parse_dmy_dash, parse_dmy_mon, read_csv_text, strip_df, tokens

B = "https://nsearchives.nseindia.com/"

# ---- S12 -------------------------------------------------------------------------------------------------------
S12_HEADER = ["Index Name", "Index Date", "Open Index Value", "High Index Value", "Low Index Value",
              "Closing Index Value", "Points Change", "Change(%)", "Volume", "Turnover (Rs. Cr.)", "P/E", "P/B",
              "Div Yield"]


def s12_parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    df = strip_df(read_csv_text(decode(body)))
    p.header = list(df.columns)
    if p.header != S12_HEADER:
        p.errors.append(f"schema_mismatch: header {p.header}")
        return p
    p.rows = len(df)
    # some indices may lag with older dates; require that the requested date is present
    if d not in {parse_dmy_dash(x) for x in df["Index Date"].unique()} or p.rows < 20:
        p.errors.append("Index Date does not match requested date (or too few rows)")
    if "Nifty 50" not in set(df["Index Name"]):
        p.errors.append("Nifty 50 row missing")
    for c in S12_HEADER[2:]:
        df[c] = num(df[c])  # handles values like '-.61'
    p.data = df
    return p


SPEC_S12 = SourceSpec("S12", "indices_close", "All-index closing values", "csv",
                      lambda d: [("", B + f"content/indices/ind_close_all_{tokens(d)['DDMMYYYY']}.csv")],
                      s12_parse, fetchable=True)

# ---- S13 -------------------------------------------------------------------------------------------------------
S13_HEADER = ["SYMBOL", "SERIES", "Adjusted_52_Week_High", "52_Week_High_Date", "Adjusted_52_Week_Low",
              "52_Week_Low_DT"]


def s13_parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    text = decode(body)
    lines = text.splitlines()
    # two quoted disclaimer lines precede the header
    idx = next((i for i, ln in enumerate(lines) if ln.startswith('"SYMBOL"')), None)
    if idx is None:
        p.errors.append("schema_mismatch: header line not found")
        return p
    df = strip_df(read_csv_text("\n".join(lines[idx:])))
    p.header = list(df.columns)
    if p.header != S13_HEADER:
        p.errors.append(f"schema_mismatch: header {p.header}")
        return p
    p.rows = len(df)
    if p.rows < 1500:
        p.errors.append(f"row count {p.rows} < 1500")
    eff = [ln for ln in lines[:idx] if "Effective for" in ln]
    if eff:
        dm = parse_dmy_mon(eff[0].split("Effective for")[1].strip(' "'))
        if dm != d:
            p.errors.append(f"effective date {dm} != {d}")
    df["hi"] = num(df["Adjusted_52_Week_High"])
    df["lo"] = num(df["Adjusted_52_Week_Low"])
    p.data = df
    return p


SPEC_S13 = SourceSpec("S13", "hl52", "52-week high/low (adjusted)", "csv",
                      lambda d: [("", B + f"content/CM_52_wk_High_low_{tokens(d)['DDMMYYYY']}.csv")], s13_parse,
                      fetchable=True)

# ---- S14 -------------------------------------------------------------------------------------------------------


def s14_parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    lines = [ln.strip() for ln in decode(body).splitlines() if ln.strip()]
    if not lines or not lines[0].startswith("Securities in Ban For Trade Date"):
        p.errors.append("schema_mismatch: first line is not the ban-list title")
        return p
    p.header = [lines[0]]
    # an empty list is "...Trade Date 04-NOV-2025: NIL" on the same line
    m = re.search(r"Date\s+(\d{1,2}-[A-Za-z]{3}-\d{4})", lines[0])
    dm = parse_dmy_mon(m.group(1)) if m else None
    if dm != d:
        p.errors.append(f"title date {dm} != {d}")
    syms = [ln.split(",", 1)[1].strip() for ln in lines[1:] if "," in ln]
    p.rows = len(syms)
    p.data = syms
    return p


SPEC_S14 = SourceSpec("S14", "fo_ban", "F&O ban list", "csv",
                      lambda d: [("", B + f"archives/fo/sec_ban/fo_secban_{tokens(d)['DDMMYYYY']}.csv")], s14_parse,
                      fetchable=True)

# ---- S15 -------------------------------------------------------------------------------------------------------
S15_HEADER = ["SYMBOL", "NAME OF COMPANY", "SERIES", "DATE OF LISTING", "PAID UP VALUE", "MARKET LOT",
              "ISIN NUMBER", "FACE VALUE"]


def s15_parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    df = strip_df(read_csv_text(decode(body)))
    p.header = list(df.columns)
    if p.header != S15_HEADER:
        p.errors.append(f"schema_mismatch: header {p.header}")
        return p
    p.rows = len(df)
    if p.rows < 1500:
        p.errors.append(f"row count {p.rows} < 1500")
    p.data = df
    return p


def read_snapshot_csv(text: str) -> pd.DataFrame:
    return strip_df(pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False))


SPEC_S15 = SourceSpec("S15", "equity_list", "Equity master list (EQUITY_L)", "csv",
                      lambda d: [("", B + "content/equities/EQUITY_L.csv")], s15_parse, history=False,
                      fetchable=True)
