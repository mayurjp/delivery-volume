"""Institutional inputs for the build (docs/specs/03 5.7): participant OI and volume (S5/S6), FII derivatives statistics
(S7) and FII/DII cash (S8). Readers only; the build writes the files (pipeline/build/institutional.py)."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .config import STORE_DIR
from .sources import s5_s6_participant as s56
from .store import list_dates

PART_COLS = ["date", "participant", "futIdxLong", "futIdxShort", "futStkLong", "futStkShort", "optIdxCallLong",
             "optIdxPutLong", "optIdxCallShort", "optIdxPutShort", "optStkCallLong", "optStkPutLong",
             "optStkCallShort", "optStkPutShort", "totalLong", "totalShort"]
PART_MAP = {
    "Future Index Long": "futIdxLong", "Future Index Short": "futIdxShort", "Future Stock Long": "futStkLong",
    "Future Stock Short": "futStkShort", "Option Index Call Long": "optIdxCallLong",
    "Option Index Put Long": "optIdxPutLong", "Option Index Call Short": "optIdxCallShort",
    "Option Index Put Short": "optIdxPutShort", "Option Stock Call Long": "optStkCallLong",
    "Option Stock Put Long": "optStkPutLong", "Option Stock Call Short": "optStkCallShort",
    "Option Stock Put Short": "optStkPutShort", "Total Long Contracts": "totalLong",
    "Total Short Contracts": "totalShort",
}
PARTICIPANTS = ("FII", "DII", "Pro", "Client")
CASH_COLS = ["date", "fiiBuy", "fiiSell", "fiiNet", "diiBuy", "diiSell", "diiNet"]
DERIV_COLS = ["date", "category", "level", "buyContracts", "buyAmtCr", "sellContracts", "sellAmtCr", "oiContracts",
              "oiAmtCr"]


def _iso_key(d: date) -> str:
    return d.isoformat()


def participant_frame(kind: str, root: Path | None = None) -> list[list]:
    """Rows (PART_COLS) of participant_oi ('oi') or participant_vol ('vol') for every stored day, FII/DII/Pro/Client."""
    folder = {"oi": "participant_oi", "vol": "participant_vol"}[kind]
    rows: list[list] = []
    for d in list_dates(folder, "csv", root):
        path = (root or STORE_DIR) / folder / f"{d:%Y}" / f"{d.isoformat()}.csv"
        p = s56._parse(path.read_bytes(), d)
        if p.errors:
            raise ValueError(f"{path}: {p.errors}")
        df = p.data
        for _, r in df[df["Client Type"].isin(PARTICIPANTS)].iterrows():
            vals = {PART_MAP[c]: int(float(r[c])) for c in PART_MAP}
            rows.append([_iso_key(d), r["Client Type"], *[vals[c] for c in PART_COLS[2:]]])
    return rows


def deriv_rows(root: Path | None = None) -> list[list]:
    """Rows (DERIV_COLS) from store/fii_stats/YYYY/DATE.json (S7), one per category row per date."""
    rows: list[list] = []
    for d in list_dates("fii_stats", "json", root):
        path = (root or STORE_DIR) / "fii_stats" / f"{d:%Y}" / f"{d.isoformat()}.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        for r in doc["rows"]:
            rows.append([_iso_key(d), r["category"], r["level"], _num(r["buyContracts"]), _num(r["buyAmtCr"]),
                         _num(r["sellContracts"]), _num(r["sellAmtCr"]), _num(r["oiContracts"]), _num(r["oiAmtCr"])])
    return rows


def _num(x) -> float | None:
    try:
        return None if x is None else round(float(x), 2)
    except (TypeError, ValueError):
        return None


def cash_records(root: Path | None = None) -> list[dict]:
    """Every line of store/fii_dii_cash/YYYY.jsonl (S8), as stored."""
    base = (root or STORE_DIR) / "fii_dii_cash"
    out: list[dict] = []
    if not base.exists():
        return out
    for path in sorted(base.glob("*.jsonl")):
        for ln in path.read_text(encoding="utf-8").splitlines():
            if ln.strip():
                out.append(json.loads(ln))
    return out


def cash_rows(records: list[dict], trading_days: list[str]) -> list[list]:
    """One row per trading day from the first collected day to the last, nulls on days with no S8 record (never
    interpolated). Values in Rs Crore."""
    by_day: dict[str, dict] = {}
    for rec in records:
        row = {"fiiBuy": None, "fiiSell": None, "fiiNet": None, "diiBuy": None, "diiSell": None, "diiNet": None}
        for item in rec["payload"]:
            cat = str(item.get("category", ""))
            key = "fii" if cat.startswith("FII") else "dii" if cat.startswith("DII") else None
            if key is None:
                continue
            row[f"{key}Buy"] = _num(item.get("buyValue"))
            row[f"{key}Sell"] = _num(item.get("sellValue"))
            row[f"{key}Net"] = _num(item.get("netValue"))
        by_day[rec["date"]] = row
    if not by_day:
        return []
    first, last = min(by_day), max(max(by_day), max(trading_days))
    rows = []
    for d in trading_days:
        if d < first or d > last:
            continue
        r = by_day.get(d, {})
        rows.append([d, r.get("fiiBuy"), r.get("fiiSell"), r.get("fiiNet"), r.get("diiBuy"), r.get("diiSell"),
                     r.get("diiNet")])
    return rows


def collecting_since(records: list[dict]) -> str | None:
    return min((r["date"] for r in records), default=None)
