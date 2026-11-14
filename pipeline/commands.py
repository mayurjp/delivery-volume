"""CLI command implementations (everything except verify-sources)."""

from __future__ import annotations

import argparse
import sys
from datetime import timedelta

from . import calendar as cal_mod
from . import config, store
from .config import STORE_DIR


def _sources(arg: str | None) -> list[str] | None:
    return [s.strip().lower() for s in arg.split(",") if s.strip()] if arg else None


def cmd_fetch(args: argparse.Namespace) -> int:
    from . import fetch

    if args.date:
        frm, to = args.date, args.date
    elif args.since:
        frm, to = args.since, args.to or cal_mod.today_ist()
    else:
        print("fetch needs --date or --since", file=sys.stderr)
        return 2
    fetch.run_range(frm, to, _sources(args.sources), args.force)
    return 0


def cmd_backfill(args: argparse.Namespace) -> int:
    from . import fetch

    frm = args.frm or __import__("datetime").date.fromisoformat(config.settings()["backfillFrom"])
    to = args.to or cal_mod.today_ist()
    fetch.run_range(frm, to, _sources(args.sources), args.force, label="backfill")
    return 0


def cmd_update(args: argparse.Namespace) -> int:
    from . import fetch

    today = cal_mod.today_ist()
    frm = today - timedelta(days=config.settings()["lookbackDaysForFetch"])
    fetch.run_range(frm, today, None, False, label="update")
    from . import collect

    collect.collect_latest()  # S8 + S9/S10: latest day only, forward collection
    if not args.no_build:
        return cmd_build(argparse.Namespace(out=config.ROOT / "site" / "public" / "data"))
    return 0


def cmd_collect(args: argparse.Namespace) -> int:
    from . import collect

    collect.collect_latest()
    return 0


def cmd_backfill_deals(args: argparse.Namespace) -> int:
    from . import collect

    frm = args.frm or __import__("datetime").date.fromisoformat(config.settings()["backfillFrom"])
    res = collect.backfill_deals(frm, args.to or cal_mod.today_ist())
    return 1 if res["failedChunks"] else 0


def cmd_build(args: argparse.Namespace) -> int:
    from .build import run_build

    out = args.out if args.out.is_absolute() else config.ROOT / args.out
    run_build(out)
    return 0


def cmd_merge_history(args: argparse.Namespace) -> int:
    from . import merge_history

    staging = args.staging if args.staging.is_absolute() else config.ROOT / args.staging
    res = merge_history.merge(staging, STORE_DIR)
    print(f"merge-history: moved {res['moved']} files {res['perKind']}, {res['alreadyThere']} already in store, "
          f"{len(res['conflicts'])} conflicts; store now has {res['tradingDays']} trading days")
    for c in res["conflicts"]:
        print("  CONFLICT (left in staging):", c)
    return 1 if res["conflicts"] else 0


def cmd_status(args: argparse.Namespace) -> int:
    days = store.list_dates("cm_delivery")
    last = days[-30:]
    kinds = [("S1 cm_delivery", "cm_delivery", "csv.gz"), ("S2 cm_isin", "cm_isin", "csv.gz"),
             ("S4 mcap", "mcap", "csv.gz"), ("S4 corp_actions", "corp_actions", "csv.gz"),
             ("S4 band_hits", "band_hits", "csv.gz"), ("S12 indices_close", "indices_close", "csv.gz"),
             ("S13 hl52", "hl52", "csv.gz"), ("S14 fo_ban", "fo_ban", "txt")]
    print(f"Trading days in store: {len(days)} ({days[0] if days else '-'} .. {days[-1] if days else '-'})")
    print(f"Coverage, last {len(last)} trading days (x present, . missing):")
    header = "".join(f"{d.day:>3}" for d in last)
    print(f"{'source':<20}{header}")
    gaps: dict[str, list[str]] = {}
    for name, kind, ext in kinds:
        have = set(store.list_dates(kind, ext))
        row = "".join("  x" if d in have else "  ." for d in last)
        print(f"{name:<20}{row}")
        miss = [d.isoformat() for d in days if d not in have]
        if miss:
            gaps[name] = miss
    snaps = [(k, sorted(p.name for p in (STORE_DIR / k).glob("*")) if (STORE_DIR / k).exists() else [])
             for k in ("constituents", "equity_list")]
    for k, items in snaps:
        print(f"{k}: snapshots {items}")
    cal = cal_mod.load()
    pending = [d for d, v in cal["noData"].items() if not v.get("final")]
    print(f"calendar: {len(cal['noData'])} no-data dates ({len(pending)} still being re-checked: {pending})")
    if gaps:
        print("Gaps (trading days with a missing file):")
        for k, v in gaps.items():
            print(f"  {k}: {len(v)} missing: {', '.join(v[:15])}{' ...' if len(v) > 15 else ''}")
    else:
        print("No gaps.")
    return 0


def dispatch(args: argparse.Namespace) -> int:
    return {"fetch": cmd_fetch, "backfill": cmd_backfill, "update": cmd_update, "collect": cmd_collect, "backfill-deals": cmd_backfill_deals, "build": cmd_build,
            "merge-history": cmd_merge_history, "status": cmd_status}[args.cmd](args)
