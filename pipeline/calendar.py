"""Trading-day discovery. A trading day is a date for which S1 exists (no holiday API)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from . import store
from .config import STORE_DIR

IST = timezone(timedelta(hours=5, minutes=30))
FINAL_AFTER_DAYS = 3  # a date still missing this many days later is final
MAX_CHECKS = 4  # next-morning catch-up + 3 more re-checks


def today_ist() -> date:
    return datetime.now(IST).date()


def _path():
    return STORE_DIR / "calendar.json"


def load() -> dict:
    return store.read_json(_path(), {"tradingDays": [], "noData": {}, "snapshotsChecked": {}, "lastChecked": None})


def save(cal: dict) -> None:
    cal["tradingDays"] = [d.isoformat() for d in store.list_dates("cm_delivery")]
    cal["lastChecked"] = datetime.now(IST).isoformat(timespec="seconds")
    store.write_json_atomic(_path(), cal)


def trading_days() -> list[date]:
    return store.list_dates("cm_delivery")


def should_probe(cal: dict, d: date, today: date) -> bool:
    nd = cal["noData"].get(d.isoformat())
    return not (nd and nd.get("final"))


def record_missing(cal: dict, d: date, today: date) -> None:
    key = d.isoformat()
    nd = cal["noData"].setdefault(key, {"checks": 0, "final": False})
    nd["checks"] += 1
    if (today - d).days > FINAL_AFTER_DAYS or nd["checks"] >= MAX_CHECKS:
        nd["final"] = True


def record_found(cal: dict, d: date) -> None:
    cal["noData"].pop(d.isoformat(), None)


def daterange(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)
