"""Collection of S8 (FII/DII cash) and S9/S10 (bulk/block deals). Store only; derived JSON is Phase 4.

The daily endpoints serve the latest trading day only, so a missed day cannot be recovered from them. Dates always
come from the payload (never from "today"), and every write is idempotent.
"""

from __future__ import annotations

import io
import json
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from . import config, store
from .config import STORE_DIR
from .http import Client
from .sources import REGISTRY, s8_fii_dii_cash
from .sources.base import parse_dmy_mon

DEAL_COLUMNS = ["date", "type", "symbol", "securityName", "client", "side", "qty", "price", "remarks"]
STORED, SKIPPED, ERROR, INVALID, DISABLED = "stored", "skip", "error", "invalid", "disabled"

HIST_URL = "https://www.nseindia.com/api/historicalOR/bulk-block-short-deals"
HIST_REFERER = "https://www.nseindia.com/report-detail/display-bulk-and-block-deals"
HIST_WARM = ("https://www.nseindia.com/", HIST_REFERER)
HIST_TYPES = (("bulk", "bulk_deals"), ("block", "block_deals"))  # short_selling is not in the specs
HIST_KEYS = ["BD_DT_DATE", "BD_SYMBOL", "BD_SCRIP_NAME", "BD_CLIENT_NAME", "BD_BUY_SELL", "BD_QTY_TRD",
             "BD_TP_WATP", "BD_REMARKS"]
HIST_CAP = 70  # observed hard limit of records per request
JSON_HEADERS = {"Accept": "application/json, text/plain, */*"}


def _warn(msg: str) -> None:
    print(f"::warning::{msg}", flush=True)


def _today() -> date:
    from . import calendar as cal_mod

    return cal_mod.today_ist()


# ---- S8 ------------------------------------------------------------------------------------------------------------

def payload_date(payload: list[dict]):
    """The single trade date of an S8 payload, or None when dates are missing/unparseable/inconsistent."""
    dates = {parse_dmy_mon(r.get("date", "")) for r in payload}
    if len(dates) != 1 or None in dates:
        return None
    return next(iter(dates))


def upsert_fii_dii(payload: list[dict], fetched_at: str, root=None) -> str:
    """One JSON line per trade date in store/fii_dii_cash/YYYY.jsonl, keyed by the date inside the payload.

    Returns stored / skip / invalid. A re-run with identical figures changes nothing. A changed payload (provisional
    figures revised) replaces the line for that date.
    """
    d = payload_date(payload)
    if d is None:
        return INVALID
    path = (root or STORE_DIR) / "fii_dii_cash" / f"{d.year}.jsonl"
    lines: dict[str, dict] = {}
    if path.exists():
        for ln in path.read_text(encoding="utf-8").splitlines():
            if ln.strip():
                rec = json.loads(ln)
                lines[rec["date"]] = rec
    key = d.isoformat()

    def norm(p):
        return sorted(p, key=lambda r: r["category"])

    if key in lines and norm(lines[key]["payload"]) == norm(payload):
        return SKIPPED
    lines[key] = {"date": key, "payload": payload, "fetchedAt": fetched_at}
    text = "".join(json.dumps(lines[k], sort_keys=True) + "\n" for k in sorted(lines))
    store.write_atomic(path, text.encode("utf-8"), force=True)
    return STORED


def collect_fii_dii(client: Client, root=None) -> str:
    if not config.run_here("fii_dii_cash"):
        return DISABLED
    spec = REGISTRY["S8"]
    client.warm_up(spec.warm)  # the homepage may answer 403 on Actions; /reports/fii-dii still sets the cookies
    r = client.get(s8_fii_dii_cash.API, headers={**JSON_HEADERS, "Referer": spec.referer}, source="S8")
    if not r.ok:
        _warn(f"S8 http {r.http}")
        return ERROR
    p = s8_fii_dii_cash.parse(r.body, _today())
    if p.errors:
        _warn(f"S8 schema_mismatch: {'; '.join(p.errors)}")
        return INVALID
    res = upsert_fii_dii(p.data, datetime.now(timezone.utc).isoformat(timespec="seconds"), root)
    if res == INVALID:
        _warn("S8 payload date missing or inconsistent; not stored")
    return res


# ---- S9 / S10 ------------------------------------------------------------------------------------------------------

def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df[(df["date"] != "") & df["qty"].notna() & df["price"].notna()].copy()
    df["qty"] = df["qty"].astype("int64")
    df["price"] = df["price"].astype(float).round(4)
    df["remarks"] = df["remarks"].replace({"": "-", "None": "-", "nan": "-"})
    return df[DEAL_COLUMNS]


def normalise_deals(df: pd.DataFrame, kind: str) -> pd.DataFrame:
    """Parsed daily S9/S10 frame (strings) -> DEAL_COLUMNS. Dates come from the Date column; bad rows are dropped."""
    out = pd.DataFrame({
        "date": [str(parse_dmy_mon(x) or "") for x in df["Date"]],
        "type": kind,
        "symbol": df["Symbol"].astype(str).str.strip(),
        "securityName": df["Security Name"].astype(str).str.strip(),
        "client": df["Client Name"].astype(str).str.strip(),
        "side": df["Buy/Sell"].astype(str).str.strip().str.upper(),
        "qty": pd.to_numeric(df["Quantity Traded"].astype(str).str.replace(",", ""), errors="coerce"),
        "price": pd.to_numeric(df["Trade Price / Wght. Avg. Price"].astype(str).str.replace(",", ""),
                               errors="coerce"),
        "remarks": df["Remarks"].astype(str).str.strip() if "Remarks" in df.columns else "-",
    })
    return _clean(out)


def normalise_historical(records: list[dict], kind: str) -> tuple[pd.DataFrame, list[str]]:
    """historicalOR `data` records -> DEAL_COLUMNS, using the same representation as the daily CSV path.

    Returns (frame, problems). A record missing a required key is reported and dropped.
    """
    problems: list[str] = []
    good = []
    for rec in records:
        missing = [k for k in HIST_KEYS if k not in rec]
        if missing:
            problems.append(f"record missing {missing}")
            continue
        good.append(rec)
    out = pd.DataFrame({
        "date": [str(parse_dmy_mon(r["BD_DT_DATE"]) or "") for r in good],
        "type": kind,
        "symbol": [str(r["BD_SYMBOL"]).strip() for r in good],
        "securityName": [str(r["BD_SCRIP_NAME"]).strip() for r in good],
        "client": [str(r["BD_CLIENT_NAME"]).strip() for r in good],
        "side": [str(r["BD_BUY_SELL"]).strip().upper() for r in good],
        "qty": pd.to_numeric(pd.Series([str(r["BD_QTY_TRD"]).replace(",", "") for r in good], dtype=object), errors="coerce"),
        "price": pd.to_numeric(pd.Series([str(r["BD_TP_WATP"]).replace(",", "") for r in good], dtype=object), errors="coerce"),
        "remarks": [("-" if r["BD_REMARKS"] in (None, "") else str(r["BD_REMARKS"]).strip()) for r in good],
    })
    before = len(out)
    out = _clean(out)
    if before != len(out):
        problems.append(f"{before - len(out)} rows with bad date/qty/price dropped")
    bad_side = ~out["side"].isin(("BUY", "SELL"))
    if bad_side.any():
        problems.append(f"{int(bad_side.sum())} rows with side not BUY/SELL dropped")
        out = out[~bad_side]
    return out.reset_index(drop=True), problems


def merge_deals(new: pd.DataFrame, root=None) -> dict[int, int]:
    """Append rows not already stored, per year file store/deals/YYYY.csv. Returns {year: rows added}.

    The dedupe key is the whole row (DEAL_COLUMNS), as a multiset: identical rows inside one batch are kept (a client
    can really trade the same size twice), but a row already stored as many times as it appears in the batch is not
    added again. So a re-run, or a daily file overlapping a historical backfill, adds 0 rows.
    """
    base = root or STORE_DIR
    added: dict[int, int] = {}
    if new.empty:
        return added
    new = new.assign(_y=new["date"].str[:4].astype(int))
    for year, grp in new.groupby("_y"):
        path = base / "deals" / f"{year}.csv"
        grp = grp[DEAL_COLUMNS]
        if path.exists():
            old = pd.read_csv(path, dtype=str, keep_default_na=False)
            old["qty"] = old["qty"].astype("int64")
            old["price"] = old["price"].astype(float).round(4)
        else:
            old = pd.DataFrame(columns=DEAL_COLUMNS).astype({"qty": "int64", "price": "float64"})
        old = old.assign(_n=old.groupby(DEAL_COLUMNS).cumcount())
        cand = grp.assign(_n=grp.groupby(DEAL_COLUMNS).cumcount())
        merged = cand.merge(old[DEAL_COLUMNS + ["_n"]], on=DEAL_COLUMNS + ["_n"], how="left", indicator=True)
        fresh = merged[merged["_merge"] == "left_only"][DEAL_COLUMNS]
        if fresh.empty:
            continue
        allrows = pd.concat([old[DEAL_COLUMNS], fresh], ignore_index=True)
        allrows = allrows.sort_values(["date", "type", "symbol"], kind="stable")
        buf = io.StringIO()
        allrows.to_csv(buf, index=False, lineterminator="\n")
        store.write_atomic(path, buf.getvalue().encode("utf-8"), force=True)
        added[int(year)] = len(fresh)
    return added


def collect_deals(client: Client, root=None) -> str:
    if not config.run_here("deals"):
        return DISABLED
    frames = []
    ok = True
    for sid, kind in (("S9", "bulk"), ("S10", "block")):
        spec = REGISTRY[sid]
        r = client.get(spec.urls(_today())[0][1], source=sid)
        if not r.ok:
            _warn(f"{sid} http {r.http}")
            ok = False
            continue
        bad = spec.check_body(r.body)
        p = None if bad else spec.parse(r.body, _today())
        if bad or p.errors:
            _warn(f"{sid} schema_mismatch: {bad or '; '.join(p.errors)}")
            ok = False
            continue
        frames.append(normalise_deals(p.data, kind))
    if frames:
        added = merge_deals(pd.concat(frames, ignore_index=True), root)
        print(f"deals: added {sum(added.values())} rows {added}", flush=True)
        return STORED if added else SKIPPED
    return ERROR if not ok else SKIPPED


def collect_latest(client: Client | None = None) -> dict[str, str]:
    """Run S8 and S9/S10 independently; one failing never stops the other."""
    client = client or Client(delay_sec=config.settings()["requestDelaySec"], log_dir=STORE_DIR / "logs")
    res = {}
    for name, fn in (("s8", collect_fii_dii), ("s9_s10", collect_deals)):
        try:
            res[name] = fn(client)
        except Exception as e:
            print(f"{name} error: {type(e).__name__}: {e}")
            res[name] = ERROR
    print("collect:", res, flush=True)
    return res


# ---- historical deals backfill (user-approved 2026-11-14) ----------------------------------------------------------

def month_chunks(frm: date, to: date) -> list[tuple[date, date]]:
    out = []
    cur = frm
    while cur <= to:
        nxt = (cur.replace(day=1) + timedelta(days=32)).replace(day=1)
        out.append((cur, min(to, nxt - timedelta(days=1))))
        cur = nxt
    return out


def _fetch_hist(client: Client, kind: str, opt: str, a: date, b: date) -> list[dict] | None:
    url = f"{HIST_URL}?optionType={opt}&from={a:%d-%m-%Y}&to={b:%d-%m-%Y}"
    r = client.get(url, headers={**JSON_HEADERS, "Referer": HIST_REFERER}, source="S9H" if kind == "bulk" else "S10H")
    try:
        payload = json.loads(r.body) if r.ok else None
    except ValueError:
        payload = None
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        _warn(f"deals backfill {kind} {a}..{b}: http {r.http}, unexpected payload")
        return None
    return payload["data"]


def fetch_hist_range(client: Client, kind: str, opt: str, a: date, b: date, truncated: list[str],
                     fetch=_fetch_hist) -> list[dict] | None:
    """The endpoint returns at most HIST_CAP records per request (the earliest dates first), so a window that hits
    the cap is split in halves until single days. A single day that still hits the cap is truncated: its date is
    appended to `truncated` (the daily bulk.csv/block.csv files are complete going forward)."""
    data = fetch(client, kind, opt, a, b)
    if data is None:
        return None
    if len(data) < HIST_CAP:
        return data
    if a == b:
        truncated.append(f"{kind} {a.isoformat()}")
        return data
    mid = a + (b - a) // 2
    left = fetch_hist_range(client, kind, opt, a, mid, truncated, fetch)
    right = fetch_hist_range(client, kind, opt, mid + timedelta(days=1), b, truncated, fetch)
    if left is None or right is None:
        return None
    return left + right


def backfill_deals(frm: date, to: date, client: Client | None = None, root=None) -> dict:
    """Bulk and block deals from the historicalOR endpoint, month by month (split further when capped). Resumable:
    completed past months are recorded in store/deals/_backfill.json and skipped; merging is idempotent anyway."""
    base = root or STORE_DIR
    client = client or Client(delay_sec=config.settings()["requestDelaySec"], log_dir=base / "logs")
    state_path = base / "deals" / "_backfill.json"
    state = store.read_json(state_path, {"done": {}, "truncated": []})
    state.setdefault("truncated", [])
    today = _today()
    client.warm_up(HIST_WARM)
    summary = {"added": 0, "fetched": 0, "problems": 0, "failedChunks": [], "truncated": 0}
    for a, b in month_chunks(frm, to):
        key = f"{a.isoformat()}..{b.isoformat()}"
        if key in state["done"]:
            print(f"{key} already done", flush=True)
            continue
        frames, failed, trunc = [], False, []
        for kind, opt in HIST_TYPES:
            data = fetch_hist_range(client, kind, opt, a, b, trunc)
            if data is None:
                failed = True
                continue
            df, problems = normalise_historical(data, kind)
            for p in problems:
                _warn(f"deals backfill {key} {kind}: {p}")
            summary["problems"] += len(problems)
            summary["fetched"] += len(df)
            frames.append(df)
        n = 0
        if frames:
            added = merge_deals(pd.concat(frames, ignore_index=True), root)
            n = sum(added.values())
            summary["added"] += n
        state["truncated"] = sorted(set(state["truncated"]) | set(trunc))
        summary["truncated"] += len(trunc)
        print(f"{key}: {n} rows added, {len(trunc)} capped single days", flush=True)
        if failed:
            summary["failedChunks"].append(key)
        elif b < today:  # a month still in progress is re-fetched next time
            state["done"][key] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        store.write_json_atomic(state_path, state)
    print("backfill-deals done:", summary, flush=True)
    return summary
