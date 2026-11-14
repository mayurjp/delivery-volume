"""fetch / backfill: download, validate, then store. One source's failure never stops the others."""

from __future__ import annotations

import hashlib
import time
from datetime import date

import pandas as pd

from . import calendar as cal_mod
from . import config, store
from .config import STORE_DIR
from .http import Client, Response
from .sources import REGISTRY
from .sources import s11_constituents as s11

DAILY_ORDER = ["s1", "s2", "s4", "s12", "s13", "s14"]
SNAPSHOT_ORDER = ["s11", "s15"]
FETCHABLE = DAILY_ORDER + SNAPSHOT_ORDER
SNAPSHOT_RECHECK_DAYS = 6

# result codes
STORED, SKIPPED, MISSING, INVALID, ERROR, DISABLED = "stored", "skip", "missing", "invalid", "error", "disabled"


def csv_gz(df: pd.DataFrame) -> bytes:
    return store.gz_bytes(df.to_csv(index=False, lineterminator="\n").encode("utf-8"))


def _warn(msg: str) -> None:
    print(f"::warning::{msg}", flush=True)  # GitHub Actions annotation (harmless locally)


def _get(client: Client, sid: str, url: str, d: date) -> Response:
    return client.get(url, source=sid, date=d.isoformat())


def _classify(r: Response) -> str | None:
    if r.ok:
        return None
    return MISSING if r.missing else ERROR


def _validate(sid: str, r: Response, d: date, label: str = ""):
    """Returns (parsed, error). error is None when the body is stored-worthy."""
    spec = REGISTRY[sid.upper()]
    bad = spec.check_body(r.body)
    if bad:
        return None, bad
    parsed = spec.parse(r.body, d, label)
    if parsed.errors:
        return parsed, "; ".join(parsed.errors)
    return parsed, None


def fetch_s1(client: Client, d: date, force: bool) -> str:
    if store.exists("cm_delivery", d) and not force:
        return SKIPPED
    r = _get(client, "S1", REGISTRY["S1"].urls(d)[0][1], d)
    code = _classify(r)
    if code:
        return code
    parsed, err = _validate("s1", r, d)
    if err:
        if err.startswith("DATE1 mismatch") and "; " not in err:
            # NSE serves the previous trading day's file at a holiday's URL: the requested day is not a trading day
            client.log("S1", d.isoformat(), r, status="missing")
            return MISSING
        _warn(f"S1 {d} schema_mismatch: {err}")
        client.log("S1", d.isoformat(), r, status="schema_mismatch")
        return INVALID
    store.write_atomic(store.path_for("cm_delivery", d), store.gz_bytes(r.body), force=True)
    return STORED


def fetch_s2(client: Client, d: date, force: bool) -> str:
    if store.exists("cm_isin", d) and not force:
        return SKIPPED
    r = _get(client, "S2", REGISTRY["S2"].urls(d)[0][1], d)
    code = _classify(r)
    if code:
        return code
    parsed, err = _validate("s2", r, d)
    if err:
        _warn(f"S2 {d} schema_mismatch: {err}")
        client.log("S2", d.isoformat(), r, status="schema_mismatch")
        return INVALID
    store.write_atomic(store.path_for("cm_isin", d), csv_gz(parsed.data), force=True)
    return STORED


def fetch_s4(client: Client, d: date, force: bool) -> str:
    if store.exists("mcap", d) and not force:
        return SKIPPED
    r = _get(client, "S4", REGISTRY["S4"].urls(d)[0][1], d)
    code = _classify(r)
    if code:
        return code
    parsed, err = _validate("s4", r, d)
    if err:
        _warn(f"S4 {d} schema_mismatch: {err}")
        client.log("S4", d.isoformat(), r, status="schema_mismatch")
        return INVALID
    out = parsed.data
    store.write_atomic(store.path_for("corp_actions", d), csv_gz(out["bc"]), force=True)
    store.write_atomic(store.path_for("band_hits", d), store.gz_bytes(out["bh_text"].encode("utf-8")), force=True)
    if "etf" in out and len(out["etf"]):
        store.write_atomic(store.path_for("etf", d), csv_gz(out["etf"]), force=True)
    # mcap last: its presence marks the day as complete
    store.write_atomic(store.path_for("mcap", d), csv_gz(out["mcap"]), force=True)
    return STORED


def _raw_source(sid: str, kind: str, ext: str, gz: bool):
    def run(client: Client, d: date, force: bool) -> str:
        if store.exists(kind, d, ext) and not force:
            return SKIPPED
        r = _get(client, sid.upper(), REGISTRY[sid.upper()].urls(d)[0][1], d)
        code = _classify(r)
        if code:
            return code
        _, err = _validate(sid, r, d)
        if err:
            _warn(f"{sid.upper()} {d} schema_mismatch: {err}")
            client.log(sid.upper(), d.isoformat(), r, status="schema_mismatch")
            return INVALID
        store.write_atomic(store.path_for(kind, d, ext), store.gz_bytes(r.body) if gz else r.body, force=True)
        return STORED

    return run


def fetch_s13(client: Client, d: date, force: bool) -> str:
    """S13 is stored as a reduced CSV (no disclaimer lines/padding, SME rows dropped) to keep daily growth small."""
    if store.exists("hl52", d) and not force:
        return SKIPPED
    r = _get(client, "S13", REGISTRY["S13"].urls(d)[0][1], d)
    code = _classify(r)
    if code:
        return code
    parsed, err = _validate("s13", r, d)
    if err:
        _warn(f"S13 {d} schema_mismatch: {err}")
        client.log("S13", d.isoformat(), r, status="schema_mismatch")
        return INVALID
    df = parsed.data
    df = df[~df["SERIES"].isin(("SM", "ST"))]
    out = pd.DataFrame({
        "symbol": df["SYMBOL"], "series": df["SERIES"],
        "high52": df["hi"], "high52Date": df["52_Week_High_Date"].replace("-", ""),
        "low52": df["lo"], "low52Date": df["52_Week_Low_DT"].replace("-", ""),
    })
    store.write_atomic(store.path_for("hl52", d), csv_gz(out), force=True)
    return STORED


FETCHERS = {
    "s1": fetch_s1,
    "s2": fetch_s2,
    "s4": fetch_s4,
    "s12": _raw_source("s12", "indices_close", "csv.gz", True),
    "s13": fetch_s13,
    "s14": _raw_source("s14", "fo_ban", "txt", False),
}
SOURCE_KEY = {sid: REGISTRY[sid.upper()].key for sid in FETCHABLE}


def fetch_date(client: Client, d: date, sources: list[str], cal: dict, force: bool = False) -> dict[str, str]:
    """Fetch every requested daily source for one calendar date. S1 decides whether it is a trading day."""
    today = cal_mod.today_ist()
    res: dict[str, str] = {}
    sources = [s for s in DAILY_ORDER if s in sources]
    for sid in sources:
        if not config.run_here(SOURCE_KEY[sid]):
            res[sid] = DISABLED
            print(f"skip {sid} (runIn excludes {config.env()})")
    sources = [s for s in sources if res.get(s) != DISABLED]
    if res.get("s1") == DISABLED:
        return res
    is_trading = store.exists("cm_delivery", d)
    if not is_trading:
        if not force and not cal_mod.should_probe(cal, d, today):
            res["s1"] = SKIPPED  # already final "no data" (weekend / holiday)
            return res
        res["s1"] = fetch_s1(client, d, force)
        is_trading = store.exists("cm_delivery", d)
        if is_trading:
            cal_mod.record_found(cal, d)
        elif res["s1"] == MISSING:
            cal_mod.record_missing(cal, d, today)
        else:
            return res
    elif force and "s1" in sources:
        res["s1"] = fetch_s1(client, d, force)
    else:
        res["s1"] = SKIPPED
    if not is_trading:
        return res
    for sid in sources:
        if sid == "s1":
            continue
        try:
            res[sid] = FETCHERS[sid](client, d, force)
        except Exception as e:  # isolation: log and continue with other sources
            print(f"{sid} {d} error: {type(e).__name__}: {e}")
            res[sid] = ERROR
    return res


# ---- snapshots (S11, S15) ------------------------------------------------------------------------------------------

def _latest_snapshot_dir(kind: str) -> tuple[date | None, object]:
    base = STORE_DIR / kind
    if not base.exists():
        return None, None
    items = sorted(p for p in base.iterdir() if p.name[:2] == "20")
    if not items:
        return None, None
    p = items[-1]
    return date.fromisoformat(p.name.split(".")[0]), p


def fetch_snapshots(client: Client, as_of: date, cal: dict, force: bool = False, which: list[str] | None = None) -> dict:
    """S11 constituents / S15 equity list. Stores a new snapshot only if content changed."""
    out = {}
    which = which or SNAPSHOT_ORDER
    checked = cal.setdefault("snapshotsChecked", {})
    for sid in which:
        key = REGISTRY[sid.upper()].key
        if not config.run_here(key):
            out[sid] = DISABLED
            continue
        last = checked.get(key)
        if last and not force and (as_of - date.fromisoformat(last)).days < SNAPSHOT_RECHECK_DAYS:
            out[sid] = SKIPPED
            continue
        if sid == "s11":
            files, bad = {}, None
            for label, url in s11.urls(as_of):
                r = _get(client, "S11", url, as_of)
                if not r.ok:
                    bad = f"{label}: http {r.http}"
                    break
                _, err = _validate("s11", r, as_of, label)
                if err:
                    bad = err
                    break
                files[label] = r.body
            if bad:
                _warn(f"S11 snapshot not stored: {bad}")
                out[sid] = INVALID if "http" not in bad else MISSING
                continue
            _, ldir = _latest_snapshot_dir("constituents")
            same = ldir is not None and all(
                (ldir / f"{k}.csv").exists() and (ldir / f"{k}.csv").read_bytes() == v for k, v in files.items())
            if same:
                out[sid] = SKIPPED
            else:
                for k, v in files.items():
                    store.write_atomic(STORE_DIR / "constituents" / as_of.isoformat() / f"{k}.csv", v, force=True)
                out[sid] = STORED
        else:
            r = _get(client, "S15", REGISTRY["S15"].urls(as_of)[0][1], as_of)
            code = _classify(r)
            if code:
                out[sid] = code
                continue
            _, err = _validate("s15", r, as_of)
            if err:
                _warn(f"S15 snapshot not stored: {err}")
                out[sid] = INVALID
                continue
            _, lpath = _latest_snapshot_dir("equity_list")
            if lpath is not None and store.read_bytes(lpath) == r.body:
                out[sid] = SKIPPED
            else:
                store.write_atomic(STORE_DIR / "equity_list" / f"{as_of.isoformat()}.csv.gz", store.gz_bytes(r.body),
                                   force=True)
                out[sid] = STORED
        checked[key] = as_of.isoformat()
    return out


def digest(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:12]


# ---- orchestration -------------------------------------------------------------------------------------------------

def run_range(frm: date, to: date, sources: list[str] | None = None, force: bool = False, label: str = "fetch") -> dict:
    settings = config.settings()
    client = Client(delay_sec=settings["requestDelaySec"], log_dir=STORE_DIR / "logs")
    wanted = [s.lower() for s in sources] if sources else list(FETCHABLE)
    daily = [s for s in wanted if s in DAILY_ORDER]
    snaps = [s for s in wanted if s in SNAPSHOT_ORDER]
    cal = cal_mod.load()
    days = list(cal_mod.daterange(frm, to))
    t0 = time.monotonic()
    totals: dict[str, int] = {}
    for i, d in enumerate(days, 1):
        res = fetch_date(client, d, daily, cal, force)
        for v in res.values():
            totals[v] = totals.get(v, 0) + 1
        cal_mod.save(cal)  # resumable: progress is persisted every day
        elapsed = time.monotonic() - t0
        eta = elapsed / i * (len(days) - i)
        flags = " ".join(f"{k}:{v}" for k, v in res.items() if v != SKIPPED) or "all present"
        print(f"[{i}/{len(days)}] {d} {d:%a} {flags}  (ETA {eta / 60:.1f} min)", flush=True)
    if snaps:
        res = fetch_snapshots(client, min(to, cal_mod.today_ist()), cal, force, snaps)
        print("snapshots:", res, flush=True)
        cal_mod.save(cal)
    print(f"{label} done: {totals}", flush=True)
    return totals
