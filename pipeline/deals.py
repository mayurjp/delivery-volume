"""Bulk and block deals -> deal rows, round trips, per-stock category flows and entity totals (docs/specs/03 5.8,
04 5.3). Pure functions over DataFrames: the build and the tests call the same code.

Units: values in Rs Crore, rounded to 2 dp per deal row. Flows and totals are sums of those rounded row values, so
`deals/flows.json` agrees with the deal rows to the paisa (tested). Round trips are excluded from flows and from entity
buy/sell/net totals, but stay in the deal rows (roundTrip = true).
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from .entities import EntityIndex, is_round_trip
from .sources.base import parse_dmy_mon

DEAL_COLS = ["date", "type", "sym", "client", "entityId", "entityName", "entityType", "entityCategory",
             "entityTypeInferred", "side", "qty", "price", "valueCr", "roundTrip"]
FLOW_COLS = ["date", "sym", "category", "buyValueCr", "sellValueCr", "netValueCr"]
ENTITY_COLS = ["entityId", "entityName", "entityType", "entityCategory", "aliases", "dealCount", "buyValueCr",
               "sellValueCr", "netValueCr", "firstDate", "lastDate", "topSymbols"]
RAW_COLS = ["date", "type", "symbol", "securityName", "client", "side", "qty", "price", "remarks"]
SIDES = ("BUY", "SELL")


_ISO = re.compile(r"\d{4}-\d{2}-\d{2}")


def _iso(x: str) -> str:
    """ISO date as stored in deals/YYYY.csv, or NSE's 13-NOV-2026 form; '' when neither parses."""
    s = str(x).strip()
    if _ISO.fullmatch(s):
        return s
    d = parse_dmy_mon(s)
    return d.isoformat() if d else ""


def load_raw(frames: list[pd.DataFrame]) -> pd.DataFrame:
    """Concatenate store/deals/YYYY.csv frames (strings as stored) and parse them. Bad rows are dropped."""
    df = pd.concat([f[RAW_COLS] for f in frames], ignore_index=True) if frames else pd.DataFrame(columns=RAW_COLS)
    df["qty"] = pd.to_numeric(df["qty"], errors="coerce")
    df["price"] = pd.to_numeric(df["price"], errors="coerce")
    df["side"] = df["side"].astype(str).str.strip().str.upper()
    df["client"] = df["client"].astype(str).str.strip()
    df["symbol"] = df["symbol"].astype(str).str.strip()
    df = df[df["qty"].notna() & df["price"].notna() & df["side"].isin(SIDES) & (df["qty"] > 0)]
    return df.reset_index(drop=True)


def build_deals(raw: pd.DataFrame, index: EntityIndex, eq_syms: set[str] | None = None, resolve=None) -> pd.DataFrame:
    """One row per stored deal row (DEAL_COLS).

    `resolve(symbols: Series, dates: Series) -> Series` maps a symbol to its current symbol (S17 renames, DEVIATIONS
    #70); `eq_syms` keeps only rows whose symbol trades in the equity series, which drops SME-only names (04 section 4).
    """
    if raw.empty:
        return pd.DataFrame(columns=DEAL_COLS).astype({"qty": "int64", "price": "float64", "valueCr": "float64",
                                                       "roundTrip": "bool", "entityTypeInferred": "bool"})
    df = raw.copy()
    df["date"] = [_iso(x) for x in df["date"]]
    df = df[df["date"] != ""].reset_index(drop=True)
    df["sym"] = resolve(df["symbol"], df["date"]) if resolve else df["symbol"]
    if eq_syms is not None:
        df = df[df["sym"].isin(eq_syms)].reset_index(drop=True)
    ent = {c: [] for c in ("entityId", "entityName", "entityType", "entityCategory", "entityTypeInferred")}
    for c in df["client"]:
        e = index.resolve(c)
        ent["entityId"].append(e.id)
        ent["entityName"].append(e.name)
        ent["entityType"].append(e.type)
        ent["entityCategory"].append(e.category)
        ent["entityTypeInferred"].append(e.type_inferred)
    for k, v in ent.items():
        df[k] = v
    df["valueCr"] = (df["qty"] * df["price"] / 1e7).round(2)
    df["type"] = df["type"].astype(str)
    df = _mark_round_trips(df)
    return df[DEAL_COLS].sort_values(["date", "sym", "entityId", "side"], kind="stable").reset_index(drop=True)


def _mark_round_trips(df: pd.DataFrame) -> pd.DataFrame:
    key = ["date", "sym", "entityId"]
    buy = df["qty"].where(df["side"] == "BUY", 0.0).groupby([df[k] for k in key]).transform("sum")
    sell = df["qty"].where(df["side"] == "SELL", 0.0).groupby([df[k] for k in key]).transform("sum")
    rt = np.array([is_round_trip(b, s) for b, s in zip(buy.to_numpy(), sell.to_numpy())], dtype=bool)
    df["roundTrip"] = rt
    return df


def flows(deals: pd.DataFrame) -> pd.DataFrame:
    """Per stock, date and category: buy value, sell value and net (buy - sell), round trips excluded (FLOW_COLS)."""
    d = deals[~deals["roundTrip"].astype(bool)]
    if d.empty:
        return pd.DataFrame(columns=FLOW_COLS)
    b = d["valueCr"].where(d["side"] == "BUY", 0.0)
    s = d["valueCr"].where(d["side"] == "SELL", 0.0)
    g = pd.DataFrame({"date": d["date"], "sym": d["sym"], "category": d["entityCategory"], "b": b, "s": s})
    out = g.groupby(["date", "sym", "category"], as_index=False).agg(b=("b", "sum"), s=("s", "sum"))
    out["buyValueCr"] = out["b"].round(2)
    out["sellValueCr"] = out["s"].round(2)
    out["netValueCr"] = (out["b"] - out["s"]).round(2)
    return out[FLOW_COLS].sort_values(["date", "sym", "category"], kind="stable").reset_index(drop=True)


def entity_totals(deals: pd.DataFrame, top: int = 10) -> pd.DataFrame:
    """Per entity over every stored date: counts (all rows), buy / sell / net (round trips excluded), first and last date,
    the aliases (raw client names seen) and the top symbols by gross value (ENTITY_COLS)."""
    if deals.empty:
        return pd.DataFrame(columns=ENTITY_COLS)
    d = deals.copy()
    d["_b"] = d["valueCr"].where(d["side"] == "BUY", 0.0)
    d["_s"] = d["valueCr"].where(d["side"] == "SELL", 0.0)
    live = d[~d["roundTrip"].astype(bool)]
    base = d.groupby("entityId").agg(entityName=("entityName", "first"), entityType=("entityType", "first"),
                                     entityCategory=("entityCategory", "first"), dealCount=("sym", "size"),
                                     firstDate=("date", "min"), lastDate=("date", "max"))
    sums = live.groupby("entityId").agg(buyValueCr=("_b", "sum"), sellValueCr=("_s", "sum"))
    out = base.join(sums, how="left").fillna({"buyValueCr": 0.0, "sellValueCr": 0.0})
    out["buyValueCr"] = out["buyValueCr"].round(2)
    out["sellValueCr"] = out["sellValueCr"].round(2)
    out["netValueCr"] = (out["buyValueCr"] - out["sellValueCr"]).round(2)
    al = d.groupby("entityId")["client"].agg(lambda x: sorted(set(x)))
    gross = d.assign(g=d["_b"] + d["_s"]).groupby(["entityId", "sym"])["g"].sum().reset_index()
    tops = {}
    for eid, grp in gross.sort_values(["entityId", "g", "sym"], ascending=[True, False, True]).groupby("entityId"):
        tops[eid] = list(grp["sym"].head(top))
    out["aliases"] = al.reindex(out.index)
    out["topSymbols"] = [tops.get(i, []) for i in out.index]
    out = out.reset_index()
    return out[ENTITY_COLS].sort_values("entityId", kind="stable").reset_index(drop=True)


def deal_row_values(deals: pd.DataFrame) -> list[list]:
    """Rows of the published deals/{year}.json table, in DEAL_COLS order (None-free)."""
    out = []
    for r in deals[DEAL_COLS].itertuples(index=False):
        out.append([str(r.date), str(r.type), str(r.sym), str(r.client), str(r.entityId), str(r.entityName),
                    str(r.entityType), str(r.entityCategory), bool(r.entityTypeInferred), str(r.side), int(r.qty),
                    round(float(r.price), 2), round(float(r.valueCr), 2), bool(r.roundTrip)])
    return out
