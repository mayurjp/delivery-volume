"""Stage extra history (S1 delivery, S12 index closes, S3 F&O extract) in the store's exact formats.

Usage: python -I load_history.py <project root> <staging dir> <from YYYY-MM-DD> <to YYYY-MM-DD>
- Probes S1 for every calendar date (weekends too: special sessions exist). A date is a trading day only if
  DATE1 in the file equals the requested date (NSE serves the previous day's file on some holidays).
- For trading days: S12 ind_close_all (validated on Index Date), and S3 F&O UDiFF from 2024-07-08 (reduced
  extract identical to store/fo_extract format).
- Writes <staging>/{cm_delivery,indices_close,fo_extract}/YYYY/DATE.* and <staging>/calendar.json.
- Sequential, >= 1 s between requests, retries with backoff, resumable, atomic writes, gzip mtime=0.
"""
import datetime as dt
import gzip
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path

import pandas as pd
import requests

root, stage = Path(sys.argv[1]), Path(sys.argv[2])
d0, d1 = dt.date.fromisoformat(sys.argv[3]), dt.date.fromisoformat(sys.argv[4])
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/130.0 Safari/537.36",
     "Referer": "https://www.nseindia.com/", "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}
FO_START = dt.date(2024, 7, 8)
s = requests.Session()
last = 0.0
cal_path = stage / "calendar.json"
cal = json.loads(cal_path.read_text(encoding="utf-8")) if cal_path.exists() else {"tradingDays": [], "noData": []}
known = set(cal["tradingDays"]) | set(cal["noData"])
stats = {"s1": 0, "s12": 0, "fo": 0, "nodata": 0, "failed": 0}


def get(url):
    global last
    for wait in (2, 6, 18, None):
        gap = time.time() - last
        if gap < 1.0:
            time.sleep(1.0 - gap)
        last = time.time()
        try:
            r = s.get(url, headers=H, timeout=45)
            if r.status_code == 404:
                return None
            if r.status_code < 500 and r.status_code != 429:
                r.raise_for_status()
                return r.content
        except requests.RequestException:
            pass
        if wait is None:
            raise RuntimeError(f"failed after retries: {url}")
        time.sleep(wait)


def put(path: Path, data: bytes, gz: bool):
    path.parent.mkdir(parents=True, exist_ok=True)
    if gz:
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as g:
            g.write(data)
        data = buf.getvalue()
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def save_cal():
    cal["tradingDays"] = sorted(set(cal["tradingDays"]))
    cal["noData"] = sorted(set(cal["noData"]))
    put(cal_path, json.dumps(cal, indent=1).encode(), gz=False)


S1_HDR = "SYMBOL, SERIES, DATE1, PREV_CLOSE"
COLS = ["symbol", "instType", "expiry", "optType", "oi", "chgOi", "volume", "valueRs", "close", "settle", "underlying"]
NEED = ["TradDt", "FinInstrmTp", "TckrSymb", "XpryDt", "OptnTp", "ClsPric", "SttlmPric", "UndrlygPric",
        "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol", "TtlTrfVal"]

d = d0
while d <= d1:
    iso, ddmmyyyy = d.isoformat(), d.strftime("%d%m%Y")
    try:
        # --- S1: discover trading day ---
        s1_out = stage / "cm_delivery" / iso[:4] / f"{iso}.csv.gz"
        if iso not in known:
            body = get(f"https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv")
            ok = False
            if body is not None:
                text = body.decode("utf-8", errors="replace")
                lines = text.splitlines()
                if lines and lines[0].startswith(S1_HDR) and len(lines) > 1000:
                    want = d.strftime("%d-%b-%Y")
                    ok = all(ln.split(",")[2].strip() == want for ln in lines[1:6] if ln.count(",") >= 3)
            if ok:
                put(s1_out, body, gz=True)
                cal["tradingDays"].append(iso)
                stats["s1"] += 1
            else:
                cal["noData"].append(iso)
                stats["nodata"] += 1
            known.add(iso)
            save_cal()
        if iso in cal["tradingDays"]:
            # --- S12 index closes ---
            s12_out = stage / "indices_close" / iso[:4] / f"{iso}.csv.gz"
            if not s12_out.exists():
                body = get(f"https://nsearchives.nseindia.com/content/indices/ind_close_all_{ddmmyyyy}.csv")
                if body is not None:
                    t = body.decode("utf-8", errors="replace").splitlines()
                    if t and t[0].startswith("Index Name") and d.strftime("%d-%m-%Y") in t[1]:
                        put(s12_out, body, gz=True)
                        stats["s12"] += 1
                    else:
                        print(f"{iso} S12 invalid", flush=True)
            # --- S3 F&O extract ---
            fo_out = stage / "fo_extract" / iso[:4] / f"{iso}.csv.gz"
            if d >= FO_START and not fo_out.exists():
                body = get(f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{d.strftime('%Y%m%d')}_F_0000.csv.zip")
                if body is not None and body[:2] == b"PK":
                    with zipfile.ZipFile(io.BytesIO(body)) as z:
                        df = pd.read_csv(z.open(z.namelist()[0]), usecols=NEED, dtype={"OptnTp": str}, low_memory=False)
                    if (df["TradDt"].astype(str) == iso).all() and (df["FinInstrmTp"] == "STF").sum() >= 100:
                        df = df.rename(columns={"TckrSymb": "symbol", "FinInstrmTp": "instType", "XpryDt": "expiry",
                                                "OptnTp": "optType", "OpnIntrst": "oi", "ChngInOpnIntrst": "chgOi",
                                                "TtlTradgVol": "volume", "TtlTrfVal": "valueRs", "ClsPric": "close",
                                                "SttlmPric": "settle", "UndrlygPric": "underlying"})
                        df["optType"] = df["optType"].fillna("")
                        fut = df[df["instType"].isin(["STF", "IDF"])][COLS]
                        opt = (df[df["instType"].isin(["STO", "IDO"])]
                               .groupby(["symbol", "instType", "expiry", "optType"], as_index=False)
                               .agg(oi=("oi", "sum"), chgOi=("chgOi", "sum"), volume=("volume", "sum"),
                                    valueRs=("valueRs", "sum"), underlying=("underlying", "first")))
                        opt["close"] = pd.NA
                        opt["settle"] = pd.NA
                        ext = pd.concat([fut, opt[COLS]], ignore_index=True).sort_values(
                            ["instType", "symbol", "expiry", "optType"])
                        put(fo_out, ext.to_csv(index=False, lineterminator="\n").encode("utf-8"), gz=True)
                        stats["fo"] += 1
                    else:
                        print(f"{iso} FO invalid", flush=True)
                elif body is not None:
                    print(f"{iso} FO not a zip", flush=True)
    except Exception as e:
        stats["failed"] += 1
        print(f"{iso} FAILED: {e}", flush=True)
    if d.day == 1:
        print(f"{iso} progress {stats}", flush=True)
    d += dt.timedelta(days=1)

save_cal()
print("finished", json.dumps(stats), f"tradingDays={len(cal['tradingDays'])}", flush=True)
