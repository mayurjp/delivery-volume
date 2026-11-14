"""Prototype: what did delivery/volume footprints look like before and during big price runs?

Usage: python -I run_footprints.py <project root> [extra history root ...] [--json <out.json>]
Reads raw S1 files from store/cm_delivery (read-only). Universe = top 750 by current mcap (no ETFs: not in mcap file).
Prices are back-adjusted with the pipeline's ratio rule (pipeline/metrics.price_adjustment, DEVIATIONS #52, #71, #139):
close-to-close ratios that match a corporate-action ratio, with the notSplits list of config/settings.json respected.
The earlier prevClose rule (|prevClose(t)/close(t-1) - 1| > 3%) missed most splits, because NSE's PREV_CLOSE is raw on
an ex-date.
Runs: zig-zag on adjusted close, 12% reversal; a run is a leg of >= 20% (up or down) lasting >= 5 days.
Footprint windows for a run starting at pivot day p:  pre = [p-19, p], base = [p-79, p-20], early = [p+1, p+5].
Features are value-based (split-safe): delivery value, turnover, avg trade size, delivery on up vs down days.
Part B (no hindsight): for every stock-day, features over the last 20 days vs the 60 before; outcome = return from
close(s) to close(s+20) >= +15% ("big up") or <= -15% ("big down"). Lift by feature quintile.
"""
import gzip
import io
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3]))  # the project root: the pipeline's adjustment rule is shared, not copied
from pipeline import metrics  # noqa: E402
from pipeline.build import loader  # noqa: E402  (the build's symbol aliases, DEVIATIONS #70 and #128)

args = sys.argv[1:]
JSON_OUT = None
if "--json" in args:
    i = args.index("--json")
    JSON_OUT = Path(args[i + 1])
    del args[i:i + 2]
root = Path(args[0])
frames = []
extra = [Path(x) for x in args[1:]]              # optional extra history roots (e.g. .history_staging)
srcs = sorted({f.name: f for d in [root / "store"] + extra for f in (d / "cm_delivery").rglob("*.csv.gz")}.values(),
              key=lambda f: f.name)
for f in srcs:
    df = pd.read_csv(io.BytesIO(gzip.decompress(f.read_bytes())), skipinitialspace=True, dtype=str)
    df.columns = [c.strip() for c in df.columns]
    df = df[df["SERIES"].str.strip() == "EQ"]
    df = df[["SYMBOL", "PREV_CLOSE", "CLOSE_PRICE", "AVG_PRICE", "TURNOVER_LACS", "NO_OF_TRADES", "DELIV_QTY"]]
    df = df.apply(lambda c: c.str.strip())
    df["date"] = f.name[:10]
    frames.append(df)
raw = pd.concat(frames, ignore_index=True)
# renamed symbols: the build maps history under an old name to today's name (S17 and ISIN, dated); without this the
# old-name history of a renamed stock is lost, because only today's name is in the top 750 (DEVIATIONS #139)
raw["SYMBOL"] = loader.resolve_alias(raw["SYMBOL"], loader.load_alias_map(root), raw["date"]).to_numpy()
for c in ["PREV_CLOSE", "CLOSE_PRICE", "AVG_PRICE", "TURNOVER_LACS", "NO_OF_TRADES", "DELIV_QTY"]:
    raw[c] = pd.to_numeric(raw[c], errors="coerce")

mc = pd.read_csv(io.BytesIO(gzip.decompress(sorted((root / "store/mcap").rglob("*.csv.gz"))[-1].read_bytes())))
mc = mc[mc["series"].astype(str).str.strip() == "EQ"].copy()
mc["rank"] = mc["mcapRs"].rank(ascending=False)
rank = dict(zip(mc["symbol"].str.strip(), mc["rank"]))
raw = raw[raw["SYMBOL"].map(lambda s: rank.get(s, 1e9)) <= 750]

days = sorted(raw["date"].unique())
syms = sorted(raw["SYMBOL"].unique())
T, N = len(days), len(syms)
ti = raw["date"].map({d: i for i, d in enumerate(days)}).to_numpy()
sj = raw["SYMBOL"].map({s: i for i, s in enumerate(syms)}).to_numpy()


def mat(col):
    m = np.full((T, N), np.nan)
    m[ti, sj] = raw[col].to_numpy()
    return m


close, prev, vwap = mat("CLOSE_PRICE"), mat("PREV_CLOSE"), mat("AVG_PRICE")
tv = mat("TURNOVER_LACS") / 100.0                      # Rs Cr
trades, dq = mat("NO_OF_TRADES"), mat("DELIV_QTY")
dv = dq * vwap / 1e7                                     # Rs Cr
ats = tv * 1e7 / trades                                  # Rs per trade

# split/bonus back-adjustment: the pipeline's ratio rule (metrics.price_adjustment) on each stock's EQ rows, in date order;
# the adjusted close is then forward-filled over days the stock did not trade (its factor is constant between its rows)
not_splits = json.loads((root / "config/settings.json").read_text(encoding="utf-8")).get("notSplits", [])
ordr = raw.assign(_si=sj, _ti=ti).sort_values(["SYMBOL", "date"], kind="stable")
fac_rows = metrics.price_adjustment(ordr["SYMBOL"].to_numpy(dtype=object), ordr["CLOSE_PRICE"].to_numpy(float),
                                    ordr["date"].to_numpy(dtype=object), not_splits)
adj_m = np.full((T, N), np.nan)
adj_m[ordr["_ti"].to_numpy(), ordr["_si"].to_numpy()] = ordr["CLOSE_PRICE"].to_numpy(float) * fac_rows
adj = pd.DataFrame(adj_m).ffill().to_numpy()
c_ff = pd.DataFrame(close).ffill().to_numpy()
ret = np.vstack([np.full((1, N), np.nan), adj[1:] / adj[:-1] - 1])
ret = np.where(np.isfinite(close), ret, np.nan)          # only real trading days count

valid = np.isfinite(dv) & np.isfinite(tv) & (tv > 0)
z = lambda a: np.where(valid, np.nan_to_num(a), 0.0)
P = lambda a: np.vstack([np.zeros((1, N)), np.cumsum(a, axis=0)])
Pdv, Ptv, Pn, Pats = P(z(dv)), P(z(tv)), P(valid.astype(float)), P(z(ats))
Pup, Pdn = P(z(dv) * (np.nan_to_num(ret) > 0)), P(z(dv) * (np.nan_to_num(ret) < 0))
# daily spike flag vs prior-20 mean
m20 = (Pdv[20:-1] - Pdv[:-21]) / np.maximum(Pn[20:-1] - Pn[:-21], 1)
spk = np.zeros((T, N))
spk[20:] = (z(dv)[20:] >= 2 * m20) & (m20 > 0)
Pspk = P(spk)


def win(a, b, c, d, min1, min0):
    """Window [a,b] vs base [c,d] (inclusive indices). Returns (features over N, ok mask)."""
    n1, n0 = Pn[b + 1] - Pn[a], Pn[d + 1] - Pn[c]
    s1 = lambda Pm: Pm[b + 1] - Pm[a]
    s0 = lambda Pm: Pm[d + 1] - Pm[c]
    with np.errstate(divide="ignore", invalid="ignore"):
        dv1, dv0 = s1(Pdv) / np.maximum(n1, 1), s0(Pdv) / np.maximum(n0, 1)
        tv1, tv0 = s1(Ptv) / np.maximum(n1, 1), s0(Ptv) / np.maximum(n0, 1)
        out = {
            "Delivery value vs before (x)": dv1 / dv0,
            "Delivery % change (pp)": (s1(Pdv) / s1(Ptv) - s0(Pdv) / s0(Ptv)) * 100,
            "Turnover vs before (x)": tv1 / tv0,
            "Avg trade size vs before (x)": (s1(Pats) / np.maximum(n1, 1)) / (s0(Pats) / np.maximum(n0, 1)),
            "Delivery on up days / down days (x)": s1(Pup) / np.maximum(s1(Pdn), 1e-9),
            "Delivery-spike days (of 20)": s1(Pspk),
            "Price change over the window (%)": (adj[b] / adj[max(a - 1, 0)] - 1) * 100,
        }
    ok = (n1 >= min1) & (n0 >= min0) & (tv0 >= 2.0) & (dv0 > 0)
    return {k: np.where(ok, v, np.nan) for k, v in out.items()}, ok


def feats(s_end):
    """pre = [s-19, s] vs base = [s-79, s-20]"""
    return win(s_end - 19, s_end, s_end - 79, s_end - 20, 15, 45)


def early(s0):
    """first 5 days of the run [s0+1, s0+5] vs the same base as feats(s0)"""
    return win(s0 + 1, s0 + 5, s0 - 79, s0 - 20, 4, 45)


# ---------- Part A: zig-zag runs ----------
runs = []
for j in range(N):
    p = adj[:, j]
    idx = np.where(np.isfinite(p))[0]
    if len(idx) < 150:
        continue
    piv, d, ext_i = [idx[0]], 0, idx[0]
    for i in idx[1:]:
        if d >= 0 and p[i] >= p[ext_i] or d <= 0 and p[i] <= p[ext_i]:
            ext_i = i if (d != 0 or p[i] != p[piv[-1]]) else ext_i
        if d == 0:
            if p[i] >= p[piv[-1]] * 1.12:
                d, ext_i = 1, i
            elif p[i] <= p[piv[-1]] * 0.88:
                d, ext_i = -1, i
            continue
        if d == 1 and p[i] >= p[ext_i]:
            ext_i = i
        elif d == -1 and p[i] <= p[ext_i]:
            ext_i = i
        if d == 1 and p[i] <= p[ext_i] * 0.88:
            piv.append(ext_i); d, ext_i = -1, i
        elif d == -1 and p[i] >= p[ext_i] * 1.12:
            piv.append(ext_i); d, ext_i = 1, i
    piv.append(ext_i)
    for s0, e0 in zip(piv[:-1], piv[1:]):
        mv = p[e0] / p[s0] - 1
        if abs(mv) >= 0.20 and e0 - s0 >= 5 and s0 >= 79 and s0 + 5 < T:
            runs.append((j, s0, e0, mv))
runs = pd.DataFrame(runs, columns=["j", "s", "e", "move"])
runs["dir"] = np.where(runs["move"] > 0, "UP", "DOWN")

rows = []
for r in runs.itertuples():
    f, ok = feats(r.s)
    if not ok[r.j]:
        continue
    pre = {k: v[r.j] for k, v in f.items()}
    # early window: first 5 days of the run vs the same base
    fe, _ = early(r.s)
    early_v = {k: fe[k][r.j] for k in ("Delivery value vs before (x)", "Delivery on up days / down days (x)",
                                     "Avg trade size vs before (x)", "Delivery % change (pp)", "Price change over the window (%)")}
    rows.append({"dir": r.dir, "sym": syms[r.j], "start": days[r.s], "end": days[r.e], "move": r.move * 100,
                 **{"pre: " + k: v for k, v in pre.items()}, **{"early: " + k: v for k, v in early_v.items()}})
R = pd.DataFrame(rows)

# baseline: all eligible stock-days (pre window ending at s)
base_rows = []
for s in range(79, T - 20, 3):
    f, ok = feats(s)
    df = pd.DataFrame({k: v[ok] for k, v in f.items()})
    base_rows.append(df)
B = pd.concat(base_rows, ignore_index=True)

print(f"days={T} ({days[0]}..{days[-1]}) stocks={N}  runs found: UP={int((R.dir == 'UP').sum())} "
      f"DOWN={int((R.dir == 'DOWN').sum())} (moves >=20%, 12% zig-zag; starts from {days[79]})")
print("\nA) Median footprint: 20 days BEFORE the run started, and the first 5 days OF the run (vs the 60 days before)")
print(f"  {'feature':42s} {'UP runs':>10s} {'DOWN runs':>10s} {'ordinary':>10s}")
for k in B.columns:
    print(f"  pre   {k:36s} {R.loc[R.dir == 'UP', 'pre: ' + k].median():10.2f} "
          f"{R.loc[R.dir == 'DOWN', 'pre: ' + k].median():10.2f} {B[k].median():10.2f}")
for k in ("Delivery value vs before (x)", "Delivery on up days / down days (x)", "Avg trade size vs before (x)",
          "Delivery % change (pp)", "Price change over the window (%)"):
    print(f"  early {k:36s} {R.loc[R.dir == 'UP', 'early: ' + k].median():10.2f} "
          f"{R.loc[R.dir == 'DOWN', 'early: ' + k].median():10.2f} {B[k].median():10.2f}")

# ---------- Part B: lift (no hindsight) ----------
recs = []
for s in range(79, T - 21):
    f, ok = feats(s)
    fwd = adj[s + 21] / adj[s + 1] - 1      # enter close(s+1): data for day s is published after its close
    df = pd.DataFrame({k: v[ok] for k, v in f.items()})
    df["fwd"] = fwd[ok] * 100
    recs.append(df)
L = pd.concat(recs, ignore_index=True).dropna()
bu, bd = (L["fwd"] >= 15).mean() * 100, (L["fwd"] <= -15).mean() * 100
print(f"\nB) Next 20 days (entry next close): base rate big UP (>=+15%) = {bu:.1f}%, big DOWN (<=-15%) = {bd:.1f}%  "
      f"(n={len(L)} stock-days)")
print("   chance of a big UP / big DOWN move by feature quintile (Q1 = lowest, Q5 = highest)")
for k in [c for c in L.columns if c != "fwd"]:
    q = pd.qcut(L[k].rank(method="first"), 5, labels=False)
    up = L.groupby(q)["fwd"].apply(lambda x: (x >= 15).mean() * 100)
    dn = L.groupby(q)["fwd"].apply(lambda x: (x <= -15).mean() * 100)
    print(f"  {k:38s} UP  " + " ".join(f"{v:5.1f}" for v in up) + "   | DOWN " + " ".join(f"{v:5.1f}" for v in dn))

# ---------- example: biggest up-run in the top 200 ----------
R["rank"] = R["sym"].map(rank)
ex = R[(R["dir"] == "UP") & (R["rank"] <= 200)].sort_values("move", ascending=False).head(3)
print("\nC) Biggest up-runs among the top 200 stocks, with their footprint")
cols = ["sym", "start", "end", "move", "pre: Delivery value vs before (x)", "pre: Delivery on up days / down days (x)",
        "pre: Avg trade size vs before (x)", "early: Delivery value vs before (x)", "early: Delivery on up days / down days (x)"]
print(ex[cols].round(2).to_string(index=False))

# ---------- JSON for the replication test (pipeline/tests/test_run_footprints.py, DEVIATIONS #139) ----------
if JSON_OUT is not None:
    names = {"Delivery value vs before (x)": "delivValRatio", "Delivery % change (pp)": "delivPctChgPp",
             "Turnover vs before (x)": "turnoverRatio", "Avg trade size vs before (x)": "tradeSizeRatio",
             "Delivery on up days / down days (x)": "delivBalance", "Delivery-spike days (of 20)": "spikeDays",
             "Price change over the window (%)": "priceChgPct"}
    doc = {"runList": [[r.sym, r.dir, r.start, r.end] for r in R.itertuples()],
           "runs": {"UP": int((R.dir == "UP").sum()), "DOWN": int((R.dir == "DOWN").sum())},
           "pre": {}, "early": {}, "lift": {}, "base": {"n": int(len(L)), "bigUp": round(bu, 2), "bigDown": round(bd, 2)}}
    for k, nm in names.items():
        doc["pre"][nm] = {"UP": float(R.loc[R.dir == "UP", "pre: " + k].median()),
                          "DOWN": float(R.loc[R.dir == "DOWN", "pre: " + k].median()),
                          "ORDINARY": float(B[k].median())}
        if "early: " + k in R.columns:
            doc["early"][nm] = {"UP": float(R.loc[R.dir == "UP", "early: " + k].median()),
                                "DOWN": float(R.loc[R.dir == "DOWN", "early: " + k].median())}
        q = pd.qcut(L[k].rank(method="first"), 5, labels=False)
        up = L.groupby(q)["fwd"].apply(lambda x: (x >= 15).mean() * 100)
        dn = L.groupby(q)["fwd"].apply(lambda x: (x <= -15).mean() * 100)
        doc["lift"][nm] = [[round(float(up.iloc[i]), 2), round(float(dn.iloc[i]), 2)] for i in range(5)]
    JSON_OUT.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    print(f"json written: {JSON_OUT}")

