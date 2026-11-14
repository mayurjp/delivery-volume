"""Named FII/DII bulk/block deals -> forward returns (read-only over daily JSON + store/deals).

Usage: python -I signal_fwd4.py <project root>
Clients are classified with the 04 §5.3 keyword heuristic (no entities.json yet):
  MF / Insurance / Pension / Bank -> DII ; FPI-like -> FII ; everything else (incl. prop/trading) -> Other.
Same-day round trips (same client, symbol, date, |buy-sell| <= 10% of max) are dropped.
Event = stock-day with category net value via deals > 0 (buy) or < 0 (sell).
Forward excess returns vs the daily median of all liquid EQ stocks, entry at close(t) [lag0]
and at close(t+1) [lag1, realistic: deals are published after the close].
"""
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
daily = pd.concat(frames, ignore_index=True)
days = sorted(daily["date"].unique())
tix = {x: i for i, x in enumerate(days)}

deals = pd.concat([pd.read_csv(f) for f in sorted((root / "store/deals").glob("20*.csv"))], ignore_index=True)
deals["client"] = deals["client"].astype(str).str.upper().str.replace(r"\s+", " ", regex=True).str.strip()


def ctype(c):
    if "MUTUAL FUND" in c or c.endswith(" MF"):
        return "DII"
    if "INSURANCE" in c or "ASSURANCE" in c or "PENSION" in c or "PROVIDENT" in c or " BANK" in c:
        return "DII"
    if any(k in c for k in ("PTE", " PLC", " LLC", " FUND", "- ODI", "SICAV", "MAURITIUS", "SINGAPORE")):
        return "FII"
    return "Other"


deals["cat"] = deals["client"].map(ctype)
deals["val"] = deals["qty"] * deals["price"] / 1e7 * np.where(deals["side"].str.upper() == "BUY", 1, -1)
deals["bq"] = np.where(deals["side"].str.upper() == "BUY", deals["qty"], 0)
deals["sq"] = np.where(deals["side"].str.upper() == "SELL", deals["qty"], 0)
g = deals.groupby(["date", "symbol", "client"]).agg(bq=("bq", "sum"), sq=("sq", "sum"), val=("val", "sum"),
                                                     cat=("cat", "first")).reset_index()
rt = (g["bq"] > 0) & (g["sq"] > 0) & ((g["bq"] - g["sq"]).abs() <= 0.1 * np.maximum(g["bq"], g["sq"]))
print(f"deal rows={len(deals)}  client-stock-days={len(g)}  round trips dropped={int(rt.sum())}")
print("client-stock-days by category (after RT):", g[~rt]["cat"].value_counts().to_dict())
net = g[~rt].groupby(["date", "symbol", "cat"])["val"].sum().unstack(fill_value=0.0).reset_index()
net = net.rename(columns={"symbol": "sym"})
for c in ("FII", "DII", "Other"):
    if c not in net:
        net[c] = 0.0

df = daily.copy()
df["t"] = df["date"].map(tix)
df["flags"] = df["flags"].fillna(0).astype(int)
df = df[((df["flags"] & (256 | 1)) == 0) & (df["series"] == "EQ")].copy()
df = df.merge(net, on=["date", "sym"], how="left").fillna({"FII": 0.0, "DII": 0.0, "Other": 0.0})

T, syms = len(days), sorted(daily["sym"].unique())
si = {s: i for i, s in enumerate(syms)}
C = np.full((T, len(syms)), np.nan)
P = np.full((T, len(syms)), np.nan)
C[daily["date"].map(tix), daily["sym"].map(si)] = daily["close"]
P[daily["date"].map(tix), daily["sym"].map(si)] = daily["prevClose"]
prev_c = np.vstack([np.full((1, len(syms)), np.nan), C[:-1]])
adj_cum = np.cumsum(np.nan_to_num(np.abs(P / prev_c - 1) > 0.03, nan=0).astype(int), axis=0)
ti, sj = df["t"].to_numpy(), df["sym"].map(si).to_numpy()
for lag in (0, 1):
    for k in (5, 20):
        t0, t1 = ti + lag, ti + lag + k
        ok = t1 < T
        a, b = np.where(ok, t0, 0), np.where(ok, t1, 0)
        r = C[b, sj] / C[a, sj] - 1
        good = ok & (adj_cum[b, sj] == adj_cum[np.where(ok, ti, 0), sj])
        col = f"f{lag}_{k}"
        df[col] = np.where(good, r * 100, np.nan)
        df[f"x{lag}_{k}"] = df[col] - df.groupby("t")[col].transform("median")


def line(name, m):
    cells = []
    for lag, k in ((0, 20), (1, 5), (1, 20)):
        x = df.loc[m, f"x{lag}_{k}"].dropna()
        cells.append(f"{x.median():+6.2f} {100 * (x > 0).mean():4.0f}%" if len(x) >= 30 else f"{'n<30':>12s}")
    print(f"  {name:50s} {int(m.sum()):5d} {df.loc[m, 'date'].nunique():4d} | " + " | ".join(f"{c:>12s}" for c in cells))


print(f"  {'event (stock-day, net value via deals)':50s} {'n':>5s} {'days':>4s} | "
      f"{'+20d @close t':>12s} | {'+5d @t+1':>12s} | {'+20d @t+1':>12s}")
F, D, O = df["FII"], df["DII"], df["Other"]
heavy = df["spike"] >= 2
for name, m in [
    ("FII net BUY via deals", F > 0), ("FII net SELL via deals", F < 0),
    ("DII net BUY via deals", D > 0), ("DII net SELL via deals", D < 0),
    ("FII buy >= Rs 25 Cr", F >= 25), ("DII buy >= Rs 25 Cr", D >= 25),
    ("FII sell <= -Rs 25 Cr", F <= -25), ("DII sell <= -Rs 25 Cr", D <= -25),
    ("FII + DII both net buy", (F > 0) & (D > 0)),
    ("FII sell, DII buy (handover to DII)", (F < 0) & (D > 0)),
    ("FII buy, DII sell", (F > 0) & (D < 0)),
    ("Institutional (FII+DII) net buy + delivery >= 2x", (F + D > 0) & heavy),
    ("Institutional net buy + price up (ACC)", (F + D > 0) & (df["signal"] == "ACC")),
    ("Other/unclassified net buy only", (O > 0) & (F == 0) & (D == 0)),
]:
    line(name, m)
