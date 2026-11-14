"""S16: shareholding-pattern filings (quarterly). Cookie-gated www.nseindia.com API; Phase 4B implements parsing.

Phase 0 only probes the listing endpoint. Endpoint candidates (see SOURCE_STATUS.md for provenance):
  A. /api/corporate-share-holdings-master?index=equities&symbol=RELIANCE        (per symbol; believed)
  B. /api/corporate-share-holdings-master?index=equities&from_date=..&to_date=.. (all companies; believed)
  C. /api/top-corp-info?symbol=RELIANCE&market=equities                          (nsepython; summary % only)
"""

from __future__ import annotations

import json
from datetime import date, timedelta

from .base import Parsed, SourceSpec

HOME = "https://www.nseindia.com/"
PAGE = "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern?symbol=RELIANCE"
BASE = "https://www.nseindia.com/api/"
PROBE_SYMBOL = "RELIANCE"


def candidates(d: date) -> list[tuple[str, str]]:
    frm = (d - timedelta(days=120)).strftime("%d-%m-%Y")
    to = d.strftime("%d-%m-%Y")
    return [
        ("A:per-symbol", f"{BASE}corporate-share-holdings-master?index=equities&symbol={PROBE_SYMBOL}"),
        ("B:date-range", f"{BASE}corporate-share-holdings-master?index=equities&from_date={frm}&to_date={to}"),
        ("C:top-corp-info", f"{BASE}top-corp-info?symbol={PROBE_SYMBOL}&market=equities"),
    ]


def parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    try:
        payload = json.loads(body)
    except ValueError:
        p.errors.append("not JSON")
        return p
    if isinstance(payload, list):
        p.rows = len(payload)
        p.header = sorted({k for r in payload[:50] if isinstance(r, dict) for k in r})
    elif isinstance(payload, dict):
        p.header = sorted(payload.keys())
        p.rows = sum(len(v) for v in payload.values() if isinstance(v, (list, dict)))
    p.notes.append(f"top-level {type(payload).__name__}; keys/columns: {p.header}")
    if not p.rows:
        p.errors.append("empty payload")
    p.data = payload
    return p


SPEC = SourceSpec("S16", "shareholding", "Shareholding-pattern listing (probe)", "json", candidates, parse,
                  verified="UNVERIFIED", cookie_gated=True, warm=(HOME, PAGE), referer=PAGE)
