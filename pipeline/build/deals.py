"""Phase 4 outputs in `build`: deals/{YYYY}.json, deals/flows.json, deals/entities.json, institutional/*.json, and the
per-stock deal blocks used by symbols/{f}.json (docs/specs/03 5.5, 5.7, 5.8). Pure reads of store/."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .. import deals as D
from .. import institutional as I
from ..config import STORE_DIR
from ..entities import default_index
from . import columns as C
from . import outputs
from .schema import validate


class DealsBuild:
    """Results the rest of the build needs: flows (for the trail), and per-stock deal blocks (for symbol files)."""

    def __init__(self, flows: pd.DataFrame, by_sym: dict, flow_rows: dict, entities: pd.DataFrame, n_deals: int,
                 n_round_trips: int, unclassified_value_share: float, categorised_value_share: float,
                 first_date: str | None = None):
        self.first_date = first_date
        self.flows = flows
        self.by_sym = by_sym
        self.flow_rows = flow_rows
        self.entities = entities
        self.n_deals = n_deals
        self.n_round_trips = n_round_trips
        self.unclassified_value_share = unclassified_value_share
        self.categorised_value_share = categorised_value_share


def _deal_files(root: Path | None) -> list[pd.DataFrame]:
    base = (root or STORE_DIR) / "deals"
    frames = []
    for p in sorted(base.glob("[0-9][0-9][0-9][0-9].csv")):
        frames.append(pd.read_csv(p, dtype=str, keep_default_na=False))
    return frames


def build_deals(out: Path, alias, eq_syms: set[str], root: Path | None = None, index=None,
                disclosed: dict | None = None, holding_entities: dict | None = None) -> DealsBuild:
    """index: the entity index with Phase 4B Promoter tags (build/holdings.py); disclosed: entityId -> (stocks, quarter)
    from the latest holdings quarter (None when the store has no shareholding data yet); holding_entities: entityId ->
    (name, type, category) for every named holder, so a holder with no deals still has an entity row (0 deals)."""
    raw = D.load_raw(_deal_files(root))
    resolve = alias.resolve_dated if hasattr(alias, "resolve_dated") else None
    ds = D.build_deals(raw, index or default_index(), eq_syms, resolve)
    flows = D.flows(ds)
    ent = D.entity_totals(ds)
    if disclosed:  # 4B: the entity's named-holder count in the latest holdings quarter (0 when it is not a holder)
        ent = ent.assign(disclosedHoldingsCount=[disclosed.get(e, (0, None))[0] for e in ent["entityId"]],
                         disclosedHoldingsQuarter=[disclosed.get(e, (0, None))[1] for e in ent["entityId"]])
    else:
        ent = ent.assign(disclosedHoldingsCount=None, disclosedHoldingsQuarter=None)

    for year, grp in ds.groupby(ds["date"].str[:4]):
        doc = {"schemaVersion": 1, "columns": C.names(C.DEALS), "rows": D.deal_row_values(grp)}
        validate("deals_year", doc)
        outputs.dump(out / "deals" / f"{year}.json", doc)

    flows_doc = {"schemaVersion": 1, "columns": C.names(C.FLOWS), "rows": outputs.table(flows, C.FLOWS)}
    validate("deals_flows", flows_doc)
    outputs.dump(out / "deals" / "flows.json", flows_doc)

    ent_rows = []
    for r in ent.itertuples(index=False):
        ent_rows.append([r.entityId, r.entityName, r.entityType, r.entityCategory, list(r.aliases), int(r.dealCount),
                         round(float(r.buyValueCr), 2), round(float(r.sellValueCr), 2), round(float(r.netValueCr), 2),
                         r.firstDate, r.lastDate, list(r.topSymbols),
                         None if r.disclosedHoldingsCount is None or pd.isna(r.disclosedHoldingsCount)
                         else int(r.disclosedHoldingsCount),
                         r.disclosedHoldingsQuarter if isinstance(r.disclosedHoldingsQuarter, str) else None])
    if disclosed and holding_entities:  # holders with no deal: shown with zero deals and their disclosed count
        have = {row[0] for row in ent_rows}
        for eid, (cnt, qtr) in sorted(disclosed.items()):
            if eid in have or eid not in holding_entities:
                continue
            name, typ, cat = holding_entities[eid]
            ent_rows.append([eid, name, typ, cat, [], 0, 0.0, 0.0, 0.0, None, None, [], int(cnt), qtr])
    ent_doc = {"schemaVersion": 1, "columns": C.names(C.ENTITIES), "rows": ent_rows}
    validate("deals_entities", ent_doc)
    outputs.dump(out / "deals" / "entities.json", ent_doc)

    by_sym: dict[str, list] = {}
    for r in ds[D.DEAL_COLS].itertuples(index=False):
        by_sym.setdefault(r.sym, []).append({
            "date": r.date, "type": r.type, "client": r.client, "entityId": r.entityId, "entityName": r.entityName,
            "entityCategory": r.entityCategory, "side": r.side, "qty": int(r.qty), "price": round(float(r.price), 2),
            "valueCr": round(float(r.valueCr), 2), "roundTrip": bool(r.roundTrip)})
    flow_rows: dict[str, list] = {}
    for r in flows.itertuples(index=False):
        flow_rows.setdefault(r.sym, []).append([r.date, r.category, round(float(r.buyValueCr), 2),
                                                round(float(r.sellValueCr), 2), round(float(r.netValueCr), 2)])
    total = float(ds["valueCr"].sum()) or 1.0
    categorised = float(ds.loc[ds["entityCategory"].isin(["FII", "DII"]), "valueCr"].sum())
    other = float(ds.loc[ds["entityCategory"] == "Other", "valueCr"].sum())
    first = min(raw["date"].map(_iso_or_none).dropna()) if len(raw) else None
    return DealsBuild(flows, by_sym, flow_rows, ent, len(ds), int(ds["roundTrip"].sum()), other / total,
                      categorised / total, first)


def _iso_or_none(x: str) -> str | None:
    s = D._iso(x)
    return s or None


def build_institutional(out: Path, trading_days: list[str], root: Path | None = None) -> None:
    cash = I.cash_rows(I.cash_records(root), trading_days)
    cash_doc = {"schemaVersion": 1, "columns": C.names(C.CASH), "rows": cash,
                "collectingSince": I.collecting_since(I.cash_records(root))}
    validate("institutional_cash", cash_doc)
    outputs.dump(out / "institutional" / "cash.json", cash_doc)

    parts = {}
    for kind in ("oi", "vol"):
        doc = {"schemaVersion": 1, "columns": C.names(C.PARTICIPANT), "rows": I.participant_frame(kind, root)}
        validate("institutional_part", doc)
        parts[kind] = doc
    outputs.dump(out / "institutional" / "participants.json", {"schemaVersion": 1, **parts})

    deriv = {"schemaVersion": 1, "columns": C.names(C.FII_DERIV), "rows": I.deriv_rows(root)}
    validate("fii_deriv", deriv)
    outputs.dump(out / "institutional" / "fii_deriv.json", deriv)


def outputs_summary(b: DealsBuild) -> dict:
    return {"deals": b.n_deals, "roundTrips": b.n_round_trips, "entities": len(b.entities),
            "categorisedShare": round(b.categorised_value_share, 4), "otherShare": round(b.unclassified_value_share, 4)}
