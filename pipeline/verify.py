"""`verify-sources`: probe every source for one date and report HTTP status, size, header, rows, validity."""

from __future__ import annotations

import json
import os
import platform
from datetime import date, datetime, timezone
from pathlib import Path

from .http import ROOT, Client
from .sources import SourceSpec, ordered  # noqa: F401  (re-exported for tests)

BLOCK_CODES = {301, 302, 401, 403, 429, 503}


def check_one(spec: SourceSpec, client: Client, d: date) -> dict:
    items = []
    warm = []
    if spec.warm:
        warm = client.warm_up(spec.warm)
    for label, url in spec.urls(d):
        headers = {}
        if spec.cookie_gated:
            headers = {"Accept": "application/json, text/plain, */*", "Referer": spec.referer or ""}
        r = client.get(url, headers=headers or None, source=spec.id, date=d.isoformat())
        item = {"label": label, "url": url, "http": r.http, "bytes": r.size, "ms": r.ms, "error": r.error,
                "header": None, "rows": None, "headerOk": None, "errors": [], "notes": []}
        if r.ok:
            bad = spec.check_body(r.body)
            if bad:
                item["errors"].append(bad)
            else:
                try:
                    p = spec.parse(r.body, d, label)
                    item["header"] = p.header
                    item["rows"] = p.rows
                    item["errors"] += p.errors
                    item["notes"] += p.notes
                    item["headerOk"] = not any(e.startswith("schema_mismatch") for e in p.errors)
                except Exception as e:  # a parser crash is a failed validation, never a verify crash
                    item["errors"].append(f"parser exception: {type(e).__name__}: {e}")
        item["ok"] = bool(r.ok and not item["errors"])
        item["status"] = (
            "works" if item["ok"] else "missing" if r.missing
            else "blocked" if (r.http in BLOCK_CODES or r.http is None) else "invalid"
        )
        items.append(item)
    ok_items = [i for i in items if i["ok"]]
    # multi-file sources (S11) need all files; probe-style sources (S16) need any one
    probe_style = spec.id == "S16"
    ok = bool(ok_items) if probe_style else all(i["ok"] for i in items)
    statuses = {i["status"] for i in items}
    status = "works" if ok else (statuses.pop() if len(statuses) == 1 else "invalid")
    return {"id": spec.id, "key": spec.key, "name": spec.name, "verified": spec.verified,
            "cookieGated": spec.cookie_gated, "status": status, "ok": ok, "warmup": warm, "items": items}


def run(d: date, only: set[str] | None = None, skip: set[str] | None = None, delay: float = 1.0) -> dict:
    client = Client(delay_sec=delay, log_dir=ROOT / "store" / "logs")
    results = []
    for spec in ordered():
        if only and spec.id.lower() not in only:
            continue
        if skip and spec.id.lower() in skip:
            continue
        results.append(check_one(spec, client, d))
    return {
        "date": d.isoformat(),
        "env": os.environ.get("PIPELINE_ENV", "local"),
        "runner": {"platform": platform.platform(), "python": platform.python_version(),
                   "github_actions": os.environ.get("GITHUB_ACTIONS") == "true"},
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": results,
    }


def fmt_table(report: dict) -> str:
    lines = [f"verify-sources for {report['date']} (env={report['env']})",
             f"{'ID':<4} {'status':<8} {'http':<14} {'bytes':>9} {'rows':>7}  name / notes"]
    for s in report["sources"]:
        https = ",".join(str(i["http"]) for i in s["items"])
        if len(https) > 14:
            https = https[:11] + "..."
        size = sum(i["bytes"] for i in s["items"])
        rows = sum(i["rows"] or 0 for i in s["items"])
        extra = "; ".join(sorted({e for i in s["items"] for e in i["errors"]}))[:100]
        lines.append(f"{s['id']:<4} {s['status']:<8} {https:<14} {size:>9} {rows:>7}  {s['name']} {extra}")
        for i in s["items"]:
            if i["header"] and s["id"] not in ("S11",):
                lines.append(f"       header: {i['header']}")
            for n in i["notes"]:
                lines.append(f"       note: {n}")
    return "\n".join(lines)


def write_report(report: dict, out: Path | None) -> Path:
    path = out or ROOT / "reports" / f"verify-sources-{report['env']}-{report['date']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    return path
