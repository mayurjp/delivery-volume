"""Shared types and helpers for source modules (S1-S16)."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable

import pandas as pd

from ..http import is_xls, is_zip, looks_like_html

MONTHS = {m: i for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], start=1)}
MON_TITLE = [m.title() for m in MONTHS]

EXCLUDED_SERIES = ("SM", "ST")  # SME series: dropped at parse time (user decision)


def tokens(d: date) -> dict[str, str]:
    return {
        "DDMMYYYY": f"{d:%d%m%Y}",
        "DDMMYY": f"{d:%d%m%y}",
        "YYYYMMDD": f"{d:%Y%m%d}",
        "DD-Mon-YYYY": f"{d.day:02d}-{MON_TITLE[d.month - 1]}-{d.year}",
    }


def parse_dmy_mon(s: str) -> date | None:
    """'13-Nov-2026', '13-NOV-2026', '13 NOV 2026' -> date (locale independent)."""
    m = re.fullmatch(r"\s*(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})\s*", str(s))
    if not m or m.group(2).upper() not in MONTHS:
        return None
    try:
        return date(int(m.group(3)), MONTHS[m.group(2).upper()], int(m.group(1)))
    except ValueError:
        return None


def parse_dmy_dash(s: str) -> date | None:
    """'13-11-2026' -> date."""
    try:
        return datetime.strptime(str(s).strip(), "%d-%m-%Y").date()
    except ValueError:
        return None


@dataclass
class Parsed:
    header: list[str] | None = None
    rows: int = 0
    data: Any = None
    errors: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass
class SourceSpec:
    id: str  # "S1"
    key: str  # config key, e.g. "cm_delivery"
    name: str
    kind: str  # csv | zip | xls | json | text
    urls: Callable[[date], list[tuple[str, str]]]  # [(label, url)]
    parse: Callable[[bytes, date, str], Parsed]  # (body, date, label) -> Parsed
    verified: str = "VERIFIED"
    history: bool = True
    cookie_gated: bool = False
    fetchable: bool = False  # implemented in `fetch` (Phase 1)
    warm: tuple[str, ...] = ()  # www.nseindia.com pages to visit first (cookie-gated APIs)
    referer: str | None = None  # Referer override for cookie-gated APIs

    def check_body(self, body: bytes) -> str | None:
        """Cheap content-type validation. Returns an error string or None."""
        if not body:
            return "empty body"
        if self.kind == "zip" and not is_zip(body):
            return "not a zip (missing PK magic)"
        if self.kind == "xls" and not is_xls(body):
            return "not a legacy .xls (missing CDFV2 signature)"
        if self.kind in ("csv", "text") and looks_like_html(body):
            return "HTML body returned instead of data"
        return None


def decode(body: bytes) -> str:
    return body.decode("utf-8-sig", errors="replace")


def read_csv_text(text: str, **kw) -> pd.DataFrame:
    return pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False, **kw)


def strip_df(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [str(c).strip() for c in df.columns]
    for c in df.columns:
        df[c] = df[c].astype(str).str.strip()
    return df


def num(s: pd.Series) -> pd.Series:
    """Numeric parse; '-' and '' -> NaN (never 0)."""
    return pd.to_numeric(s.replace({"-": None, "": None}), errors="coerce")
