"""One-off loader: S3 UDiFF F&O bhavcopy -> store/fo_extract/YYYY/YYYY-MM-DD.csv.gz (03 §3 format).

Usage: python -I load_fo_extract.py <project root>
- Trading days come from store/calendar.json.
- Sequential, >= 1 s between requests, browser headers, 3 retries with backoff.
- Resumable: skips dates whose extract already exists. Writes atomically (tmp -> rename), gzip mtime=0.
- Futures (STF, IDF): one row per symbol x expiry. Options (STO, IDO): summed across strikes per symbol x expiry x optType.
"""
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

root = Path(sys.argv[1])
out_root = root / "store" / "fo_extract"
cal = json.loads((root / "store" / "calendar.json").read_text(encoding="utf-8"))
days = sorted(cal["tradingDays"])
URL = "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{ymd}_F_0000.csv.zip"
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/130.0 Safari/537.36",
     "Referer": "https://www.nseindia.com/", "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}
NEED = ["TradDt", "FinInstrmTp", "TckrSymb", "XpryDt", "OptnTp", "ClsPric", "SttlmPric", "UndrlygPric",
        "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol", "TtlTrfVal"]
COLS = ["symbol", "instType", "expiry", "optType", "oi", "chgOi", "volume", "valueRs", "close", "settle", "underlying"]

s = requests.Session()
last = 0.0
done = skipped = missing = failed = 0


def get(url):
    global last
    for attempt, wait in enumerate((2, 6, 18, None)):
        dt = time.time() - last
        if dt < 1.0:
            time.sleep(1.0 - dt)
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
            raise RuntimeError(f"failed after retries: {url}")
        time.sleep(wait)


for d in days:
    out = out_root / d[:4] / f"{d}.csv.gz"
    if out.exists():
        skipped += 1
        continue
    try:
        body = get(URL.format(ymd=d.replace("-", "")))
        if body is None:
            missing += 1
            print(f"{d} 404", flush=True)
            continue
        if body[:2] != b"PK":
            raise ValueError("not a zip")
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            df = pd.read_csv(z.open(z.namelist()[0]), usecols=NEED, dtype={"OptnTp": str}, low_memory=False)
        if (df["TradDt"].astype(str) != d).any():
            raise ValueError(f"TradDt mismatch: {df['TradDt'].unique()[:3]}")
        if (df["FinInstrmTp"] == "STF").sum() < 100:
            raise ValueError("too few STF rows")
        df = df.rename(columns={"TckrSymb": "symbol", "FinInstrmTp": "instType", "XpryDt": "expiry", "OptnTp": "optType",
                                "OpnIntrst": "oi", "ChngInOpnIntrst": "chgOi", "TtlTradgVol": "volume",
                                "TtlTrfVal": "valueRs", "ClsPric": "close", "SttlmPric": "settle",
                                "UndrlygPric": "underlying"})
        df["optType"] = df["optType"].fillna("")
        fut = df[df["instType"].isin(["STF", "IDF"])][COLS]
        opt = (df[df["instType"].isin(["STO", "IDO"])]
               .groupby(["symbol", "instType", "expiry", "optType"], as_index=False)
               .agg(oi=("oi", "sum"), chgOi=("chgOi", "sum"), volume=("volume", "sum"), valueRs=("valueRs", "sum"),
                    underlying=("underlying", "first")))
        opt["close"] = pd.NA
        opt["settle"] = pd.NA
        ext = pd.concat([fut, opt[COLS]], ignore_index=True).sort_values(["instType", "symbol", "expiry", "optType"])
        out.parent.mkdir(parents=True, exist_ok=True)
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as g:
            g.write(ext.to_csv(index=False, lineterminator="\n").encode("utf-8"))
        tmp = out.with_suffix(".tmp")
        tmp.write_bytes(buf.getvalue())
        os.replace(tmp, out)
        done += 1
        if done % 20 == 0:
            print(f"{d} ok ({done} written)", flush=True)
    except Exception as e:  # keep going; report at the end
        failed += 1
        print(f"{d} FAILED: {e}", flush=True)

print(f"finished: written={done} skipped={skipped} missing={missing} failed={failed} of {len(days)}", flush=True)
