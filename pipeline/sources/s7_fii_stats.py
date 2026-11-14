"""S7: FII derivatives statistics (legacy .xls, parsed with xlrd)."""

from __future__ import annotations

from datetime import date

import xlrd

from .base import Parsed, SourceSpec, parse_dmy_mon, tokens

COLUMNS = ["buyContracts", "buyAmtCr", "sellContracts", "sellAmtCr", "oiContracts", "oiAmtCr"]
CATEGORIES = ("INDEX FUTURES", "INDEX OPTIONS", "STOCK FUTURES", "STOCK OPTIONS")


def url(d: date) -> str:
    return f"https://nsearchives.nseindia.com/content/fo/fii_stats_{tokens(d)['DD-Mon-YYYY']}.xls"


def dump(body: bytes) -> list[list[str]]:
    wb = xlrd.open_workbook(file_contents=body)
    sh = wb.sheet_by_index(0)
    return [[str(c) for c in sh.row_values(i)] for i in range(sh.nrows)]


def parse(body: bytes, d: date, label: str = "") -> Parsed:
    p = Parsed()
    try:
        grid = dump(body)
    except Exception as e:  # xlrd raises several types
        p.errors.append(f"xls unreadable: {type(e).__name__}: {e}")
        return p
    title = grid[0][0] if grid and grid[0] else ""
    p.header = [c for c in (grid[2] if len(grid) > 2 else []) if c]
    m = [t for t in title.split() if parse_dmy_mon(t)]
    if not m or parse_dmy_mon(m[0]) != d:
        p.errors.append(f"title date mismatch: {title!r}")
    rows = []
    for r in grid[3:]:
        name = r[0].strip() if r else ""
        if not name or name.lower().startswith("notes"):
            if name.lower().startswith("notes"):
                break
            continue
        try:
            vals = [float(x) for x in r[1:7]]
        except ValueError:
            continue
        cat = name
        for base in CATEGORIES:
            if name == base:
                level = "total"
                break
        else:
            level = "instrument"
        rows.append({"category": cat, "level": level, **dict(zip(COLUMNS, vals))})
    p.rows = len(rows)
    found = {r["category"] for r in rows}
    for c in CATEGORIES:
        if c not in found:
            p.errors.append(f"missing row {c}")
    p.notes.append(f"title: {title}; header: {p.header}")
    p.data = {"date": d.isoformat(), "rows": rows}
    return p


SPEC = SourceSpec("S7", "fii_stats", "FII derivatives statistics (.xls)", "xls", lambda d: [("", url(d))], parse)
