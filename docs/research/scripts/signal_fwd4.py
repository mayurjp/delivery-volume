"""Named FII/DII bulk/block deals -> forward returns (read-only over daily JSON + store/deals).

Usage: python -I signal_fwd4.py <project root>

Phase 4 version: the entity categories come from config/entities.json through pipeline/entities.py (the same code the
build uses), and round trips and the per-stock category net come from pipeline/deals.py (the same flows as
deals/flows.json). Earlier runs used a keyword heuristic; the old tables are kept in the study document.

Event = stock-day with category net value via deals > 0 (net bought) or < 0 (net sold). Forward excess returns vs the
daily median of all liquid EQ stocks, entry at close(t) [lag0] and at close(t+1) [lag1: deals are published after the
close]. Liquidity and flags as in signal_fwd.py.
"""
import glob
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))  # -I ignores the script directory, so the project package is added explicitly

from pipeline import deals as D  # noqa: E402
from pipeline.entities import EntityIndex, load_seeds  # noqa: E402

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

raw = D.load_raw([pd.read_csv(f, dtype=str, keep_default_na=False)
                  for f in sorted(glob.glob(str(root / "store/deals/20*.csv")))])
ds = D.build_deals(raw, EntityIndex(load_seeds(root)), None, None)
ds = ds[ds["sym"].isin(set(daily["sym"]))]
print(f"deal rows={len(ds)}  round trips dropped={int(ds['roundTrip'].sum())}  "
      f"entities={ds['entityId'].nunique()}")
share = ds.groupby("entityCategory")["valueCr"].sum() / ds["valueCr"].sum()
print("share of gross deal value by entity category:", {k: round(float(v), 4) for k, v in share.items()})
fl = D.flows(ds)
print("stock-days with a category net, by category:", fl["category"].value_counts().to_dict())
net = fl.pivot_table(index=["date", "sym"], columns="category", values="netValueCr", aggfunc="sum",
                     fill_value=0.0).reset_index().rename(columns={"sym": "sym"})
for c in ("FII", "DII", "Other"):
    if c not in net:
        net[c] = 0.0

df = daily.copy()
df["t"] = df["date"].map(tix)
df["flags"] = df["flags"].fillna(0).astype(int)
df = df[((df["flags"] & (256 | 1 | 512)) == 0) & (df["series"] == "EQ")].copy()
df = df.merge(net, on=["date", "sym"], how="left").fillna({"FII": 0.0, "DII": 0.0, "Other": 0.0})

T, syms = len(days), sorted(daily["sym"].unique())
si = {s: i for i, s in enumerate(syms)}
C = np.full((T, len(syms)), np.nan)
P = np.full((T, len(syms)), np.nan)
C[daily["date"].map(tix), daily["sym"].map(si)] = daily["close"]
P[daily["date"].map(tix), daily["sym"].map(si)] = daily["prevClose"]
prev_c = np.vstack([np.full((1, len(syms)), np.nan), C[:-1]])
# a split/bonus shows up as a one-day close ratio: NSE's PREV_CLOSE is raw on the ex-date
adj_cum = np.cumsum(np.nan_to_num((np.abs(P / prev_c - 1) > 0.03) | (C / prev_c <= 0.78) | (C / prev_c >= 1.8), nan=0).astype(int), axis=0)
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
F, D_, O = df["FII"], df["DII"], df["Other"]
heavy = df["spike"] >= 2
for name, m in [
    ("FII net BUY via deals", F > 0), ("FII net SELL via deals", F < 0),
    ("DII net BUY via deals", D_ > 0), ("DII net SELL via deals", D_ < 0),
    ("FII buy >= Rs 25 Cr", F >= 25), ("DII buy >= Rs 25 Cr", D_ >= 25),
    ("FII sell <= -Rs 25 Cr", F <= -25), ("DII sell <= -Rs 25 Cr", D_ <= -25),
    ("FII + DII both net buy", (F > 0) & (D_ > 0)),
    ("FII sell, DII buy (handover to DII)", (F < 0) & (D_ > 0)),
    ("FII buy, DII sell", (F > 0) & (D_ < 0)),
    ("Institutional (FII+DII) net buy + delivery >= 2x", (F + D_ > 0) & heavy),
    ("Institutional net buy + price up (ACC)", (F + D_ > 0) & (df["signal"] == "ACC")),
    ("Other/unclassified net buy only", (O > 0) & (F == 0) & (D_ == 0)),
]:
    line(name, m)
