"""Variant tests of delivery signals (read-only over generated daily JSON + store/hl52).

Usage: python -I signal_fwd2.py <project root> [lag 0|1]
Excess return = stock forward return minus the median forward return of the BENCHMARK group that day
(all liquid stocks, or the same cap bucket / Nifty 200 when testing inside that group).
Windows crossing a price adjustment (prevClose(t) vs close(t-1) differ >3%) are dropped.
t(by date) = mean of per-date average excess / (sd / sqrt(#dates)); 20-day windows overlap, so treat t loosely.
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
    frames.append(df[["date", "sym", "series", "high", "close", "prevClose", "ret1", "spike", "clv",
                      "delivPctDiff", "streak", "signal", "flags"]])
df = pd.concat(frames, ignore_index=True)

meta = json.loads((data / "meta.json").read_text(encoding="utf-8"))
uni = json.loads((data / "universe.json").read_text(encoding="utf-8"))
u = pd.DataFrame(uni["rows"], columns=uni["columns"])
b200 = meta["indices"].index("NIFTY200")
u["n200"] = u["idx"].fillna(0).astype(int).map(lambda x: (x >> b200) & 1 == 1)
df = df.merge(u[["sym", "bucket", "n200"]], on="sym", how="left")
df["n200"] = df["n200"].fillna(False).astype(bool)

# 52-week high breakout: file(T) holds highs through T-1, so breakout(T) = high(T) > file(T).high52
hl = []
for f in sorted((root / "store/hl52").rglob("*.csv.gz")):
    h = pd.read_csv(io.BytesIO(gzip.decompress(f.read_bytes())), usecols=["symbol", "high52"])
    h["date"] = f.name[:10]
    hl.append(h.rename(columns={"symbol": "sym", "high52": "prior52h"}))
hl = pd.concat(hl, ignore_index=True)
hl["prior52h"] = pd.to_numeric(hl["prior52h"], errors="coerce")
# the store keeps pre-rename symbols; universe.json lists each symbol's old names (aliases)
alias = {old: r.sym for r in u.itertuples() for old in r.aliases}
hl["sym"] = hl["sym"].replace(alias)
hl = hl.drop_duplicates(["sym", "date"], keep="last")
df = df.merge(hl, on=["sym", "date"], how="left")
df["breakout"] = df["high"] > df["prior52h"]

days = sorted(df["date"].unique())
df["t"] = df["date"].map({x: i for i, x in enumerate(days)})
df["flags"] = df["flags"].fillna(0).astype(int)
allrows = df[["t", "sym", "close", "prevClose"]]   # prices come from every row, whatever its liquidity flag that day
df = df[((df["flags"] & (256 | 1 | 512)) == 0) & (df["series"] == "EQ")].copy()

T, syms = len(days), sorted(allrows["sym"].unique())
si = {s: i for i, s in enumerate(syms)}
C = np.full((T, len(syms)), np.nan)
P = np.full((T, len(syms)), np.nan)
C[allrows["t"], allrows["sym"].map(si)] = allrows["close"]
P[allrows["t"], allrows["sym"].map(si)] = allrows["prevClose"]
prev_c = np.vstack([np.full((1, len(syms)), np.nan), C[:-1]])
adj_cum = np.cumsum(np.nan_to_num(np.abs(P / prev_c - 1) > 0.03, nan=0).astype(int), axis=0)
ti, sj = df["t"].to_numpy(), df["sym"].map(si).to_numpy()
LAG = int(sys.argv[2]) if len(sys.argv) > 2 else 0   # 1 = enter at close(t+1): data is published after the close
for k in (5, 20):
    t0 = np.where(ti + LAG + k < T, ti + LAG, 0)
    tk = np.where(ti + LAG + k < T, ti + LAG + k, 0)
    r = C[tk, sj] / C[t0, sj] - 1
    good = (ti + LAG + k < T) & (adj_cum[tk, sj] == adj_cum[np.where(ti + LAG + k < T, ti, 0), sj])
    df[f"f{k}"] = np.where(good, r * 100, np.nan)
# 5-day trailing price trend (for the sustained-delivery test)
tb = np.where(ti - 5 >= 0, ti - 5, 0)
df["trend5"] = np.where(ti - 5 >= 0, (C[ti, sj] / C[tb, sj] - 1) * 100, np.nan)


def excess(bench_mask, k):
    med = df[bench_mask].groupby("t")[f"f{k}"].median()
    return df[f"f{k}"] - df["t"].map(med)


EX = {}
for bname, bm in {"ALL": df.index == df.index, "N200": df["n200"],
                  **{f"MC:{b}": df["bucket"] == b for b in ("L", "M", "S", "U")}}.items():
    for k in (5, 20):
        EX[(bname, k)] = excess(bm, k)


def line(name, mask, bench="ALL"):
    cells = []
    for k in (5, 20):
        x = EX[(bench, k)][mask].dropna()
        if len(x) < 30:
            cells.append(f"{'n<30':>20s}")
            continue
        per_date = x.groupby(df.loc[x.index, "t"]).mean()
        tstat = per_date.mean() / (per_date.std(ddof=1) / np.sqrt(len(per_date))) if len(per_date) > 2 else np.nan
        cells.append(f"{x.median():+6.2f} {100 * (x > 0).mean():4.0f}% t={tstat:+5.1f}")
    n = int(mask.sum())
    print(f"  {name:58s} {n:6d} {df.loc[mask, 'date'].nunique():4d} | {cells[0]} | {cells[1]}")


hdr = f"  {'test':58s} {'n':>6s} {'days':>4s} | {'+5d med  hit   t':>20s} | {'+20d med  hit   t':>20s}"
sig = df["signal"]
up_spike = (df["spike"] >= 2) & (df["ret1"] >= 1)

print(f"days={T} {days[0]}..{days[-1]}  liquid EQ stock-days={len(df)}")
print("\nA) Signals inside each cap bucket (benchmark = same bucket's median)")
print(hdr)
for b, label in (("L", "Large 1-100"), ("M", "Mid 101-250"), ("S", "Small 251-500"), ("U", "Micro 501+")):
    m = df["bucket"] == b
    for code in ("ACC", "ABS", "DIS", "SPU"):
        line(f"[{label}] {code}", m & (sig == code), f"MC:{b}")

print("\nB) Nifty 200 only (benchmark = Nifty 200 median)")
print(hdr)
n2 = df["n200"]
for name, m in (("ACC accumulation", sig == "ACC"), ("ABS absorption", sig == "ABS"),
                ("DIS distribution", sig == "DIS"), ("SPU speculative rise", sig == "SPU"),
                ("Delivery >=2x & price up >=1%", up_spike)):
    line(name, n2 & m, "N200")

print("\nC) Sustained delivery: first day delivery% has been above its 20D avg for N days")
print(hdr)
for n in (5, 10):
    first = df["streak"] == n
    line(f"streak hits {n}, any price", first)
    line(f"streak hits {n}, price up over last 5 days", first & (df["trend5"] > 0))
    line(f"streak hits {n}, price down over last 5 days", first & (df["trend5"] < 0))
    line(f"streak hits {n}, price up 5d, Nifty 200 only", first & (df["trend5"] > 0) & n2, "N200")

print("\nD) New 52-week high (breakout) with vs without heavy delivery")
print(hdr)
bo = df["breakout"].fillna(False).astype(bool)
line("all 52-week-high breakouts", bo)
line("breakout + delivery >=2x normal", bo & (df["spike"] >= 2))
line("breakout + delivery% >= 20D avg +5pp", bo & (df["delivPctDiff"] >= 5))
line("breakout on LOW delivery (spike < 1)", bo & (df["spike"] < 1))
line("breakout + delivery >=2x, Nifty 200 only", bo & (df["spike"] >= 2) & n2, "N200")
line("breakout on low delivery, Nifty 200 only", bo & (df["spike"] < 1) & n2, "N200")
