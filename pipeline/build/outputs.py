"""Generated JSON families: universe, daily, cum, symbols, market, meta."""

from __future__ import annotations

import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from .. import calendar as cal_mod
from .. import metrics, store
from ..etf import detect_etf
from ..sources.base import parse_dmy_mon
from ..symbols import file_key
from . import columns as C
from .loader import resolve_alias
from .schema import validate

CA_FLAG_KINDS = {"DIVIDEND", "BONUS", "SPLIT", "RIGHTS", "BUYBACK"}


# ---- conversion helpers --------------------------------------------------------------------------------------------

def col_list(s: pd.Series, kind: str, dp: int | None) -> list:
    """Series -> JSON-safe python list (NaN -> None, ints as int, floats rounded)."""
    if kind == "i":
        return s.astype("float64").round().astype("Int64").astype(object).where(s.notna(), None).tolist()
    if kind == "f":
        return s.astype("float64").round(dp if dp is not None else 6).astype(object).where(s.notna(), None).tolist()
    if kind == "b":
        return [bool(x) for x in s.tolist()]
    return s.astype(object).where(s.notna(), None).tolist()


def table(df: pd.DataFrame, cols) -> list[list]:
    return FastTable(df, cols).rows(0, len(df))


class FastTable:
    """Pre-extracts numpy columns once so row blocks can be sliced and converted cheaply (no pandas per slice)."""

    def __init__(self, df: pd.DataFrame, cols):
        self.n = len(df)
        self.parts: list[tuple[str, np.ndarray, np.ndarray | None]] = []
        for name, kind, dp in cols:
            if name not in df.columns:
                self.parts.append(("n", np.empty(self.n, dtype=object), None))
                continue
            s = df[name]
            if kind == "f":
                a = np.round(s.to_numpy(dtype="float64", na_value=np.nan), dp if dp is not None else 6)
                self.parts.append(("f", a, np.isnan(a)))
            elif kind == "i":
                a = s.to_numpy(dtype="float64", na_value=np.nan)
                mask = np.isnan(a)
                self.parts.append(("i", np.where(mask, 0, np.round(a)).astype(np.int64), mask))
            elif kind == "b":
                self.parts.append(("b", s.to_numpy(dtype=bool), None))
            else:
                o = s.astype(object).where(s.notna(), None).to_numpy(dtype=object)
                self.parts.append(("s", o, None))

    def rows(self, a: int, b: int) -> list[list]:
        if b <= a:
            return []
        cols = []
        for kind, arr, mask in self.parts:
            if kind == "n":
                cols.append([None] * (b - a))
            elif kind in ("f", "i"):
                x = arr[a:b].astype(object)
                x[mask[a:b]] = None
                cols.append(x.tolist())
            else:
                cols.append(arr[a:b].tolist())
        return [list(r) for r in zip(*cols)]


_POOL = ThreadPoolExecutor(max_workers=8)  # file creation is I/O bound (slow on Windows); serialisation stays serial
_PENDING: list = []


_DIRS: set[Path] = set()


def _write(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def dump(path: Path, obj: dict) -> int:
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    if path.parent not in _DIRS:  # one mkdir per folder, not one per file
        path.parent.mkdir(parents=True, exist_ok=True)
        _DIRS.add(path.parent)
    _PENDING.append(_POOL.submit(_write, path, text))
    return len(text)


def flush() -> None:
    """Wait for queued writes (re-raises the first write error)."""
    while _PENDING:
        _PENDING.pop().result()


# ---- universe ------------------------------------------------------------------------------------------------------

def mcap_bucket(rank: float, b: dict) -> str | None:
    if rank is None or (isinstance(rank, float) and math.isnan(rank)):
        return None
    if rank <= b["largeMaxRank"]:
        return "L"
    if rank <= b["midMaxRank"]:
        return "M"
    if rank <= b["smallMaxRank"]:
        return "S"
    return "U"


def build_universe_frame(df: pd.DataFrame, days: list[date], settings: dict, mcap_latest: pd.DataFrame | None,
                         mcap_hist: pd.DataFrame, constituents: dict[str, pd.DataFrame], eq_list: pd.DataFrame,
                         isin_latest: dict[str, str], alias: dict[str, str],
                         pr_etf: set[str] | None = None) -> pd.DataFrame:
    T = len(days)
    carry = settings["carryForwardMaxDays"]
    idx_of = {d.isoformat(): i for i, d in enumerate(days)}
    day_idx = df["date"].map(idx_of)
    last_idx = day_idx.groupby(df["sym"]).max()
    has_eq = set(df.loc[df["series"] == "EQ", "sym"])
    syms = sorted(s for s, li in last_idx.items() if s in has_eq and (T - 1 - li) <= carry)
    u = pd.DataFrame({"sym": syms})
    latest = df.groupby("sym", sort=False).tail(1).set_index("sym")  # df is sorted by (sym, date)
    u["lastClose"] = u["sym"].map(latest["close"])

    # market cap: S4 mcap on the latest day; otherwise the most recent issueSize x latest close (flagged)
    mc = pd.Series(dtype=float)
    if mcap_latest is not None:
        m = mcap_latest[mcap_latest["series"].isin(("EQ", "BE", "BZ"))].drop_duplicates("symbol", keep="first")
        if alias:
            m = m.assign(symbol=resolve_alias(m["symbol"], alias)).drop_duplicates("symbol")
        mc = m.set_index("symbol")["mcapRs"]
    u["mcapCr"] = u["sym"].map(mc) / 1e7
    u["mcapEstimated"] = False
    miss = u["mcapCr"].isna()
    if miss.any() and len(mcap_hist):
        h = mcap_hist.copy()
        if alias:
            h["symbol"] = resolve_alias(h["symbol"], alias)
        issue = h.sort_values("date").dropna(subset=["issueSize"]).groupby("symbol").tail(1).set_index("symbol")
        est = u["sym"].map(issue["issueSize"]) * u["lastClose"] / 1e7
        u.loc[miss, "mcapCr"] = est[miss]
        u.loc[miss & est.notna(), "mcapEstimated"] = True
    # ETFs (flagged, DEVIATIONS #32) never take a market-cap rank or bucket, so real companies keep correct ranks
    mcap_syms = set(resolve_alias(mcap_hist["symbol"], alias) if alias else mcap_hist["symbol"])
    if mcap_latest is not None:
        mcap_syms |= set(resolve_alias(mcap_latest["symbol"], alias) if alias else mcap_latest["symbol"])
    eq_syms = sorted(set(u["sym"]) & has_eq)
    etf_syms = detect_etf(eq_syms, pr_etf or set(), set(eq_list["SYMBOL"]) if len(eq_list) else set(), mcap_syms)
    u["etf"] = u["sym"].isin(etf_syms)
    u["mcapRank"] = u["mcapCr"].where(~u["etf"]).rank(ascending=False, method="first")
    u["bucket"] = [mcap_bucket(r, settings["mcapBuckets"]) for r in u["mcapRank"]]

    # sector (TOTALMARKET Industry), index bitmask, names, ISIN, listing date
    sector = {}
    if "TOTALMARKET" in constituents:
        tm = constituents["TOTALMARKET"]
        sector = dict(zip(tm["Symbol"], tm["Industry"]))
    u["sector"] = u["sym"].map(sector).fillna("Unclassified")
    mask = np.zeros(len(u), dtype=np.int64)
    for bit, key in enumerate(C.INDICES):
        if key in constituents:
            mask |= u["sym"].isin(set(constituents[key]["Symbol"])).to_numpy().astype(np.int64) << bit
    u["idx"] = mask
    el = eq_list.set_index("SYMBOL") if len(eq_list) else pd.DataFrame(columns=["NAME OF COMPANY", "ISIN NUMBER",
                                                                              "DATE OF LISTING"])
    u["name"] = u["sym"].map(el["NAME OF COMPANY"]).fillna(u["sym"])
    isin = u["sym"].map(isin_latest)
    u["isin"] = isin.fillna(u["sym"].map(el["ISIN NUMBER"])).fillna("")
    u["listedOn"] = u["sym"].map(el["DATE OF LISTING"]).map(
        lambda x: parse_dmy_mon(x).isoformat() if isinstance(x, str) and parse_dmy_mon(x) else None)
    rev: dict[str, list[str]] = {}
    for old, new in alias.items():
        rev.setdefault(new, []).append(old)
    u["aliases"] = [sorted(rev.get(s, [])) for s in u["sym"]]
    u["f"] = u["sym"].map(file_key)
    return u


# ---- flags ---------------------------------------------------------------------------------------------------------

def detected_adjustments(df: pd.DataFrame, ca_first: str | None, not_splits=None) -> pd.DataFrame:
    """Price adjustments detected from the prices themselves (metrics.adjustment_events) on days
    BEFORE the first stored S4 corporate-action file (`ca_first`), where no corporate-action data exists. Columns sym,
    date (the ex-date), ratio, dayIdx-free. df must be sorted by (sym, date)."""
    sym, dt = df["sym"].to_numpy(dtype=object), df["date"].to_numpy(dtype=object)
    ev, r = metrics.adjustment_events(sym, df["close"].to_numpy(dtype="float64"), dt, not_splits)
    # events the ratio rule would call a split but that are known not to be (a demerger): kept as corporate-action
    # windows, with no adjustment factor (kind DEMERGER, ratio = the observed close ratio, for information only)
    skip = metrics.not_split_mask(sym, dt, not_splits)
    close = df["close"].to_numpy(dtype="float64")
    prev = np.r_[np.nan, close[:-1]]
    kind = np.where(skip, "DEMERGER", "ADJ")
    keep = ev | skip
    if ca_first is not None:
        keep = keep & (dt < ca_first)
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = np.where(skip, close / prev, r)
    return pd.DataFrame({"sym": sym[keep], "date": dt[keep], "ratio": ratio[keep], "kind": kind[keep]})


def own_hl52_breaks(df: pd.DataFrame, n_days: int, window: int = 250, min_obs: int = 200) -> tuple[np.ndarray, np.ndarray]:
    """New 52-week high / low flags from our own split-adjusted prices, for days without an S13 file (before it was
    stored). high(t) (adjusted to the latest basis) above the max adjusted high of the prior `window` trading days;
    needs `window` days of market history before t and `min_obs` of the stock's own days inside the window, else no
    flag. df must be sorted by (sym, date) and carry dayIdx."""
    sym = df["sym"].to_numpy(dtype=object)
    from .. import config

    A = metrics.price_adjustment(sym, df["close"].to_numpy(dtype="float64"), df["date"].to_numpy(dtype=object),
                                 config.settings().get("notSplits", []))
    codes, _ = pd.factorize(sym)
    ti = df["dayIdx"].to_numpy()
    n = int(codes.max()) + 1 if len(codes) else 0
    out = []
    for col, fn in (("high", "max"), ("low", "min")):
        val = df[col].to_numpy(dtype="float64") * A
        M = np.full((n_days, n), np.nan)
        M[ti, codes] = val
        prior = getattr(pd.DataFrame(M).rolling(window, min_periods=min_obs), fn)().shift(1).to_numpy()
        ref = prior[ti, codes]
        with np.errstate(invalid="ignore"):
            brk = (val > ref) if fn == "max" else (val < ref)
        out.append(brk & (ti >= window) & ~np.isnan(ref))
    return out[0], out[1]


def add_flags(df: pd.DataFrame, days: list[date], corp: pd.DataFrame, bands: pd.DataFrame, ban: pd.DataFrame,
              hl: pd.DataFrame, etf: set[str] | frozenset[str] = frozenset(), ca_first: str | None = None) -> pd.DataFrame:
    iso = np.array([d.isoformat() for d in days])
    T = len(iso)
    df = df.copy()
    df["dayIdx"] = np.searchsorted(iso, df["date"].to_numpy())
    flags = np.zeros(len(df), dtype=np.int64)
    flags += np.where(df["series"].isin(("BE", "BZ")), C.FLAG["t2t"], 0)

    # corporate action ex-date within +-2 trading days. From the S4 files where they exist; for the days before the first
    # S4 file, the price-adjustment events detected from the prices (splits/bonuses/rights only: no dividends)
    ca = corp[corp["kind"].isin(CA_FLAG_KINDS)]
    pairs = []
    if len(ca):
        ex_idx = np.searchsorted(iso, ca["exDate"].to_numpy())
        last = days[-1]
        future = ex_idx >= T
        if future.any():
            ex_dates = pd.to_datetime(ca["exDate"]).dt.date.to_numpy()
            near = np.array([(e - last).days <= 3 for e in ex_dates])
            keep = ~future | near
            ca, ex_idx = ca[keep], ex_idx[keep]
        pairs += [pd.DataFrame({"sym": ca["sym"].to_numpy(), "dayIdx": ex_idx + off}) for off in range(-2, 3)]
    has_prices = {"close", "prevClose", "high", "low"} <= set(df.columns)
    from .. import config

    adj = detected_adjustments(df, ca_first, config.settings().get("notSplits", [])) if has_prices else pd.DataFrame(columns=["sym", "date", "ratio"])
    if len(adj):
        ai = np.searchsorted(iso, adj["date"].to_numpy())
        pairs += [pd.DataFrame({"sym": adj["sym"].to_numpy(), "dayIdx": ai + off}) for off in range(-2, 3)]
    if pairs:
        target = pd.MultiIndex.from_frame(pd.concat(pairs, ignore_index=True).drop_duplicates())
        hit = pd.MultiIndex.from_frame(df[["sym", "dayIdx"]]).isin(target)
        flags += np.where(hit, C.FLAG["corpAction"], 0)

    def member(other: pd.DataFrame) -> np.ndarray:
        if other.empty:
            return np.zeros(len(df), dtype=bool)
        return pd.MultiIndex.from_frame(df[["sym", "date"]]).isin(pd.MultiIndex.from_frame(other[["sym", "date"]]))

    flags += np.where(member(bands), C.FLAG["bandHit"], 0)
    flags += np.where(member(ban), C.FLAG["fnoBan"], 0)
    # 52-week high/low: the S13 rule on days with an S13 file; our own adjusted 250-day rule on the days without one
    hi = lo = np.zeros(len(df), dtype=bool)
    if len(hl):
        m = df[["sym", "date", "high", "low"]].merge(hl, on=["sym", "date"], how="left")
        hi, lo = hl52_breaks(m["high"], m["low"], m["high52"], m["low52"])
    has_s13 = df["date"].isin(set(hl["date"])).to_numpy() if len(hl) else np.zeros(len(df), dtype=bool)
    if has_prices and not has_s13.all():
        ohi, olo = own_hl52_breaks(df, T)
        hi, lo = np.where(has_s13, hi, ohi), np.where(has_s13, lo, olo)
    flags += np.where(hi, C.FLAG["high52"], 0) + np.where(lo, C.FLAG["low52"], 0)
    flags += np.where(df["lowLiquidity"], C.FLAG["lowLiquidity"], 0)
    flags += np.where(df["newListing"], C.FLAG["newListing"], 0)
    flags += np.where(df["sym"].isin(etf), C.FLAG["etf"], 0)
    df["flags"] = flags
    return df


def hl52_breaks(high, low, high52, low52) -> tuple[np.ndarray, np.ndarray]:
    """S13 file(T) holds the 52-week high/low through T-1 (its newest high date is T-1), so a new high/low on day T
    is simply high(T) > file(T).high52 or low(T) < file(T).low52. Missing ('-') values never flag."""
    hi = (pd.to_numeric(high) > pd.to_numeric(high52)).fillna(False).to_numpy(dtype=bool)
    lo = (pd.to_numeric(low) < pd.to_numeric(low52)).fillna(False).to_numpy(dtype=bool)
    return hi, lo


# ---- writers -------------------------------------------------------------------------------------------------------

def write_daily(df: pd.DataFrame, days: list[date], out: Path, full_days: int | None = None) -> int:
    """daily/{date}.json. The newest `full_days` trading days carry every column; older days the slim set (07 section 8)."""
    dd = df.sort_values(["date", "sym"], kind="stable")
    bounds = dd["date"].to_numpy()
    full_from = len(days) - full_days if full_days else 0
    ft_full = FastTable(dd, C.DAILY)
    ft_slim = FastTable(dd, C.daily_slim_cols())
    total = 0
    for i, d in enumerate(days):
        iso = d.isoformat()
        a = np.searchsorted(bounds, iso, "left")
        b = np.searchsorted(bounds, iso, "right")
        slim = i < full_from
        doc = {"schemaVersion": 1, "date": iso, "columns": C.DAILY_SLIM if slim else C.names(C.DAILY),
               "rows": (ft_slim if slim else ft_full).rows(a, b)}
        validate("daily_slim" if slim else "daily", doc)
        total += dump(out / "daily" / f"{iso}.json", doc)
        if d == days[-1]:
            dump(out / "daily" / "latest.json", doc)
    return total


def write_cum(df: pd.DataFrame, days: list[date], syms: list[str], carry: int, out: Path, publish_from: int = 0) -> int:
    """cum/{date}.json for every day from index `publish_from` on. The cumulative sums run from the first stored day, so a
    published range difference does not depend on where the published window starts (07 section 8, rolling window)."""
    T, m = len(days), len(syms)
    pos = {s: i for i, s in enumerate(syms)}
    d_idx = {d.isoformat(): i for i, d in enumerate(days)}
    r = df[df["sym"].isin(pos)]
    si = r["sym"].map(pos).to_numpy()
    di = r["date"].map(d_idx).to_numpy()
    traded = np.zeros((T, m), dtype=bool)
    traded[di, si] = True
    close = np.full((T, m), np.nan)
    close[di, si] = r["close"].to_numpy()
    last_close = pd.DataFrame(close).ffill().to_numpy()
    idx_mat = np.where(traded, np.arange(T)[:, None], np.nan)
    last_idx = pd.DataFrame(idx_mat).ffill().to_numpy()

    v = r[r["valid"]].copy()
    vs, vd = v["sym"].map(pos).to_numpy(), v["date"].map(d_idx).to_numpy()
    # delivery value on up days and down days (close above / below prevClose) and trades: the building blocks of
    # delivBalance and avgTradeSize for any range (08 section 5A)
    v["delivValUpCr"] = v["delivValCr"].where(v["close"] > v["prevClose"], 0.0)
    v["delivValDnCr"] = v["delivValCr"].where(v["close"] < v["prevClose"], 0.0)
    mats = {}
    for name, col in (("cDelivValCr", "delivValCr"), ("cTurnoverCr", "turnoverCr"), ("cDelivQty", "delivQty"),
                      ("cVol", "vol"), ("cDelivValUpCr", "delivValUpCr"), ("cDelivValDnCr", "delivValDnCr"),
                      ("cTrades", "trades")):
        a = np.zeros((T, m))
        a[vd, vs] = np.nan_to_num(v[col].to_numpy(dtype="float64", na_value=np.nan))
        mats[name] = np.cumsum(a, axis=0)
    a = np.zeros((T, m))
    a[vd, vs] = 1
    mats["cDays"] = np.cumsum(a, axis=0)
    present = ~np.isnan(last_idx) & ((np.arange(T)[:, None] - last_idx) <= carry)
    sym_arr = np.array(syms, dtype=object)
    iso = np.array([d.isoformat() for d in days], dtype=object)
    total = 0
    for t, d in enumerate(days):
        if t < publish_from:
            continue
        p = present[t]
        ltd = iso[last_idx[t][p].astype(int)]
        frame = pd.DataFrame({
            "sym": sym_arr[p], "lastClose": last_close[t][p], "lastTradeDate": ltd,
            **{k: mats[k][t][p] for k in mats},
        })
        doc = {"schemaVersion": 1, "date": d.isoformat(), "columns": C.names(C.CUM), "rows": table(frame, C.CUM)}
        validate("cum", doc)
        total += dump(out / "cum" / f"{d.isoformat()}.json", doc)
    return total


def write_symbols(df: pd.DataFrame, uni: pd.DataFrame, corp: pd.DataFrame, out: Path, first_date: str | None = None,
                  deals_by_sym: dict | None = None, flow_rows: dict | None = None) -> int:
    ca_by_sym = {s: g for s, g in corp.groupby("sym")}
    total = 0
    ud = uni.set_index("sym")
    dfu = df[df["sym"].isin(ud.index) & ((df["date"] >= first_date) if first_date else True)].sort_values(["sym", "date"], kind="stable").reset_index(drop=True)
    ft = FastTable(dfu, C.SYMBOL_HIST)
    bounds = {s: (int(g.index[0]), int(g.index[-1]) + 1) for s, g in dfu.groupby("sym", sort=False)}
    urec = {r["sym"]: r for r in uni.to_dict("records")}
    for sym in uni["sym"]:
        if sym not in bounds:
            continue
        a, b = bounds[sym]
        u = urec[sym]
        ca = ca_by_sym.get(sym)
        actions = []
        if ca is not None:
            for r in ca.sort_values("exDate").itertuples():
                actions.append({"exDate": r.exDate, "kind": r.kind, "purpose": r.purpose})
        doc = {
            "schemaVersion": 1, "sym": sym, "name": u["name"], "sector": u["sector"], "idx": int(u["idx"]),
            "bucket": u["bucket"] if isinstance(u["bucket"], str) else None, "etf": bool(u["etf"]),
            "columns": C.names(C.SYMBOL_HIST), "rows": ft.rows(a, b),
            "deals": (deals_by_sym or {}).get(sym, []), "corpActions": actions,
            "holdings": {"columns": C.HOLDINGS_COLS, "rows": []},
            "namedHolders": {"columns": C.NAMED_HOLDER_COLS, "rows": []},
            "dealFlows": {"columns": C.DEAL_FLOW_COLS, "rows": (flow_rows or {}).get(sym, [])},
        }
        validate("symbol", doc)
        total += dump(out / "symbols" / f"{u['f']}.json", doc)
    return total


def market_group_members(uni: pd.DataFrame) -> dict[str, set]:
    """Group name -> member symbols (stocks only except ETF, DEVIATIONS #36)."""
    stocks = uni[~uni["etf"]]
    groups: dict[str, set] = {"ALL": set(stocks["sym"])}
    mask = stocks["idx"].to_numpy()
    for bit, key in enumerate(C.INDICES):
        sel = stocks.loc[(mask >> bit) & 1 == 1, "sym"]
        if len(sel):
            groups[f"IDX:{key}"] = set(sel)
    for sec, g in stocks.groupby("sector"):
        groups[f"SEC:{sec}"] = set(g["sym"])
    for b, g in stocks.dropna(subset=["bucket"]).groupby("bucket"):
        groups[f"MC:{b}"] = set(g["sym"])
    if uni["etf"].any():
        groups["ETF"] = set(uni.loc[uni["etf"], "sym"])
    return groups


def market_aggregate(v: pd.DataFrame, groups: dict[str, set], key_col: str, keys: list) -> dict:
    """Per group and per key (a date or a period index): turnover and delivery value sums, value-weighted delivery %,
    median stock delivery %, advances/declines, count of 2x spikes. v: valid rows with sym, turnoverCr, delivValCr,
    delivPct, ret1, isSpike2 and `key_col`."""
    v = v.assign(isAdv=v["ret1"] > 0, isDec=v["ret1"] < 0, isUnch=v["ret1"] == 0)
    out = {}
    for name, members in groups.items():
        by = v[v["sym"].isin(members)].groupby(key_col)
        agg = pd.DataFrame({
            "turnoverCr": by["turnoverCr"].sum(), "delivValCr": by["delivValCr"].sum(),
            "medianDelivPct": by["delivPct"].median(),
            "adv": by["isAdv"].sum(), "dec": by["isDec"].sum(), "unch": by["isUnch"].sum(),
            "spikeCount2x": by["isSpike2"].sum(),
        }).reindex(keys)
        agg["delivPctW"] = agg["delivValCr"] / agg["turnoverCr"].where(agg["turnoverCr"] > 0) * 100
        out[name] = {
            "turnoverCr": col_list(agg["turnoverCr"], "f", 2), "delivValCr": col_list(agg["delivValCr"], "f", 2),
            "delivPctW": col_list(agg["delivPctW"], "f", 2), "medianDelivPct": col_list(agg["medianDelivPct"], "f", 2),
            "adv": col_list(agg["adv"], "i", None), "dec": col_list(agg["dec"], "i", None),
            "unch": col_list(agg["unch"], "i", None), "spikeCount2x": col_list(agg["spikeCount2x"], "i", None),
        }
    return out


def index_close_series(idx_close: pd.DataFrame, dates: list[str]) -> dict:
    out = {}
    for name in C.INDEX_CLOSE_NAMES:
        s = idx_close[idx_close["Index Name"] == name].drop_duplicates("date").set_index("date")["close"]
        out[name] = col_list(s.reindex(dates), "f", 2)
    return out


def build_market(df: pd.DataFrame, days: list[date], uni: pd.DataFrame, idx_close: pd.DataFrame) -> dict:
    iso = [d.isoformat() for d in days]
    v = df[df["valid"] & df["sym"].isin(set(uni["sym"]))].copy()
    v["isSpike2"] = (v["spike"] >= 2) & ~v["lowLiquidity"] & ~v["newListing"]
    groups = market_group_members(uni)
    return {"schemaVersion": 1, "dates": iso, "groups": market_aggregate(v, groups, "date", iso),
            "indexClose": index_close_series(idx_close, iso)}


def build_split_bonus(corp: pd.DataFrame, adj: pd.DataFrame | None = None) -> dict:
    """Split and bonus ex-dates, for the range view's corporate-action warning (DEVIATIONS #39). Days before the first
    stored S4 file have no corporate-action data: there the price-adjustment events detected from the prices stand in
    (kind ADJ, "split or bonus, detected from the prices")."""
    c = corp[corp["kind"].isin(("SPLIT", "BONUS"))]
    rows = [[r.sym, r.exDate, r.kind, r.purpose] for r in c.itertuples()]
    if adj is not None and len(adj):
        rows += [[r.sym, r.date, "DEMERGER", f"Demerger: the price fell to {r.ratio:.2g}x in a day; not a split, so "
                  "prices are not adjusted"] if r.kind == "DEMERGER" else
                 [r.sym, r.date, "ADJ", f"Price adjusted by {r.ratio:.4g}x (split or bonus, detected from the prices)"]
                 for r in adj.itertuples()]
    rows.sort(key=lambda r: (r[1], r[0]))
    return {"schemaVersion": 1, "columns": ["sym", "exDate", "kind", "purpose"], "rows": rows}


def source_status(days: list[date], root: Path | None = None) -> dict:
    spec = {"cm_delivery": ("cm_delivery", "csv.gz"), "cm_udiff": ("cm_isin", "csv.gz"), "pr_zip": ("mcap", "csv.gz"),
            "indices_close": ("indices_close", "csv.gz"), "hl52": ("hl52", "csv.gz"), "fo_ban": ("fo_ban", "txt")}
    out = {}
    for key, (kind, ext) in spec.items():
        have = set(store.list_dates(kind, ext, root=root))
        mine = sorted(have & set(days))
        first = min(have) if have else None
        # a source that starts later than the 3-year S1/S12 history has no gaps before its first stored day
        out[key] = {"latest": mine[-1].isoformat() if mine else None,
                    "gaps": [d.isoformat() for d in days if d not in have and first is not None and d >= first]}
    base = root or store.STORE_DIR
    s8 = sorted(json.loads(ln)["date"] for f in (base / "fii_dii_cash").glob("*.jsonl")
                for ln in f.read_text(encoding="utf-8").splitlines() if ln.strip())
    if s8:
        since = s8[0]
        out["fii_dii_cash"] = {"latest": s8[-1], "collectingSince": since,
                               "gaps": [d.isoformat() for d in days if d.isoformat() >= since
                                        and d.isoformat() not in s8]}
    deal_dates = sorted({r for f in (base / "deals").glob("*.csv")
                         for r in pd.read_csv(f, dtype=str, usecols=["date"])["date"]})
    if deal_dates:
        out["deals"] = {"latest": deal_dates[-1], "gaps": [], "collectingSince": deal_dates[0]}
    return out


def build_meta(days: list[date], uni: pd.DataFrame, asof: str | None, settings: dict, root: Path | None = None,
               store_first: str | None = None) -> dict:
    full = settings.get("publish", {}).get("dailyFullTradingDays", len(days))
    sectors = sorted(s for s in uni["sector"].unique() if s != "Unclassified")
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(cal_mod.IST).isoformat(timespec="seconds"),
        "latestDate": days[-1].isoformat(), "firstDate": days[0].isoformat(),
        "tradingDays": [d.isoformat() for d in days],
        "indices": C.INDICES, "sectors": sectors, "constituentsAsOf": asof,
        "sources": source_status(days, root),
        "settings": {"minTurnoverAvg20Cr": settings["liquidity"]["minTurnoverAvg20Cr"],
                     "minBaseDelivValCr": settings["liquidity"]["minBaseDelivValCr"]},
        # daily/ files of days before dailyFullFrom carry only dailySlimColumns (07 section 8)
        "publish": {"dailyFullTradingDays": full, "dailyFullFrom": days[max(0, len(days) - full)].isoformat(),
                    "dailySlimColumns": C.DAILY_SLIM,
                    "historyTradingDays": settings.get("publish", {}).get("historyTradingDays"),
                    "storeFirstDate": store_first or days[0].isoformat()},
    }
