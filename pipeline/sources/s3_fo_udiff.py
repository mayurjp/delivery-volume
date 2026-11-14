"""S3: UDiFF F&O bhavcopy -> store/fo_extract/YYYY/YYYY-MM-DD.csv.gz (03 section 3, the reduced extract).

The raw zip (about 1.4 MB) is never stored. The extract keeps, per symbol and expiry, the futures (STF, IDF: one row
per symbol x expiry) and the options (STO, IDO: summed across strikes per symbol x expiry x optType). The conversion is
the one the standalone loader (docs/research/scripts/load_fo_extract.py) used for the 585 stored days, so a day fetched
by the pipeline is byte-for-byte the same format.
"""

from __future__ import annotations

import io
import zipfile
from datetime import date

import pandas as pd

from .base import Parsed, SourceSpec, read_csv_text, strip_df, tokens
from .s2_cm_udiff import UDIFF_HEADER, read_zip_csv

NEED = ["TradDt", "FinInstrmTp", "TckrSymb", "XpryDt", "OptnTp", "ClsPric", "SttlmPric", "UndrlygPric",
        "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol", "TtlTrfVal"]
RENAME = {"TckrSymb": "symbol", "FinInstrmTp": "instType", "XpryDt": "expiry", "OptnTp": "optType",
          "OpnIntrst": "oi", "ChngInOpnIntrst": "chgOi", "TtlTradgVol": "volume", "TtlTrfVal": "valueRs",
          "ClsPric": "close", "SttlmPric": "settle", "UndrlygPric": "underlying"}
EXTRACT_COLS = ["symbol", "instType", "expiry", "optType", "oi", "chgOi", "volume", "valueRs", "close", "settle",
                "underlying"]


def url(d: date) -> str:
    return f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{tokens(d)['YYYYMMDD']}_F_0000.csv.zip"


def extract(text: str, d: date) -> pd.DataFrame:
    """The reduced extract of one day from the raw CSV text. Raises ValueError when the day fails the basic checks."""
    df = pd.read_csv(io.StringIO(text), usecols=NEED, dtype={"OptnTp": str}, low_memory=False)
    if (df["TradDt"].astype(str) != d.isoformat()).any():
        raise ValueError(f"TradDt mismatch: {df['TradDt'].astype(str).unique()[:3]}")
    if (df["FinInstrmTp"] == "STF").sum() < 100:
        raise ValueError("too few STF rows")
    df = df.rename(columns=RENAME)
    df["optType"] = df["optType"].fillna("")
    fut = df[df["instType"].isin(["STF", "IDF"])][EXTRACT_COLS]
    opt = (df[df["instType"].isin(["STO", "IDO"])]
           .groupby(["symbol", "instType", "expiry", "optType"], as_index=False)
           .agg(oi=("oi", "sum"), chgOi=("chgOi", "sum"), volume=("volume", "sum"), valueRs=("valueRs", "sum"),
                underlying=("underlying", "first")))
    opt["close"] = pd.NA
    opt["settle"] = pd.NA
    return pd.concat([fut, opt[EXTRACT_COLS]], ignore_index=True).sort_values(
        ["instType", "symbol", "expiry", "optType"])


def parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    try:
        text = read_zip_csv(body)
    except zipfile.BadZipFile:
        p.errors.append("bad zip")
        return p
    df = strip_df(read_csv_text(text))
    p.header = list(df.columns)
    if p.header != UDIFF_HEADER:
        p.errors.append(f"schema_mismatch: header {p.header}")
        return p
    p.rows = len(df)
    if p.rows < 1000:
        p.errors.append(f"row count {p.rows} < 1000")
        return p
    try:
        p.data = extract(text, d)
    except ValueError as e:
        p.errors.append(str(e))
    return p


SPEC = SourceSpec("S3", "fo_udiff", "UDiFF F&O bhavcopy", "zip", lambda d: [("", url(d))], parse, fetchable=True)
