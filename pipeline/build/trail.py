"""Smart Money Trail v1 in `build` (docs/specs/07-run-forensics.md section 6A): trail/latest.json, month-end as-of snapshots
trail/asof/{date}.json and stats/trail_perf.json (the track record per list and per indicator)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .. import trail as T
from . import columns as C
from . import outputs, signal_perf
from .schema import validate

LISTS = [("strongA", "Strongest accumulation trail"), ("strongD", "Strongest distribution trail"),
         ("flip", "Taste changing (any flip)"), ("flipAD", "Flip, accumulation to distribution"),
         ("flipDA", "Flip, distribution to accumulation")]
IND_LABELS = {"delivBal": "Delivery balance (up days vs down days)", "delivPctTrend": "Delivery % trend vs own baseline",
              "tradeSizeTrend": "Average trade size trend", "spikePersist": "Delivery spike persistence"}
SLOTS = [{"id": "namedDeals", "label": "Named bulk/block deals (FII + DII net)", "arrives": "Phase 4"},
         {"id": "holdings", "label": "Holdings change (FII, DII, MF)", "arrives": "Phase 4B"},
         {"id": "promoter", "label": "Promoter holdings change", "arrives": "Phase 4B"},
         {"id": "fnoOi", "label": "F&O open interest with price", "arrives": "Phase 5"}]
CONFIG_KEYS = ["windows", "baselineDays", "minBaselineDays", "minWindowFraction", "delivBal", "delivPctTrendPp",
               "tradeSizeTrendPct", "spike", "weekDays", "weekMargin", "flipDays", "flipMinIndicators", "stripWeeks",
               "listSize", "persistent"]
LABEL = ("Evidence summary, not advice. You decide. Historical, one sample period, today's index membership "
         "(survivorship bias), before costs. Not a prediction.")


def indicator_defs(cfg: dict) -> list[dict]:
    sp = cfg["spike"]
    rule = {
        "delivBal": f"A above {cfg['delivBal']['aboveA']}, D below {cfg['delivBal']['belowD']}",
        "delivPctTrend": f"A above +{cfg['delivPctTrendPp']} pp, D below -{cfg['delivPctTrendPp']} pp",
        "tradeSizeTrend": f"A above +{cfg['tradeSizeTrendPct']}%, D below -{cfg['tradeSizeTrendPct']}%",
        "spikePersist": (f"persistent when at least {sp['minDays']} spike days and a spike-day rate at least "
                         f"{sp['rateMult']}x the baseline; A when spike days on up days are at least {sp['upDownMult']}x "
                         "those on down days, D for the reverse"),
    }
    return [{"id": i, "label": IND_LABELS[i], "rule": rule[i]} for i in T.INDICATORS]


def _round_inputs(df: pd.DataFrame) -> dict:
    """The published (rounded) values the browser twin sees."""
    f = lambda c, dp: np.round(df[c].to_numpy(dtype="float64", na_value=np.nan), dp)  # noqa: E731
    return {"close": f("close", 2), "prev": f("prevClose", 2), "dval": f("delivValCr", 2), "turn": f("turnoverCr", 2),
            "trades": df["trades"].to_numpy(dtype="float64", na_value=np.nan),
            "spike": f("spike", 3), "delivq": df["delivQty"].to_numpy(dtype="float64", na_value=np.nan),
            "vol": df["vol"].to_numpy(dtype="float64", na_value=np.nan)}


class TrailInputs:
    """Matrices for one build: cumulative sums, the close matrix and the symbol index."""

    def __init__(self, df: pd.DataFrame, days: list[str], syms: list[str]):
        self.days, self.syms = days, syms
        Td, S = len(days), len(syms)
        d = df[df["sym"].isin(set(syms))]
        pos = {s: i for i, s in enumerate(syms)}
        tix = {x: i for i, x in enumerate(days)}
        ti = d["date"].map(tix).to_numpy()
        sj = d["sym"].map(pos).to_numpy()
        v = _round_inputs(d)
        el = T.eligible(d["series"].to_numpy(dtype=object), v["delivq"], v["vol"], v["trades"], d["flags"].to_numpy())
        self.cs = T.build_cums(ti, sj, Td, S, v["close"], v["prev"], v["dval"], v["turn"], v["trades"], v["spike"], el)
        close = np.full((Td, S), np.nan)
        prev = np.full((Td, S), np.nan)
        close[ti, sj] = d["close"].to_numpy(dtype="float64")
        prev[ti, sj] = d["prevClose"].to_numpy(dtype="float64")
        self.close = close
        adj = signal_perf.adjustment_matrix(close, prev)
        self.adj_cum = np.cumsum(np.nan_to_num(adj, nan=0).astype(int), axis=0)


def month_ends(days: list[str]) -> list[int]:
    return [i for i in range(len(days)) if i == len(days) - 1 or days[i][:7] != days[i + 1][:7]]


def first_asof_index(cfg: dict) -> int:
    """The first as-of with a full 3M window plus baseline."""
    return cfg["windows"]["3M"]["days"] + cfg["baselineDays"] - 1


def _doc(cfg: dict, snap: dict, extra: dict | None = None) -> dict:
    return {"schemaVersion": 1, "asOf": snap["asOf"], "stripWeeks": snap["stripWeeks"],
            "windows": list(cfg["windows"]), "windowDays": [w["days"] for w in cfg["windows"].values()],
            "windowColumns": T.WINDOW_COLS, "indicators": indicator_defs(cfg), "slots": SLOTS,
            "listSize": cfg["listSize"], "label": LABEL, "columns": ["sym", "strip", *cfg["windows"]],
            "config": {k: cfg[k] for k in CONFIG_KEYS},
            "rows": snap["rows"], **(extra or {})}


def forward_excess(inp: TrailInputs, a: int, k: int, universe: np.ndarray) -> np.ndarray:
    """Forward k-day return from close(a+1), minus the universe median; NaN outside the universe, for missing prices and for
    windows crossing a price adjustment (DEVIATIONS #53)."""
    Td = inp.close.shape[0]
    e, x = a + 1, a + 1 + k
    out = np.full(inp.close.shape[1], np.nan)
    if x > Td - 1:
        return out
    with np.errstate(invalid="ignore", divide="ignore"):
        r = (inp.close[x] / inp.close[e] - 1) * 100
    clean = inp.adj_cum[x] == inp.adj_cum[a]
    r = np.where(clean & universe, r, np.nan)
    med = np.nanmedian(r) if np.isfinite(r).any() else np.nan
    return r - med


def rank_list(tl: dict, cons: np.ndarray, member: np.ndarray, syms: np.ndarray, key: str, size: int) -> np.ndarray:
    """Indexes of the strongest list: members leaning `key` (A or D) ranked by that count, then consistency, then symbol."""
    other = "D" if key == "A" else "A"
    ok = member & (tl[key] >= 2) & (tl[key] > tl[other])
    idx = np.flatnonzero(ok)
    if not len(idx):
        return idx
    order = np.lexsort((syms[idx], -np.nan_to_num(cons[idx], nan=-1), -tl[key][idx]))
    return idx[order][:size]


def track_record(inp: TrailInputs, ind_w: dict, points: np.ndarray, uni_mask: np.ndarray, cfg: dict) -> dict:
    days = inp.days
    syms = np.array(inp.syms, dtype=object)
    pools: dict[tuple, list[np.ndarray]] = {}
    dates: dict[tuple, set] = {}

    def add(key: tuple, ex: np.ndarray, member: np.ndarray, a: int) -> None:
        x = ex[member]
        x = x[~np.isnan(x)]
        if len(x):
            pools.setdefault(key, []).append(x)
            dates.setdefault(key, set()).add(a)

    as_of = [a for a in month_ends(days) if a >= first_asof_index(cfg)]
    used = []
    for a in as_of:
        strip, sdates = T.strip_codes(ind_w, points, days, a, cfg)
        elig = inp.cs["_elig"][a]
        U = elig & uni_mask
        if not U.any():
            continue
        any_fwd = False
        for wname in cfg["windows"]:
            wm = T.window_metrics(inp.cs, a, strip, sdates, wname, cfg)
            members = {
                "strongA": np.zeros(len(syms), bool), "strongD": np.zeros(len(syms), bool),
                "flip": U & (wm["flip"] != ""), "flipAD": U & (wm["flip"] == "A→D"), "flipDA": U & (wm["flip"] == "D→A")}
            members["strongA"][rank_list(wm["tally"], wm["consA"], U, syms, "A", cfg["listSize"])] = True
            members["strongD"][rank_list(wm["tally"], wm["consD"], U, syms, "D", cfg["listSize"])] = True
            for k in cfg["forwardHorizons"]:
                ex = forward_excess(inp, a, k, U)
                if np.isnan(ex).all():
                    continue
                any_fwd = True
                for lid, m in members.items():
                    add(("list", lid, wname, k), ex, m, a)
                for j, ind in enumerate(T.INDICATORS):
                    c = wm["codes"][:, j]
                    for code, ch in ((1, "A"), (-1, "D"), (0, "N")):
                        add(("indicator", f"{ind}:{ch}", wname, k), ex, U & (c == code), a)
        if any_fwd:
            used.append(days[a])
    rows = []
    for kind, ids in (("list", [i for i, _ in LISTS]),
                      ("indicator", [f"{i}:{c}" for i in T.INDICATORS for c in "ADN"])):
        for iid in ids:
            for wname in cfg["windows"]:
                for k in cfg["forwardHorizons"]:
                    key = (kind, iid, wname, k)
                    if key not in pools:
                        rows.append([kind, iid, wname, k, 0, 0, None, None, None])
                        continue
                    x = np.concatenate(pools[key])
                    rows.append([kind, iid, wname, k, int(len(x)), len(dates[key]), round(float(np.median(x)), 3),
                                 round(float(x.mean()), 3), round(float((x > 0).mean() * 100), 1)])
    return {"schemaVersion": 1, "asOf": days[-1], "universe": cfg["trackUniverse"], "windows": list(cfg["windows"]),
            "horizons": list(cfg["forwardHorizons"]), "asOfDates": used, "minN": cfg["minN"],
            "listSize": cfg["listSize"],
            "lists": [{"id": i, "label": lab} for i, lab in LISTS],
            "indicators": [{"id": i, "label": IND_LABELS[i]} for i in T.INDICATORS], "label": LABEL,
            "columns": ["kind", "id", "window", "horizon", "n", "dates", "medianExcess", "meanExcess", "hitRate"],
            "rows": rows}


def write_trail(df: pd.DataFrame, days: list[str], uni: pd.DataFrame, signals: dict, out: Path, pub_first: str,
                n500_bit: int) -> tuple[int, dict]:
    cfg = T.trail_cfg(signals)
    ud = uni.set_index("sym")
    syms = sorted(set(df["sym"]) & set(ud.index))
    inp = TrailInputs(df, days, syms)
    idx = ud.loc[syms, "idx"].to_numpy(dtype=np.int64)
    n500 = (idx >> n500_bit) & 1 == 1
    any_index = idx != 0
    Td = len(days)
    as_ofs = [a for a in month_ends(days) if a >= first_asof_index(cfg) and a < Td - 1]
    ind_w, points = T.weekly_codes(inp.cs, days, cfg, [*as_ofs, Td - 1])
    total = 0
    snap, _, _ = T.snapshot(inp.cs, days, Td - 1, ind_w, points, cfg, syms)
    published = [days[a] for a in as_ofs if days[a] >= pub_first]
    doc = _doc(cfg, snap, {"eligible": len(snap["rows"]), "snapshots": published})
    validate("trail", doc)
    total += outputs.dump(out / "trail" / "latest.json", doc)
    n_asof = 0
    for a in as_ofs:
        if days[a] < pub_first:
            continue  # snapshots of days that rolled out of the published window are not written
        snap, _, _ = T.snapshot(inp.cs, days, a, ind_w, points, cfg, syms, keep=any_index)
        d = _doc(cfg, snap, {"survivorship": "Index membership is today's, so delisted and removed stocks are missing."})
        validate("trail", d)
        total += outputs.dump(out / "trail" / "asof" / f"{days[a]}.json", d)
        n_asof += 1
    perf = track_record(inp, ind_w, points, n500, cfg)
    validate("trail_perf", perf)
    total += outputs.dump(out / "stats" / "trail_perf.json", perf)
    return total, {"asOf": n_asof, "eligible": len(doc["rows"])}


__all__ = ["write_trail", "C"]
