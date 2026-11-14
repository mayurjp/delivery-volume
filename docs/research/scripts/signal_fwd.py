"""Forward returns after delivery signals, from the generated daily JSON (read-only).

Usage: python -I signal_fwd.py <site/public/data/daily dir>
Excess return = stock's forward return minus the median forward return of all liquid stocks that day.
Windows that cross a price adjustment (split/bonus: prevClose(t) != close(t-1) by >3%) are dropped.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

d = Path(sys.argv[1])
frames = []
for f in sorted(d.glob("20*.json")):
    doc = json.loads(f.read_text(encoding="utf-8"))
    df = pd.DataFrame(doc["rows"], columns=doc["columns"])
    df["date"] = doc["date"]
    frames.append(df[["date", "sym", "series", "close", "prevClose", "ret1", "spike", "clv",
                      "delivPctDiff", "signal", "flags"]])
df = pd.concat(frames, ignore_index=True)
days = sorted(df["date"].unique())
di = {x: i for i, x in enumerate(days)}
df["t"] = df["date"].map(di)
df["flags"] = df["flags"].fillna(0).astype(int)
liquid = ((df["flags"] & (256 | 1 | 512)) == 0) & (df["series"] == "EQ")  # 512 = ETF (excluded)

T, syms = len(days), sorted(df["sym"].unique())
si = {s: i for i, s in enumerate(syms)}
C = np.full((T, len(syms)), np.nan)
P = np.full((T, len(syms)), np.nan)
C[df["t"], df["sym"].map(si)] = df["close"]
P[df["t"], df["sym"].map(si)] = df["prevClose"]
prev_c = np.vstack([np.full((1, len(syms)), np.nan), C[:-1]])
adj = np.abs(P / prev_c - 1) > 0.03          # price adjustment between t-1 and t
adj = np.nan_to_num(adj, nan=0).astype(int)
adj_cum = np.cumsum(adj, axis=0)

rows = df[liquid].copy()
ti, sj = rows["t"].to_numpy(), rows["sym"].map(si).to_numpy()
for k in (1, 5, 20):
    ok = ti + k < T
    fwd = np.full(len(rows), np.nan)
    tk = np.where(ok, ti + k, 0)
    r = C[tk, sj] / C[ti, sj] - 1
    clean = adj_cum[tk, sj] - adj_cum[ti, sj] == 0
    fwd[ok & clean] = r[ok & clean]
    rows[f"f{k}"] = fwd * 100
    med = rows.groupby("t")[f"f{k}"].transform("median")
    rows[f"x{k}"] = rows[f"f{k}"] - med

groups = {
    "All liquid stocks (baseline)": rows.index == rows.index,
    "ACC  accumulation (up + heavy delivery, strong close)": rows["signal"] == "ACC",
    "DIS  distribution (down + heavy delivery, weak close)": rows["signal"] == "DIS",
    "ABS  absorption (flat price, very heavy delivery)": rows["signal"] == "ABS",
    "SPU  speculative rise (up, low delivery)": rows["signal"] == "SPU",
    "SPD  speculative fall (down, low delivery)": rows["signal"] == "SPD",
    "Delivery spike >=2x, price up >=1%": (rows["spike"] >= 2) & (rows["ret1"] >= 1),
    "Delivery spike >=2x, price down <=-1%": (rows["spike"] >= 2) & (rows["ret1"] <= -1),
}
print(f"days={T} ({days[0]}..{days[-1]})  liquid stock-days={len(rows)}")
print(f"{'group':55s} {'n':>6s} {'dates':>5s} | " + " | ".join(
    f"{'+'+str(k)+'d mean/med/hit':>22s}" for k in (1, 5, 20)))
for name, m in groups.items():
    g = rows[m]
    cells = []
    for k in (1, 5, 20):
        x = g[f"x{k}"].dropna()
        cells.append(f"{x.mean():+6.2f} {x.median():+6.2f} {100 * (x > 0).mean():4.0f}%" if len(x) else " " * 22)
    print(f"{name:55s} {len(g):6d} {g['date'].nunique():5d} | " + " | ".join(f"{c:>22s}" for c in cells))
