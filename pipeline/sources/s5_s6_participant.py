"""S5 / S6: participant-wise open interest / trading volume (identical layout)."""

from __future__ import annotations

from datetime import date

from .base import Parsed, SourceSpec, decode, read_csv_text, strip_df, tokens

HEADER = [
    "Client Type", "Future Index Long", "Future Index Short", "Future Stock Long", "Future Stock Short",
    "Option Index Call Long", "Option Index Put Long", "Option Index Call Short", "Option Index Put Short",
    "Option Stock Call Long", "Option Stock Put Long", "Option Stock Call Short", "Option Stock Put Short",
    "Total Long Contracts", "Total Short Contracts",
]
CLIENTS = {"Client", "DII", "FII", "Pro", "TOTAL"}


def _parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    text = decode(body)
    lines = text.splitlines()
    # line 1 is a title; line 2 is the header
    df = strip_df(read_csv_text("\n".join(lines[1:])))
    p.header = list(df.columns)
    if p.header != HEADER:
        p.errors.append(f"schema_mismatch: header {p.header}")
        return p
    df = df[df["Client Type"] != ""]
    p.rows = len(df)
    if set(df["Client Type"]) != CLIENTS:
        p.errors.append(f"unexpected participants {sorted(set(df['Client Type']))}")
        return p
    p.notes.append("title: " + lines[0].strip().strip('",'))
    tot = df[df["Client Type"] == "TOTAL"].iloc[0]
    if int(tot["Total Long Contracts"]) != int(tot["Total Short Contracts"]):
        p.errors.append("TOTAL long != TOTAL short")
    p.data = df.reset_index(drop=True)
    return p


def url_oi(d: date) -> str:
    return f"https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_{tokens(d)['DDMMYYYY']}.csv"


def url_vol(d: date) -> str:
    return f"https://nsearchives.nseindia.com/content/nsccl/fao_participant_vol_{tokens(d)['DDMMYYYY']}.csv"


SPEC_OI = SourceSpec("S5", "participant_oi", "Participant-wise open interest", "csv", lambda d: [("", url_oi(d))], _parse)
SPEC_VOL = SourceSpec("S6", "participant_vol", "Participant-wise trading volume", "csv",
                      lambda d: [("", url_vol(d))], _parse)
