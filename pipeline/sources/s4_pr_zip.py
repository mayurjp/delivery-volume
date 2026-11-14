"""S4: PR zip (market cap, corporate actions, price-band hits)."""

from __future__ import annotations

import csv
import io
import re
import zipfile
from datetime import date

import pandas as pd

from .base import EXCLUDED_SERIES, Parsed, SourceSpec, decode, num, parse_dmy_mon, tokens

MCAP_HEADER = ["Trade Date", "Symbol", "Series", "Security Name", "Category", "Last Trade Date", "Face Value(Rs.)",
               "Issue Size", "Close Price/Paid up value(Rs.)", "Market Cap(Rs.)"]
BC_HEADER = ["SERIES", "SYMBOL", "SECURITY", "RECORD_DT", "BC_STRT_DT", "BC_END_DT", "EX_DT", "ND_STRT_DT",
             "ND_END_DT", "PURPOSE"]
BH_HEADER = ["SYMBOL", "SERIES", "SECURITY", "HIGH/LOW"]
EQUITY_SERIES = ("EQ", "BE", "BZ")  # SM/ST excluded by user decision
ETF_HEADER = ["MARKET", "SERIES", "SYMBOL", "SECURITY", "PREVIOUS CLOSE PRICE", "OPEN PRICE", "HIGH PRICE",
              "LOW PRICE", "CLOSE PRICE", "NET TRADED VALUE", "NET TRADED QTY", "TRADES", "52 WEEK HIGH",
              "52 WEEK LOW", "UNDERLYING"]
ETF_COLUMNS = ["symbol", "series"]  # the stored daily extract (store/etf/)


def url(d: date) -> str:
    return f"https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{tokens(d)['DDMMYY']}.zip"


def classify_purpose(purpose: str) -> str:
    """Free-text PURPOSE -> DIVIDEND | BONUS | SPLIT | RIGHTS | BUYBACK | OTHER.

    NSE abbreviates heavily (INTDIV, FVSPLT, BUY BACK), so match on stems. Order matters: price-adjusting events
    (bonus, split) win over dividend when a purpose contains several.
    """
    s = purpose.upper()
    if "BONUS" in s:
        return "BONUS"
    if re.search(r"SPLIT|SPLT|SUB-?DIV|FVSPL", s):
        return "SPLIT"
    if re.search(r"BUY ?-?BACK", s):
        return "BUYBACK"
    if "RIGHT" in s:
        return "RIGHTS"
    if "DIV" in s:
        return "DIVIDEND"
    return "OTHER"


def _csv_member(z: zipfile.ZipFile, prefix: str, d: date) -> str | None:
    want = f"{prefix}{tokens(d)['DDMMYYYY']}.csv".lower()
    for n in z.namelist():
        if n.lower() == want:
            return decode(z.read(n))
    return None


def _read(text: str) -> tuple[list[str], list[list[str]]]:
    rows = list(csv.reader(io.StringIO(text)))
    return [c.strip() for c in rows[0]], rows[1:]


def parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    try:
        z = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile:
        p.errors.append("bad zip")
        return p
    p.notes.append("members: " + ",".join(sorted(n.split(tokens(d)["DDMMYYYY"])[0] or n for n in z.namelist())))
    out: dict[str, object] = {}
    headers = {}
    # mcap
    t = _csv_member(z, "mcap", d)
    if t is None:
        p.errors.append("mcap member missing")
    else:
        h, rows = _read(t)
        headers["mcap"] = h
        if h != MCAP_HEADER:
            p.errors.append(f"schema_mismatch: mcap header {h}")
        else:
            df = pd.DataFrame([[c.strip() for c in r] for r in rows], columns=h)
            td = {parse_dmy_mon(x) for x in df["Trade Date"].unique()}
            if td != {d}:
                p.errors.append(f"mcap Trade Date mismatch {sorted(str(x) for x in td)}")
            df = df.rename(columns={"Symbol": "symbol", "Series": "series", "Issue Size": "issueSize",
                                    "Market Cap(Rs.)": "mcapRs"})
            df["issueSize"] = num(df["issueSize"])
            df["mcapRs"] = num(df["mcapRs"])
            df = df[~df["series"].isin(EXCLUDED_SERIES)][["symbol", "series", "issueSize", "mcapRs"]]
            if len(df) < 1500:
                p.errors.append(f"mcap rows {len(df)} < 1500")
            out["mcap"] = df.reset_index(drop=True)
            p.rows = len(df)
    # bc
    t = _csv_member(z, "bc", d)
    if t is None:
        p.errors.append("bc member missing")
    else:
        h, rows = _read(t)
        headers["bc"] = h
        if h != BC_HEADER:
            p.errors.append(f"schema_mismatch: bc header {h}")
        else:
            df = pd.DataFrame([[c.strip() for c in r] + [""] * (len(h) - len(r)) for r in rows], columns=h)
            df = df[df["SERIES"].isin(EQUITY_SERIES)].copy()
            df["kind"] = df["PURPOSE"].map(classify_purpose)
            out["bc"] = df.reset_index(drop=True)
    # bh (kept as downloaded; only validated here)
    t = _csv_member(z, "bh", d)
    if t is None:
        p.errors.append("bh member missing")
    else:
        h, rows = _read(t)
        headers["bh"] = h
        if h != BH_HEADER:
            p.errors.append(f"schema_mismatch: bh header {h}")
        else:
            out["bh_text"] = t
            out["bh_rows"] = len(rows)
    # bm: board meetings (07 section 8). Optional, like etf: a missing member never fails the day
    t = None
    for n in z.namelist():
        if n.lower() == f"{BM_MEMBER_PREFIX}{tokens(d)['DDMMYYYY']}.txt":
            t = decode(z.read(n))
            break
    if t is None:
        p.notes.append("bm member missing")
    else:
        out["bm"] = parse_bm(t)
    # etf: the list of ETFs / index funds traded that day. Optional: a missing or changed member never fails the day
    t = _csv_member(z, "etf", d)
    if t is None:
        p.notes.append("etf member missing")
    else:
        h, rows = _read(t)
        headers["etf"] = h
        if h != ETF_HEADER:
            p.notes.append(f"etf header changed, extract skipped: {h}")
        else:
            df = pd.DataFrame([[c.strip() for c in r] for r in rows if r], columns=h)
            df = df.rename(columns={"SYMBOL": "symbol", "SERIES": "series"})
            df = df[df["symbol"] != ""][ETF_COLUMNS].drop_duplicates().sort_values(ETF_COLUMNS)
            out["etf"] = df.reset_index(drop=True)
    p.header = headers.get("mcap")
    p.notes.append(f"bh header: {headers.get('bh')}; bh rows {out.get('bh_rows')}; bc header: {headers.get('bc')}")
    p.data = out
    return p


BM_MEMBER_PREFIX = "bm"
BM_COLUMNS = ["symbol", "meetingDate", "purpose"]
RESULTS_PURPOSE = "financial results"


def parse_bm(text: str) -> pd.DataFrame:
    """S4 `bm{DDMMYYYY}.txt` (board meetings). Verified 2026-11-13 (SOURCE_STATUS): a header line, then one meeting per
    line as `Company name SYMBOL : DD-MON-YYYY : PURPOSE`. The purpose can repeat ` : ` (re-scheduled notices), so the
    line is split at most twice. Lines that do not parse are dropped, never guessed."""
    from .base import parse_dmy_mon

    rows = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.upper().startswith("COMPANY NAME"):
            continue
        parts = line.split(" : ", 2)
        if len(parts) != 3:
            continue
        head, when, purpose = parts
        sym = head.rsplit(" ", 1)[-1].strip()
        dt = parse_dmy_mon(when)
        if not sym or dt is None:
            continue
        rows.append((sym, dt.isoformat(), purpose.strip()))
    return pd.DataFrame(rows, columns=BM_COLUMNS)


def results_dates(bm: pd.DataFrame) -> pd.DataFrame:
    """Board meetings whose purpose includes "Financial Results" (07 section 2 `events`)."""
    m = bm["purpose"].str.lower().str.contains(RESULTS_PURPOSE, regex=False)
    return bm.loc[m].reset_index(drop=True)



SPEC = SourceSpec("S4", "pr_zip", "PR zip (mcap, bc, bh)", "zip", lambda d: [("", url(d))], parse, fetchable=True)
