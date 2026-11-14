"""One-off loader: S5/S6 participant-wise OI and volume -> store/participant_{oi,vol}/YYYY/YYYY-MM-DD.csv (03 §3: as downloaded).

Usage: python -I load_participant.py <project root>
Sequential, >= 1 s between requests, browser headers, retries. Resumable (skips existing). Atomic writes.
Validation: line 1 is a title naming the trade date; line 2 header starts with "Client Type";
rows Client, DII, FII, Pro, TOTAL present; TOTAL long == TOTAL short.
"""
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

import requests

root = Path(sys.argv[1])
days = sorted(json.loads((root / "store/calendar.json").read_text(encoding="utf-8"))["tradingDays"])
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/130.0 Safari/537.36",
     "Referer": "https://www.nseindia.com/", "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}
KINDS = {"participant_oi": "fao_participant_oi", "participant_vol": "fao_participant_vol"}
s = requests.Session()
last = 0.0
stats = {k: {"written": 0, "skipped": 0, "missing": 0, "failed": 0} for k in KINDS}


def get(url):
    global last
    for wait in (2, 6, 18, None):
        gap = time.time() - last
        if gap < 1.0:
            time.sleep(1.0 - gap)
        last = time.time()
        try:
            r = s.get(url, headers=H, timeout=30)
            if r.status_code == 404:
                return None
            if r.status_code < 500 and r.status_code != 429:
                r.raise_for_status()
                return r.content
        except requests.RequestException:
            pass
        if wait is None:
            raise RuntimeError("failed after retries")
        time.sleep(wait)


def validate(body: bytes, d: str):
    text = body.decode("utf-8", errors="strict")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    title = lines[0]
    want = dt.date.fromisoformat(d).strftime("%b %d, %Y")          # e.g. "Nov 13, 2026"
    if want not in title:
        raise ValueError(f"title date mismatch: {title[:90]!r}")
    if not lines[1].startswith("Client Type"):
        raise ValueError("header missing")
    rows = {ln.split(",")[0].strip(): ln.split(",") for ln in lines[2:]}
    for need in ("Client", "DII", "FII", "Pro", "TOTAL"):
        if need not in rows:
            raise ValueError(f"row {need} missing")
    tot = rows["TOTAL"]
    if float(tot[-1]) != float(tot[-2]):
        raise ValueError("TOTAL long != short")


for d in days:
    tok = dt.date.fromisoformat(d).strftime("%d%m%Y")
    for kind, prefix in KINDS.items():
        out = root / "store" / kind / d[:4] / f"{d}.csv"
        if out.exists():
            stats[kind]["skipped"] += 1
            continue
        url = f"https://nsearchives.nseindia.com/content/nsccl/{prefix}_{tok}.csv"
        try:
            body = get(url)
            if body is None:
                stats[kind]["missing"] += 1
                print(f"{d} {kind} 404", flush=True)
                continue
            validate(body, d)
            out.parent.mkdir(parents=True, exist_ok=True)
            tmp = out.with_suffix(".tmp")
            tmp.write_bytes(body)
            os.replace(tmp, out)
            stats[kind]["written"] += 1
        except Exception as e:
            stats[kind]["failed"] += 1
            print(f"{d} {kind} FAILED: {e}", flush=True)
    if days.index(d) % 40 == 0:
        print(f"{d} progress {stats}", flush=True)

print("finished", json.dumps(stats), flush=True)
