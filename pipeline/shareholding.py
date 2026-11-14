"""S16 collection (Phase 4B): `fetch-shareholding`.

Daily mode (capped): one listing call per run covers the submission window of the last `listingWindowDays`, the latest
`quartersBack` quarter ends are matched, and each (company, quarter) not yet stored is downloaded (XBRL, no cookies),
parsed and written, in market-cap rank order, until `maxRequestsPerRun` requests (listing, warm-up and XBRL together)
are used. A quarter filed in the window is therefore picked up on the next run that sees it.

Backfill (`--backfill`): the listing is read in 120-day windows from the day after the oldest quarter end to today.
Each window's listing is saved as a slim snapshot (`store/shareholding/listing/FROM_TO.json.gz`); a resumed run reads
the snapshot instead of calling the listing again. Downloads are capped only by `--max-requests` when given.

Store (03 section 3 and 5.10): `store/shareholding/{quarter}/{fileKey}.json.gz`, one parsed extract per filing (never
the raw XBRL), gzip with mtime=0. A stored file is replaced only when its `recordId` changes (a revised filing).
"""

from __future__ import annotations

import csv
import gzip
import io
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import calendar as cal_mod
from . import config, store
from .http import Client
from .sources import s16_shareholding as S
from .symbols import file_key

ROOT_SUB = "shareholding"
LISTING_DAYS = 120  # the verified date-range window size (SOURCE_STATUS S16)
PROBLEMS_FILE = "_problems.json"
STATUS_FILE = "_status.json"
COVERAGE_TARGET = 0.95  # 06 Phase 4B: >= 95% of the universe for 4 quarters
QUARTER_COMPLETE_DAYS = 60  # 03 5.10: complete after 60 days even if not everyone has filed


def _root(root: Path | None) -> Path:
    return (root or config.STORE_DIR) / ROOT_SUB


def quarter_ends_upto(today: date, n: int) -> list[date]:
    """The latest `n` calendar quarter ends on or before `today`, oldest first."""
    out = []
    for y in (today.year, today.year - 1, today.year - 2):
        for m, dd in ((12, 31), (9, 30), (6, 30), (3, 31)):
            q = date(y, m, dd)
            if q <= today:
                out.append(q)
    return sorted(out)[-n:]


def windows(frm: date, to: date, span: int = LISTING_DAYS) -> list[tuple[date, date]]:
    """Contiguous windows of `span` days covering [frm, to]."""
    out, cur = [], frm
    while cur <= to:
        end = min(to, cur + timedelta(days=span - 1))
        out.append((cur, end))
        cur = end + timedelta(days=1)
    return out


def store_path(root: Path | None, quarter: date, symbol: str) -> Path:
    return _root(root) / quarter.isoformat() / f"{file_key(symbol)}.json.gz"


def latest_filings(rows: list[dict], quarters: list[date]) -> dict[tuple[str, date], dict]:
    """One listing row per (symbol, quarter end): the one broadcast last (a revision supersedes the original)."""
    qset = set(quarters)
    best: dict[tuple[str, date], tuple[datetime, dict]] = {}
    for r in rows:
        q = S.quarter_end(r.get("date"))
        sym = str(r.get("symbol") or "").strip()
        if q is None or q not in qset or not sym or not r.get("xbrl"):
            continue
        bt = S.broadcast_at(r.get("broadcastDate")) or datetime.min
        cur = best.get((sym, q))
        if cur is None or bt > cur[0]:
            best[(sym, q)] = (bt, r)
    return {k: v[1] for k, v in best.items()}


def universe_ranks(root: Path | None = None) -> dict[str, int]:
    """Market-cap rank among EQ rows on the latest mcap day (03 section 4 ranks the universe the same way)."""
    base = root or config.STORE_DIR
    days = store.list_dates("mcap", "csv.gz", base)
    if not days:
        return {}
    path = store.path_for("mcap", days[-1], "csv.gz", base)
    rows = list(csv.DictReader(io.StringIO(store.read_bytes(path).decode("utf-8"))))
    eq = [r for r in rows if r.get("series") == "EQ" and r.get("mcapRs") not in (None, "")]
    eq.sort(key=lambda r: -float(r["mcapRs"]))
    return {r["symbol"]: i + 1 for i, r in enumerate(eq)}


def _gz_json(obj) -> bytes:
    return store.gz_bytes(json.dumps(obj, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def _read_gz_json(path: Path):
    return json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))


def extract_doc(sym: str, q: date, filing: dict, parsed: dict) -> dict:
    """The stored file (03 section 5.10 shape, plus the filing facts the no-lookahead rule needs)."""
    bt = S.broadcast_at(filing.get("broadcastDate"))
    return {
        "sym": sym,
        "quarter": q.isoformat(),
        "filedOn": bt.date().isoformat() if bt else None,
        "broadcastDate": bt.isoformat(timespec="seconds") if bt else None,
        "recordId": str(filing.get("recordId") or ""),
        "revised": str(filing.get("revisedData") or "") == "Revised",
        "format": parsed.get("format"),
        "isin": parsed.get("isin") or filing.get("isin"),
        "totalShares": parsed["totalShares"],
        "promoterPct": parsed["promoterPct"],
        "publicPct": parsed["publicPct"],
        "categories": parsed["categories"],
        "namedHolders": parsed["namedHolders"],
        "checks": parsed["checks"],
        "promoterOverlap": parsed.get("promoterOverlap", []),
    }


def stored_record_id(path: Path) -> str | None:
    if not path.exists():
        return None
    return str(_read_gz_json(path).get("recordId") or "")


def write_extract(root: Path | None, q: date, sym: str, doc: dict) -> str:
    """Write one parsed extract. Returns 'stored' or 'skip' (same recordId already stored)."""
    path = store_path(root, q, sym)
    if stored_record_id(path) == doc["recordId"]:
        return "skip"
    store.write_atomic(path, _gz_json(doc), force=True)
    return "stored"


def fetch_listing(client: Client, a: date, b: date) -> list[dict] | None:
    r = client.get(S.listing_url(a, b), headers={"Accept": "application/json, text/plain, */*", "Referer": S.PAGE},
                   source="S16L")
    if not r.ok:
        print(f"::warning::S16 listing {a}..{b} http {r.http}", flush=True)
        return None
    try:
        rows = json.loads(r.body)
    except ValueError:
        rows = None
    if not isinstance(rows, list):
        print(f"::warning::S16 listing {a}..{b}: unexpected payload", flush=True)
        return None
    return rows


def _listing_snapshot_path(root: Path | None, a: date, b: date) -> Path:
    return _root(root) / "listing" / f"{a.isoformat()}_{b.isoformat()}.json.gz"


def run(mode: str, *, client: Client | None = None, root: Path | None = None, max_requests: int | None = None,
        quarters_back: int | None = None, symbols: set[str] | None = None, quarter: date | None = None,
        today: date | None = None) -> dict:
    """mode: 'daily' (capped) or 'backfill'. Returns a summary; never raises on a single filing's problem."""
    cfg = config.settings()["sources"]["shareholding"]
    base = root or config.STORE_DIR
    backfill = mode == "backfill"
    today = today or cal_mod.today_ist()
    n_q = quarters_back or cfg["quartersBack"]
    quarters = [quarter] if quarter else quarter_ends_upto(today, n_q)
    cap = max_requests if max_requests is not None else (None if backfill else cfg["maxRequestsPerRun"])
    client = client or Client(delay_sec=config.settings()["requestDelaySec"], log_dir=base / "logs")
    ranks = universe_ranks(root)
    summary = {"mode": mode, "quarters": [q.isoformat() for q in quarters], "listingCalls": 0, "xbrl": 0,
               "stored": 0, "skipped": 0, "invalid": 0, "smeDropped": 0, "notInUniverse": 0, "capped": False,
               "cap": cap, "problems": 0}
    problems: list[dict] = []

    def budget_left() -> bool:
        return cap is None or client.requests < cap

    if cap is not None and cap < 1:
        summary["capped"] = True
        return summary
    client.warm_up((S.HOME, S.PAGE))  # cookie warm-up is one of the counted requests

    rows: list[dict] = []
    if backfill:
        frm = min(quarters) + timedelta(days=1)
        for a, b in windows(frm, today):
            snap = _listing_snapshot_path(root, a, b)
            if snap.exists():
                part = _read_gz_json(snap)
            else:
                if not budget_left():
                    summary["capped"] = True
                    break
                summary["listingCalls"] += 1
                part = fetch_listing(client, a, b)
                if part is None:
                    continue
                store.write_atomic(snap, _gz_json(S.slim_listing(part)), force=True)
            rows.extend(part)
    else:
        if budget_left():
            summary["listingCalls"] += 1
            part = fetch_listing(client, today - timedelta(days=LISTING_DAYS), today)
            rows = part or []

    filings = latest_filings(rows, quarters)
    cands = []
    for (sym, q), f in filings.items():
        if symbols and sym not in symbols:
            continue
        if sym not in ranks:
            summary["notInUniverse"] += 1  # SME, SM/ST series, or not in the EQ universe today
            continue
        if stored_record_id(store_path(root, q, sym)) == str(f.get("recordId") or ""):
            summary["skipped"] += 1
            continue
        cands.append((ranks[sym], -q.toordinal(), sym, q, f))
    cands.sort(key=lambda c: (c[0], c[1]))

    for _, _, sym, q, f in cands:
        if not budget_left():
            summary["capped"] = True
            break
        summary["xbrl"] += 1
        r = client.get(f["xbrl"], headers={"Accept": "application/xml, text/xml, */*"}, source="S16X")
        if not r.ok:
            problems.append({"symbol": sym, "quarter": q.isoformat(), "reason": f"xbrl http {r.http}"})
            summary["invalid"] += 1
            continue
        parsed = S.parse_xbrl(r.body)
        if not parsed["ok"]:
            problems.append({"symbol": sym, "quarter": q.isoformat(), "reason": "; ".join(parsed["problems"])})
            summary["invalid"] += 1
            continue
        if parsed.get("sme"):
            summary["smeDropped"] += 1
            continue
        if parsed.get("sym") and parsed["sym"] != sym:
            problems.append({"symbol": sym, "quarter": q.isoformat(), "reason": f"XBRL symbol {parsed['sym']}"})
        if not parsed["checks"]["ok"] or parsed["problems"]:
            problems.append({"symbol": sym, "quarter": q.isoformat(), "reason": "; ".join(parsed["problems"]) or
                             "category totals not 100 +/- 0.1"})
        doc = extract_doc(sym, q, f, parsed)
        res = write_extract(root, q, sym, doc)
        summary["stored" if res == "stored" else "skipped"] += 1

    summary["problems"] = len(problems)
    summary["requests"] = client.requests
    _write_problems(base, problems)
    _write_status(base, quarters, ranks, rows, summary)
    return summary


def _write_problems(base: Path | None, new: list[dict]) -> None:
    """Failures go to a report file (06 Phase 4B). Replaced by each run's list; the build never reads it."""
    path = _root(base) / PROBLEMS_FILE
    if not new and not path.exists():
        return
    store.write_json_atomic(path, {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                   "count": len(new), "items": sorted(new, key=lambda x: (x["quarter"], x["symbol"]))})


def coverage(root: Path | None = None, quarters: list[date] | None = None) -> dict:
    """Stored (company, quarter) pairs over the EQ universe. `complete` = companies with every quarter."""
    ranks = universe_ranks(root)
    uni = set(ranks)
    today = cal_mod.today_ist()
    quarters = quarters or quarter_ends_upto(today, config.settings()["sources"]["shareholding"]["quartersBack"])
    have: dict[date, set[str]] = {}
    for q in quarters:
        d = _root(root) / q.isoformat()
        have[q] = {p.name[: -len(".json.gz")] for p in d.glob("*.json.gz")} if d.exists() else set()
    keys = {file_key(s): s for s in uni}
    per_q = {q.isoformat(): len(have[q] & set(keys)) for q in quarters}
    complete = [s for s in uni if all(file_key(s) in have[q] for q in quarters)]
    share = len(complete) / len(uni) if uni else 0.0
    return {"universe": len(uni), "quarters": [q.isoformat() for q in quarters], "storedPerQuarter": per_q,
            "completeCompanies": len(complete), "completeShare": round(share, 4),
            "target": COVERAGE_TARGET, "meetsTarget": share >= COVERAGE_TARGET, "_have": have, "_ranks": ranks}


def _reason(sym: str, q: date, have: bool, listed: set[tuple[str, date]], sme: set[str]) -> str:
    if have:
        return "stored"
    if (sym, q) in listed:
        return "filed, not yet stored (capped run or failed download: see _problems.json)"
    return "no filing in the listing windows checked so far"


def _write_status(base: Path | None, quarters: list[date], ranks: dict[str, int], rows: list[dict], summary: dict) -> None:
    listed = set(latest_filings(rows, quarters).keys()) if rows else set()
    cov = coverage(base, quarters)
    missing = {}
    for q in quarters:
        for sym in ranks:
            if file_key(sym) not in cov["_have"][q]:
                missing.setdefault(q.isoformat(), []).append({"symbol": sym, "reason": _reason(sym, q, False, listed, set())})
    status = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "lastRun": summary,
              "coverage": {k: v for k, v in cov.items() if not k.startswith("_")},
              "missingCount": {q: len(v) for q, v in missing.items()},
              "missingSample": {q: v[:25] for q, v in missing.items()}}
    store.write_json_atomic(_root(base) / STATUS_FILE, status)


def status_lines(root: Path | None = None) -> list[str]:
    """What `pipeline status` prints for shareholding."""
    cov = coverage(root)
    lines = [f"S16 shareholding: universe {cov['universe']} EQ companies; stored per quarter {cov['storedPerQuarter']}",
             f"  4-quarter coverage: {cov['completeCompanies']} of {cov['universe']} = {cov['completeShare'] * 100:.1f}% "
             f"(target {COVERAGE_TARGET * 100:.0f}%: {'MET' if cov['meetsTarget'] else 'not met'})"]
    prob = store.read_json(_root(root) / PROBLEMS_FILE, {"items": []})
    failed = {(p["symbol"], p["quarter"]): p["reason"] for p in prob.get("items", [])}
    listing = store.read_json(_root(root) / STATUS_FILE, {})
    checked = listing.get("lastRun", {}).get("listingCalls") if listing else None
    for q in cov["quarters"]:
        have = cov["_have"][date.fromisoformat(q)]
        miss = [s for s in sorted(cov["_ranks"], key=cov["_ranks"].get) if file_key(s) not in have]
        if not miss:
            lines.append(f"  {q}: all {cov['universe']} companies stored")
            continue
        lines.append(f"  {q}: {len(miss)} companies missing, e.g.:")
        for s in miss[:8]:
            why = failed.get((s, q)) or ("not in the last listing windows checked (no filing seen yet)"
                                         if checked is not None or not listing else "not fetched yet")
            lines.append(f"      {s}: {why}")
    if listing:
        lines.append(f"  last run: {listing.get('lastRun', {}).get('mode', '-')} at {listing.get('generated', '-')}")
    if prob.get("count"):
        lines.append(f"  problems report: {prob['count']} filings (store/shareholding/{PROBLEMS_FILE})")
    return lines
