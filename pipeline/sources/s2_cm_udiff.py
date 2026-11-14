"""S2: UDiFF CM bhavcopy, used only as an ISIN map."""

from __future__ import annotations

import io
import zipfile
from datetime import date

from .base import EXCLUDED_SERIES, Parsed, SourceSpec, read_csv_text, strip_df, tokens

UDIFF_HEADER = (
    "TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,"
    "OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,"
    "ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4"
).split(",")


def url(d: date) -> str:
    return f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{tokens(d)['YYYYMMDD']}_F_0000.csv.zip"


def read_zip_csv(body: bytes) -> str:
    z = zipfile.ZipFile(io.BytesIO(body))
    return z.read(z.namelist()[0]).decode("utf-8-sig", errors="replace")


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
    if set(df["TradDt"]) != {d.isoformat()}:
        p.errors.append(f"TradDt mismatch: {sorted(set(df['TradDt']))[:3]}")
    if p.rows < 1500:
        p.errors.append(f"row count {p.rows} < 1500")
    out = df[["TckrSymb", "SctySrs", "ISIN"]].rename(columns={"TckrSymb": "symbol", "SctySrs": "series", "ISIN": "isin"})
    out = out[~out["series"].isin(EXCLUDED_SERIES) & (out["isin"] != "")]
    p.data = out.reset_index(drop=True)
    return p


SPEC = SourceSpec("S2", "cm_udiff", "UDiFF CM bhavcopy (ISIN map)", "zip", lambda d: [("", url(d))], parse,
                  fetchable=True)
