"""`merge-history`: move staged extra history (.history_staging/, 07 section 8) into store/. Idempotent.

Staged files are in the store's exact formats (cm_delivery, indices_close, fo_extract). A staged file whose
destination already exists is never overwritten: identical bytes are simply dropped from staging, different bytes are
reported as a conflict and left in place. calendar.json is merged by union of trading days; staged `noData` (a plain
list of dates) become store-style `noData` entries ({checks, final}) unless the date is a trading day.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import store

KINDS = ("cm_delivery", "indices_close", "fo_extract")


def merge_calendar(staged: dict, cal: dict) -> dict:
    """Merge the staging calendar ({tradingDays, noData: [dates]}) into a store calendar. Pure."""
    days = sorted(set(cal.get("tradingDays", [])) | set(staged.get("tradingDays", [])))
    no_data = dict(cal.get("noData", {}))
    staged_nd = staged.get("noData", [])
    if isinstance(staged_nd, dict):
        staged_nd = list(staged_nd)
    dayset = set(days)
    for d in staged_nd:
        if d not in dayset and d not in no_data:
            no_data[d] = {"checks": 1, "final": True}
    for d in dayset:
        no_data.pop(d, None)
    out = dict(cal)
    out["tradingDays"] = days
    out["noData"] = dict(sorted(no_data.items()))
    return out


def merge(staging: Path, store_dir: Path) -> dict:
    res = {"moved": 0, "alreadyThere": 0, "conflicts": [], "perKind": {}}
    for kind in KINDS:
        base = staging / kind
        n = 0
        if base.exists():
            for src in sorted(p for p in base.rglob("*") if p.is_file() and not p.name.startswith(".tmp")):
                dst = store_dir / kind / src.relative_to(base)
                data = src.read_bytes()
                if dst.exists():
                    if dst.read_bytes() == data:
                        src.unlink()
                        res["alreadyThere"] += 1
                    else:
                        res["conflicts"].append(str(dst))
                    continue
                store.write_atomic(dst, data)
                src.unlink()
                n += 1
        res["perKind"][kind] = n
        res["moved"] += n
    cal_path = store_dir / "calendar.json"
    scal = staging / "calendar.json"
    if scal.exists():
        staged = json.loads(scal.read_text(encoding="utf-8"))
        cal = store.read_json(cal_path, {"tradingDays": [], "noData": {}, "snapshotsChecked": {}, "lastChecked": None})
        merged = merge_calendar(staged, cal)
        # only trading days that really have an S1 file stay (store.list_dates is the truth, calendar.save does the same)
        have = {d.isoformat() for d in store.list_dates("cm_delivery", root=store_dir)}
        merged["tradingDays"] = sorted(set(merged["tradingDays"]) & have | have)
        store.write_json_atomic(cal_path, merged)
    # staging empties out; remove empty directories (keeps a conflict's files)
    for p in sorted(staging.rglob("*"), key=lambda q: len(q.parts), reverse=True):
        if p.is_dir() and not any(p.iterdir()):
            p.rmdir()
    res["tradingDays"] = len(store.list_dates("cm_delivery", root=store_dir))
    return res
