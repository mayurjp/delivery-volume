"""S8: FII/DII cash-market activity (provisional). Cookie-gated www.nseindia.com API, latest day only."""

from __future__ import annotations

import json
from datetime import date

from .base import Parsed, SourceSpec, parse_dmy_mon

API = "https://www.nseindia.com/api/fiidiiTradeReact"
WARM = ("https://www.nseindia.com/", "https://www.nseindia.com/reports/fii-dii")


def parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    try:
        payload = json.loads(body)
    except ValueError:
        p.errors.append("not JSON")
        return p
    if not isinstance(payload, list) or not payload:
        p.errors.append(f"unexpected payload shape: {type(payload).__name__}")
        return p
    p.header = sorted({k for r in payload for k in r})
    p.rows = len(payload)
    need = {"category", "date", "buyValue", "sellValue", "netValue"}
    if not need <= set(p.header):
        p.errors.append(f"missing keys {sorted(need - set(p.header))}")
    cats = [str(r.get("category", "")) for r in payload]
    if not any("FII" in c for c in cats) or not any("DII" in c for c in cats):
        p.errors.append(f"categories {cats}")
    dates = {parse_dmy_mon(r.get("date", "")) for r in payload}
    p.notes.append(f"payload dates: {sorted(str(x) for x in dates)}; categories: {cats}")
    if d not in dates:
        p.notes.append("requested date not in payload (API returns the latest day only)")
    p.data = payload
    return p


SPEC = SourceSpec("S8", "fii_dii_cash", "FII/DII cash activity (provisional)", "json",
                  lambda d: [("", API)], parse, verified="UNVERIFIED", history=False, cookie_gated=True,
                  warm=WARM, referer="https://www.nseindia.com/reports/fii-dii")
