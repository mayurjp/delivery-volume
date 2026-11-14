"""S3: UDiFF F&O bhavcopy. Phase 0: header + units check only (the extract is Phase 5)."""

from __future__ import annotations

import zipfile
from datetime import date

import pandas as pd

from .base import Parsed, SourceSpec, read_csv_text, strip_df, tokens
from .s2_cm_udiff import UDIFF_HEADER, read_zip_csv


def url(d: date) -> str:
    return f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{tokens(d)['YYYYMMDD']}_F_0000.csv.zip"


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
        p.errors.append("TradDt mismatch")
    if p.rows < 1000:
        p.errors.append(f"row count {p.rows} < 1000")
    p.notes.append("FinInstrmTp counts: " + ", ".join(f"{k} {v}" for k, v in df["FinInstrmTp"].value_counts().items()))
    # Units analysis for OpnIntrst (contracts vs shares): see SOURCE_STATUS.md
    f = df[df["FinInstrmTp"] == "STF"].copy()
    for c in ("OpnIntrst", "NewBrdLotQty", "TtlTradgVol", "TtlTrfVal", "ClsPric"):
        f[c] = pd.to_numeric(f[c], errors="coerce")
    f = f[(f["OpnIntrst"] > 0) & (f["NewBrdLotQty"] > 0)]
    if len(f):
        oi_mult = float(((f["OpnIntrst"] % f["NewBrdLotQty"]) == 0).mean())
        vol_mult = float(((f["TtlTradgVol"] % f["NewBrdLotQty"]) == 0).mean())
        tr = f[f["TtlTradgVol"] > 0]
        ratio = float((tr["TtlTrfVal"] / (tr["TtlTradgVol"] * tr["ClsPric"])).median()) if len(tr) else float("nan")
        lot = float(f["NewBrdLotQty"].median())
        p.notes.append(
            f"OI units: {oi_mult:.0%} of STF OI values are exact multiples of lot size, vs {vol_mult:.0%} for volume; "
            f"median TtlTrfVal/(vol*close)={ratio:.0f} (median lot {lot:.0f}) => OpnIntrst is in SHARES (quantity), "
            "volume is in CONTRACTS")
    return p


SPEC = SourceSpec("S3", "fo_udiff", "UDiFF F&O bhavcopy", "zip", lambda d: [("", url(d))], parse)
