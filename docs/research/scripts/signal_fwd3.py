"""Delivery x F&O build-up study (read-only over generated daily JSON + store/fo_extract).

Usage: python -I signal_fwd3.py <project root>
Universe: liquid EQ stocks that have stock futures (STF) that day. Benchmark = that universe's daily median.
futOi(t) = sum of STF OI across all expiries. OI change is skipped when an STF expiry for the symbol falls in [t-1, t].
Build-up (04 §4.4): LB ret1>0 & dOI>=+2%; SB ret1<0 & dOI>=+2%; SC ret1>0 & dOI<=-2%; LU ret1<0 & dOI<=-2%.
"""
import gzip
import io
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

root = Path(sys.argv[1])
data = root / "site/public/data"
frames = []
for f in sorted((data / "daily").glob("20*.json")):
    doc = json.loads(f.read_text(encoding="utf-8"))
    df = pd.DataFrame(doc["rows"], columns=doc["columns"])
    df["date"] = doc["date"]
    frames.append(df[["date", "sym", "series", "close", "prevClose", "ret1", "spike", "signal", "flags"]])
df = pd.concat(frames, ignore_index=True)
days = sorted(df["date"].unique())
tix = {x: i for i, x in enumerate(days)}

fo = []
for f in sorted((root / "store/fo_extract").rglob("*.csv.gz")):
    x = pd.read_csv(io.BytesIO(gzip.decompress(f.read_bytes())), usecols=["symbol", "instType", "expiry", "oi"])
    x = x[x["instType"] == "STF"]
    x["date"] = f.name[:10]
    fo.append(x)
fo = pd.concat(fo, ignore_index=True)
oi = fo.groupby(["symbol", "date"], as_index=False)["oi"].sum().rename(columns={"symbol": "sym", "oi": "futOi"})
exp = fo.groupby("symbol")["expiry"].unique().to_dict()          # all expiries seen per symbol
oi["t"] = oi["date"].map(tix)
oi = oi.dropna(subset=["t"]).sort_values(["sym", "t"])
oi["t"] = oi["t"].astype(int)
oi["prevOi"] = oi.groupby("sym")["futOi"].shift(1)
oi["prevT"] = oi.groupby("sym")["t"].shift(1)
oi["dOi"] = (oi["futOi"] / oi["prevOi"] - 1) * 100


def crosses_expiry(row):
    if pd.isna(row.prevT):
        return True
    lo, hi = days[int(row.prevT)], row.date
    return any(lo <= e <= hi for e in exp.get(row.sym, ()))


oi["expiryGap"] = [crosses_expiry(r) for r in oi.itertuples()]
oi.loc[oi["expiryGap"] | (oi["prevT"] != oi["t"] - 1), "dOi"] = np.nan

df = df.merge(oi[["sym", "date", "dOi"]], on=["sym", "date"], how="inner")   # F&O stocks only
df["t"] = df["date"].map(tix)
df["flags"] = df["flags"].fillna(0).astype(int)
df = df[((df["flags"] & (256 | 1 | 512)) == 0) & (df["series"] == "EQ")].copy()
up, dn = df["ret1"] > 0, df["ret1"] < 0
df["bu"] = np.select([up & (df["dOi"] >= 2), dn & (df["dOi"] >= 2), up & (df["dOi"] <= -2), dn & (df["dOi"] <= -2)],
                     ["LB", "SB", "SC", "LU"], default="")

T, syms = len(days), sorted(df["sym"].unique())
si = {s: i for i, s in enumerate(syms)}
full = pd.concat(frames, ignore_index=True)
full = full[full["sym"].isin(si)]
C = np.full((T, len(syms)), np.nan)
P = np.full((T, len(syms)), np.nan)
C[full["date"].map(tix), full["sym"].map(si)] = full["close"]
P[full["date"].map(tix), full["sym"].map(si)] = full["prevClose"]
prev_c = np.vstack([np.full((1, len(syms)), np.nan), C[:-1]])
adj_cum = np.cumsum(np.nan_to_num(np.abs(P / prev_c - 1) > 0.03, nan=0).astype(int), axis=0)
ti, sj = df["t"].to_numpy(), df["sym"].map(si).to_numpy()
for k in (5, 20):
    tk = np.where(ti + k < T, ti + k, 0)
    r = C[tk, sj] / C[ti, sj] - 1
    good = (ti + k < T) & (adj_cum[tk, sj] == adj_cum[ti, sj])
    df[f"f{k}"] = np.where(good, r * 100, np.nan)
    df[f"x{k}"] = df[f"f{k}"] - df.groupby("t")[f"f{k}"].transform("median")


def line(name, m):
    cells = []
    for k in (5, 20):
        x = df.loc[m, f"x{k}"].dropna()
        cells.append(f"{x.median():+6.2f} {100 * (x > 0).mean():4.0f}%" if len(x) >= 30 else f"{'n<30':>12s}")
    print(f"  {name:52s} {int(m.sum()):6d} {df.loc[m, 'date'].nunique():4d} | {cells[0]:>12s} | {cells[1]:>12s}")


print(f"days={T}  F&O stock-days={len(df)}  stocks={df['sym'].nunique()}  "
      f"with valid OI change={df['dOi'].notna().sum()}")
print(f"  {'test (benchmark = F&O-stock median)':52s} {'n':>6s} {'days':>4s} | {'+5d med hit':>12s} | {'+20d med hit':>12s}")
sig, bu = df["signal"], df["bu"]
heavy_up = (df["spike"] >= 2) & (df["ret1"] >= 1)
for name, m in [
    ("Long build-up (LB)", bu == "LB"), ("Short build-up (SB)", bu == "SB"),
    ("Short covering (SC)", bu == "SC"), ("Long unwinding (LU)", bu == "LU"),
    ("ACC up on heavy delivery (F&O stocks)", sig == "ACC"),
    ("ACC + long build-up", (sig == "ACC") & (bu == "LB")),
    ("ACC + short covering", (sig == "ACC") & (bu == "SC")),
    ("DIS down on heavy delivery (F&O stocks)", sig == "DIS"),
    ("DIS + short build-up", (sig == "DIS") & (bu == "SB")),
    ("DIS + long unwinding", (sig == "DIS") & (bu == "LU")),
    ("Delivery >=2x & up >=1% + long build-up", heavy_up & (bu == "LB")),
    ("Delivery >=2x & up >=1% + short covering", heavy_up & (bu == "SC")),
    ("SPU up on low delivery + long build-up", (sig == "SPU") & (bu == "LB")),
    ("SPU up on low delivery + short covering", (sig == "SPU") & (bu == "SC")),
]:
    line(name, m)
