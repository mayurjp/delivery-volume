"""HTTP layer: browser-like headers, 1 req/s rate limit, retries, response validation."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": USER_AGENT,
    "Referer": "https://www.nseindia.com/",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}
BACKOFFS = (2, 6, 18)
TIMEOUT = 30

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Response:
    url: str
    http: int | None  # None = network failure
    body: bytes
    ms: int
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.http == 200

    @property
    def missing(self) -> bool:
        """HTTP 404 means 'not published (yet)'."""
        return self.http == 404

    @property
    def size(self) -> int:
        return len(self.body)


# --- body validation -------------------------------------------------------------

def looks_like_html(body: bytes) -> bool:
    head = body[:512].lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html") or b"<head>" in head


def is_zip(body: bytes) -> bool:
    return body[:2] == b"PK"


def is_xls(body: bytes) -> bool:
    return body[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # CDFV2 / BIFF container


class Client:
    """Sequential, rate-limited client. One instance per process."""

    def __init__(self, delay_sec: float = 1.0, log_dir: Path | None = None, env: str | None = None):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.delay = delay_sec
        self._last = 0.0
        self.log_dir = log_dir
        self.env = env or os.environ.get("PIPELINE_ENV", "local")
        self.warmed: set[str] = set()
        self.requests = 0  # network attempts (retries included): the cap in fetch-shareholding counts these

    def _throttle(self) -> None:
        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def get(self, url: str, headers: dict | None = None, source: str = "", date: str = "",
            retries: int = 3) -> Response:
        resp = Response(url, None, b"", 0, "not attempted")
        for attempt in range(retries):
            self._throttle()
            self.requests += 1
            t0 = time.monotonic()
            try:
                r = self.session.get(url, headers=headers, timeout=TIMEOUT, allow_redirects=True)
                resp = Response(url, r.status_code, r.content, int((time.monotonic() - t0) * 1000))
                retry = r.status_code >= 500 or r.status_code == 429
            except (requests.Timeout, requests.ConnectionError) as e:
                resp = Response(url, None, b"", int((time.monotonic() - t0) * 1000), type(e).__name__)
                retry = True
            if not retry or attempt == retries - 1:
                break
            time.sleep(BACKOFFS[min(attempt, len(BACKOFFS) - 1)])
        self.log(source, date, resp)
        return resp

    def warm_up(self, pages: list[str] | tuple[str, ...]) -> list[tuple[str, int | None]]:
        """Visit www.nseindia.com pages to collect cookies (needed for /api endpoints)."""
        out: list[tuple[str, int | None]] = []
        for p in pages:
            if p not in self.warmed:
                r = self.get(p, headers={"Accept": "text/html,application/xhtml+xml"}, source="warmup", retries=1)
                self.warmed.add(p)
                out.append((p, r.http))
        return out

    def log(self, source: str, date: str, resp: Response, rows: int | None = None,
            status: str | None = None) -> None:
        if not self.log_dir:
            return
        self.log_dir.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        rec = {
            "ts": now.isoformat(timespec="seconds"), "env": self.env, "source": source, "date": date,
            "url": resp.url, "http": resp.http, "bytes": resp.size, "rows": rows,
            "status": status or ("ok" if resp.ok else ("missing" if resp.missing else "error")),
            "ms": resp.ms, "error": resp.error,
        }
        with open(self.log_dir / f"fetch-{now:%Y-%m}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
