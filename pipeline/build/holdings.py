"""Phase 4B outputs in `build` (03 section 5.10, 04 section 5.4): holdings/quarters.json, holdings/{quarter}.json,
holdings/holders/{quarter}.json, holdings/latest.json, holdings/aggregates.json, and the per-stock `holdings` and
`namedHolders` blocks. Pure reads of store/shareholding/. The pure functions here are unit-tested with synthetic
extracts (tests/test_holdings_build.py); the real files come from the store.
"""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from .. import config
from .. import entities as E
from . import columns as C
from . import outputs
from .schema import validate

CHG_EPS_PP = 0.05  # 04 5.4: UP / DOWN when |change| >= 0.05 pp
COMPLETE_SHARE = 0.95  # 03 5.10: a quarter is complete at >= 95% of the universe filed ...
COMPLETE_DAYS = 60  # ... or 60 days after its quarter end
HOLDER_FILE_QUARTERS = 2  # holders/{quarter}.json for the latest two quarters (DEVIATIONS #90, 15 MB budget)
DILUTION_PCT = 2.0  # 04 5.4: |sharesChgPct| > 2%
GROUPS = ("ALL", "MC:L", "MC:M", "MC:S", "MC:U")
FII_KEYS = ("fpi1", "fpi2", "fiiLegacy")
DII_KEYS = ("mf", "insurance", "bank", "pension", "aif", "otherDii")


def groupings(cats: dict[str, float]) -> dict[str, float]:
    """03 5.10 derived groupings, from category percentages."""
    return {
        "promoterPct": cats.get("promoter", 0.0),
        "fiiPct": sum(cats.get(k, 0.0) for k in FII_KEYS),
        "diiPct": sum(cats.get(k, 0.0) for k in DII_KEYS),
        "mfPct": cats.get("mf", 0.0),
        "insurancePct": cats.get("insurance", 0.0),
        "retailPct": cats.get("retailSmall", 0.0) + cats.get("retailLarge", 0.0),
    }


def load_extracts(root: Path | None = None) -> list[dict]:
    base = (root or config.STORE_DIR) / "shareholding"
    docs = []
    if not base.exists():
        return docs
    for qdir in sorted(p for p in base.iterdir() if p.is_dir() and p.name[:4].isdigit()):
        for p in sorted(qdir.glob("*.json.gz")):
            docs.append(json.loads(gzip.decompress(p.read_bytes()).decode("utf-8")))
    return docs


def label_change(prev: float | None, cur: float | None) -> str:
    """NEW (absent last quarter), UP / DOWN (|change| >= 0.05 pp), SAME, EXITED (absent now)."""
    if cur is None:
        return "EXITED"
    if prev is None:
        return "NEW"
    d = round(cur - prev, 6)  # rounding: 2.05 - 2.00 is 0.04999... in binary floating point
    if d >= CHG_EPS_PP:
        return "UP"
    if d <= -CHG_EPS_PP:
        return "DOWN"
    return "SAME"


def quarter_complete(filed: int, universe: int, quarter: str, asof: date) -> bool:
    """03 5.10: complete when >= 95% of the universe has filed, or 60 days have passed since the quarter end."""
    q = date.fromisoformat(quarter)
    return (universe > 0 and filed / universe >= COMPLETE_SHARE) or (asof - q).days >= COMPLETE_DAYS


def named_rows(sym: str, holders: list[dict], prev_holders: list[dict] | None, eid) -> list[list]:
    """Named-holder rows for one stock and quarter, against the previous quarter's list (None when there is no
    previous quarter, so every holder is NEW-free and unlabelled: chg NEW only when a previous list exists). EXITED
    rows are synthesised from the previous quarter: they mean only "no longer listed above 1%" (a sale or a fall
    below 1%, which the filing cannot tell apart)."""
    key = lambda h: (h["category"], h["subType"], h["holder"])  # noqa: E731
    prev = {key(h): h for h in prev_holders} if prev_holders is not None else None
    cur = {key(h): h for h in holders}
    rows = []
    for h in sorted(holders, key=lambda x: -x["pct"]):
        p = prev.get(key(h)) if prev is not None else None
        pp = p["pct"] if p else None
        chg = label_change(pp, h["pct"]) if prev is not None else None
        rows.append([sym, h["category"], h["subType"], h["holder"], eid(h["holder"]), int(h["shares"]),
                     round(h["pct"], 2), None if pp is None else round(pp, 2), chg])
    if prev is not None:
        for k, p in prev.items():
            if k not in cur:
                rows.append([sym, p["category"], p["subType"], p["holder"], eid(p["holder"]), None, None,
                             round(p["pct"], 2), "EXITED"])
    return rows


def stock_row(sym: str, doc: dict, prev: dict | None) -> list:
    """One row of holdings/{quarter}.json (HOLD_STOCK order)."""
    g = groupings(_pcts(doc))
    pg = groupings(_pcts(prev)) if prev else None
    shares_chg = None
    if prev and prev.get("totalShares"):
        shares_chg = (doc["totalShares"] / prev["totalShares"] - 1) * 100
    dil = bool(shares_chg is not None and abs(shares_chg) > DILUTION_PCT)

    def chg(k: str):
        return None if pg is None else round(g[k] - pg[k], 2)

    return [sym, doc.get("filedOn"), round(g["promoterPct"], 2), round(g["fiiPct"], 2), round(g["diiPct"], 2),
            round(g["mfPct"], 2), round(g["insurancePct"], 2), round(g["retailPct"], 2), chg("fiiPct"), chg("diiPct"),
            chg("mfPct"), chg("promoterPct"), None if shares_chg is None else round(shares_chg, 2), dil,
            len(doc.get("namedHolders") or []), int(doc["totalShares"])]


def _pcts(doc: dict | None) -> dict[str, float]:
    return {k: float(v["pct"]) for k, v in (doc or {}).get("categories", {}).items()}


@dataclass
class HoldingsBuild:
    index: E.EntityIndex
    by_sym: dict[str, dict] = field(default_factory=dict)  # symbols/{f}.json blocks
    disclosed: dict[str, tuple[int, str]] = field(default_factory=dict)  # entityId -> (stocks, latest quarter)
    quarters: list[str] = field(default_factory=list)
    complete: dict[str, bool] = field(default_factory=dict)
    promoter_names: list[str] = field(default_factory=list)
    entities: dict[str, tuple[str, str, str]] = field(default_factory=dict)  # entityId -> (name, type, category)
    # sym -> the stored filings as holdings_trail reads them (quarter, filedOn, grouped %), for the trail (Phase 4B)
    filings: dict[str, list[dict]] = field(default_factory=dict)


def build_holdings(out: Path, uni_rows: list[dict], asof: date, root: Path | None = None,
                   docs: list[dict] | None = None, index: E.EntityIndex | None = None,
                   universe_count: int | None = None) -> HoldingsBuild:
    """uni_rows: universe records with sym, mcapCr, bucket (market-cap weights and the cap groups).
    `docs` may be given (tests); otherwise the store is read. Returns the entity index that includes Promoter
    tags (the deals build uses it) and the per-stock blocks for symbols/{f}.json."""
    docs = load_extracts(root) if docs is None else docs
    uni = {r["sym"]: r for r in uni_rows}
    by_q: dict[str, dict[str, dict]] = {}
    for d in docs:
        if d["sym"] in uni:
            by_q.setdefault(d["quarter"], {})[d["sym"]] = d
    quarters = sorted(by_q)

    promoter_names = sorted({h["holder"] for d in docs for h in d.get("namedHolders", []) if h["category"] == "Promoter"})
    idx = E.with_promoters(promoter_names, index)
    entity_of: dict[str, str] = {}

    seen_ent: dict[str, tuple[str, str, str]] = {}

    def eid(name: str) -> str:
        if name not in entity_of:
            e = idx.resolve(name)
            entity_of[name] = e.id
            seen_ent[e.id] = (e.name, e.type, e.category)
        return entity_of[name]

    n_universe = universe_count or len(uni)
    complete = {q: quarter_complete(len(by_q[q]), n_universe, q, asof) for q in quarters}
    out_dir = out / "holdings"
    result = HoldingsBuild(index=idx, quarters=quarters, complete=complete, promoter_names=promoter_names)
    result.entities = seen_ent

    qdocs: dict[str, list[list]] = {}
    holder_rows: dict[str, list[list]] = {}
    for i, q in enumerate(quarters):
        prevq = quarters[i - 1] if i else None
        rows, hrows = [], []
        for sym, d in sorted(by_q[q].items()):
            prev = by_q[prevq].get(sym) if prevq else None
            rows.append(stock_row(sym, d, prev))
            hrows.extend(named_rows(sym, d.get("namedHolders", []),
                                    prev.get("namedHolders", []) if prev else None, eid))
        qdocs[q], holder_rows[q] = rows, hrows

    # per-quarter files
    stock_cols = C.names(C.HOLD_STOCK)
    qdoc_list = []
    for q in quarters:
        doc = {"schemaVersion": 1, "columns": stock_cols, "rows": qdocs[q]}
        validate("holdings_quarter", doc)
        outputs.dump(out_dir / f"{q}.json", doc)
        if q in quarters[-HOLDER_FILE_QUARTERS:]:  # DEVIATIONS #90: the budget keeps holder files for the latest two
            hdoc = {"schemaVersion": 1, "columns": C.names(C.HOLD_NAMED), "rows": holder_rows[q]}
            validate("holdings_holders", hdoc)
            outputs.dump(out_dir / "holders" / f"{q}.json", hdoc)
        qdoc_list.append([q, len(by_q[q]), n_universe, complete[q]])
    qdoc = {"schemaVersion": 1, "columns": C.names(C.HOLD_QUARTERS), "rows": qdoc_list}
    validate("holdings_quarters", qdoc)
    outputs.dump(out_dir / "quarters.json", qdoc)

    # latest: each stock's most recent stored quarter (the latest complete quarter, plus in-progress rows)
    latest_rows = []
    for sym in sorted(uni):
        qs = [q for q in quarters if sym in by_q[q]]
        if qs:
            q = qs[-1]
            row = next(r for r in qdocs[q] if r[0] == sym)
            latest_rows.append([q] + row)
    lat = {"schemaVersion": 1, "columns": C.names([("quarter", "s", None)] + C.HOLD_STOCK), "rows": latest_rows}
    validate("holdings_latest", lat)
    outputs.dump(out_dir / "latest.json", lat)

    agg_rows = _aggregates(by_q, uni, quarters)
    agg = {"schemaVersion": 1, "columns": C.names(C.HOLD_AGG), "rows": agg_rows}
    validate("holdings_aggregates", agg)
    outputs.dump(out_dir / "aggregates.json", agg)

    # per-stock blocks: all stored quarters, and the latest quarter's named holders (with EXITED)
    for sym in uni:
        qs = [q for q in quarters if sym in by_q[q]]
        if not qs:
            continue
        stock_rows = [[q] + next(r for r in qdocs[q] if r[0] == sym)[1:] for q in qs]
        latest_q = qs[-1]
        named = [[latest_q] + r[1:] for r in holder_rows[latest_q] if r[0] == sym]
        result.filings[sym] = [{"quarter": r[0], "filedOn": r[1], "promoterPct": r[2], "fiiPct": r[3], "diiPct": r[4],
                                "mfPct": r[5]} for r in stock_rows]
        result.by_sym[sym] = {
            # quarters: the store's quarter list, which the trail's base-quarter rule walks (holdings_trail)
            "holdings": {"columns": C.HOLDINGS_COLS, "rows": stock_rows, "quarters": quarters},
            "namedHolders": {"columns": C.NAMED_HOLDER_COLS, "rows": named},
        }
    # disclosed holdings per entity: stocks where the entity is a named holder in the latest quarter
    if quarters:
        lq = quarters[-1]
        counts: dict[str, set[str]] = {}
        for r in holder_rows[lq]:
            if r[5] is not None and r[6] is not None and r[6] >= 1.0 and r[4]:
                counts.setdefault(r[4], set()).add(r[0])
        result.disclosed = {e: (len(s), lq) for e, s in counts.items()}
    outputs.flush()  # dump() writes on a pool; the caller may read the files straight away
    return result


def _aggregates(by_q: dict, uni: dict, quarters: list[str]) -> list[list]:
    """Market-cap-weighted group averages (03 5.10). Weight = mcapCr on the as-of day (from the universe)."""
    out = []
    for q in quarters:
        acc: dict[str, dict] = {g: {"n": 0, "w": 0.0, "s": {k: 0.0 for k in ("promoterPct", "fiiPct", "diiPct", "mfPct", "retailPct")}}
                                for g in GROUPS}
        for sym, d in by_q[q].items():
            w = float(uni[sym].get("mcapCr") or 0.0)
            gp = groupings(_pcts(d))
            keys = ["ALL", f"MC:{uni[sym].get('bucket')}"] if uni[sym].get("bucket") else ["ALL"]
            for g in keys:
                if g not in acc or w <= 0:
                    continue
                acc[g]["n"] += 1
                acc[g]["w"] += w
                for k in acc[g]["s"]:
                    acc[g]["s"][k] += w * gp[k]
        for g in GROUPS:
            a = acc[g]
            if a["n"] == 0 or a["w"] <= 0:
                continue
            out.append([q, g, a["n"]] + [round(a["s"][k] / a["w"], 2) for k in ("promoterPct", "fiiPct", "diiPct", "mfPct", "retailPct")])
    return out
