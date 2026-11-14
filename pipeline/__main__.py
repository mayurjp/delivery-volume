"""CLI entry: python -m pipeline <command> (see docs/specs/03-data-pipeline.md section 1)."""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path


def _d(s: str) -> date:
    return date.fromisoformat(s)


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("verify-sources", help="Phase 0: probe every source S1-S16 for one date")
    v.add_argument("--date", required=True, type=_d)
    v.add_argument("--json", action="store_true", help="also write a machine-readable report")
    v.add_argument("--out", type=Path, help="report path (default reports/verify-sources-<env>-<date>.json)")
    v.add_argument("--only", help="comma list, e.g. s1,s8")
    v.add_argument("--skip", help="comma list, e.g. s8,s16")

    f = sub.add_parser("fetch", help="download into store/")
    f.add_argument("--date", type=_d)
    f.add_argument("--since", type=_d)
    f.add_argument("--to", type=_d)
    f.add_argument("--sources", help="comma list, e.g. s1,s2")
    f.add_argument("--force", action="store_true")

    b = sub.add_parser("backfill", help="fetch over a date range (resumable)")
    b.add_argument("--from", dest="frm", type=_d)
    b.add_argument("--to", type=_d)
    b.add_argument("--sources")
    b.add_argument("--force", action="store_true")

    bd = sub.add_parser("build", help="rebuild generated JSON from store/ (no network)")
    bd.add_argument("--out", type=Path, default=Path("site/public/data"))

    u = sub.add_parser("update", help="fetch recent days, then build")
    u.add_argument("--no-build", action="store_true")

    sub.add_parser("status", help="coverage table and gaps")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "verify-sources":
        from . import verify

        only = {x.strip().lower() for x in args.only.split(",")} if args.only else None
        skip = {x.strip().lower() for x in args.skip.split(",")} if args.skip else None
        report = verify.run(args.date, only, skip)
        print(verify.fmt_table(report))
        if args.json:
            print("report written to", verify.write_report(report, args.out))
        failed = [s["id"] for s in report["sources"] if s["verified"] == "VERIFIED" and not s["ok"]]
        if failed:
            print("FAILED (VERIFIED sources):", ", ".join(failed))
            return 1
        return 0

    from . import commands

    return commands.dispatch(args)


if __name__ == "__main__":
    sys.exit(main())
