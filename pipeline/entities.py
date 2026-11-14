"""Entity normalisation for bulk and block deals (docs/specs/04 section 5.3, config/entities.json).

A raw client name is cleaned, matched against the seed list (whole-word pattern match, first entity wins) and, when no
seed matches, becomes its own entity with a type inferred from its name. Category (FII / DII / Other) follows from the
type unless the seed sets one. Pure functions: no I/O except `load_entities`.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache

from . import config

CATEGORIES = ("FII", "DII", "Other")
TYPE_CATEGORY = {
    "FPI": "FII", "FPI (likely)": "FII",
    "MF": "DII", "Insurance": "DII", "Pension": "DII", "Bank": "DII", "AIF": "DII",
    "Trader/Prop (likely)": "Other", "Promoter": "Other", "Other": "Other",
}
TYPES = tuple(TYPE_CATEGORY)

_SUFFIX = [(re.compile(r"\bLIMITED\b"), "LTD"), (re.compile(r"\bPRIVATE\b"), "PVT")]


def clean_name(raw: str) -> str:
    """Upper case, '&' as AND, punctuation and runs of spaces collapsed, LIMITED -> LTD, PRIVATE -> PVT."""
    s = str(raw).upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9]+", " ", s).strip()
    for rx, rep in _SUFFIX:
        s = rx.sub(rep, s)
    return " ".join(s.split())


def _words(clean: str) -> str:
    return f" {clean} "


def infer_type(clean: str) -> str:
    """Type from the name alone (04 section 5.3 order, with the ODI rule checked first: DEVIATIONS #76)."""
    p = _words(clean)
    if p.endswith(" ODI "):
        return "FPI (likely)"
    if " MUTUAL FUND " in p or p.endswith(" MF "):
        return "MF"
    if " INSURANCE " in p or " ASSURANCE " in p:
        return "Insurance"
    if " PENSION " in p or " PROVIDENT " in p:
        return "Pension"
    if " BANK " in p:
        return "Bank"
    # SEBI counts Alternative Investment Funds as domestic institutions; checked before the FUND/LLP rules below,
    # which would otherwise call "PI OPPORTUNITIES AIF V LLP" a prop desk or "... AIF FUND" an FPI.
    if " AIF " in p or " ALTERNATIVE INVESTMENT " in p or " ALTERNATE INVESTMENT " in p:
        return "AIF"
    if any(f" {k} " in p for k in ("PTE", "PLC", "LLC", "FUND", "SICAV", "MAURITIUS", "SINGAPORE")):
        return "FPI (likely)"
    if " CAPITAL MARKETS " in p or any(f" {k} " in p for k in ("TRADING", "SECURITIES", "BROKING", "LLP")):
        return "Trader/Prop (likely)"
    return "Other"


def slug(clean: str) -> str:
    return clean.lower().replace(" ", "-")


@dataclass(frozen=True)
class Entity:
    id: str
    name: str
    type: str
    category: str
    type_inferred: bool
    seeded: bool
    aliases: tuple = field(default_factory=tuple)


class EntityIndex:
    """Resolves raw client names to entities. `seeds` is the parsed config/entities.json list."""

    def __init__(self, seeds: list[dict]):
        self.seeds = []
        self._ids: set[str] = set()
        for s in seeds:
            pats = [clean_name(p) for p in s.get("patterns", []) if clean_name(p)]
            t = s.get("type") or "Other"
            if t not in TYPE_CATEGORY:
                raise ValueError(f"entity {s.get('id')}: unknown type {t!r}")
            cat = s.get("category") or TYPE_CATEGORY[t]
            if cat not in CATEGORIES:
                raise ValueError(f"entity {s.get('id')}: unknown category {cat!r}")
            if s["id"] in self._ids:
                raise ValueError(f"duplicate entity id {s['id']}")
            self._ids.add(s["id"])
            self.seeds.append({"id": s["id"], "name": s.get("name", s["id"]), "type": t, "category": cat,
                               "patterns": [f" {p} " for p in pats]})
        self._cache: dict[str, Entity] = {}

    def resolve(self, raw: str) -> Entity:
        clean = clean_name(raw)
        hit = self._cache.get(clean)
        if hit is not None:
            return hit
        p = _words(clean)
        for s in self.seeds:
            if any(pat in p for pat in s["patterns"]):
                e = Entity(s["id"], s["name"], s["type"], s["category"], False, True)
                break
        else:
            t = infer_type(clean)
            e = Entity(slug(clean), clean, t, TYPE_CATEGORY[t], True, False)
        self._cache[clean] = e
        return e


def load_seeds(root=None) -> list[dict]:
    path = (root or config.ROOT) / "config" / "entities.json"
    return json.loads(path.read_text(encoding="utf-8"))["entities"]


@lru_cache(maxsize=None)
def default_index() -> EntityIndex:
    return EntityIndex(load_seeds())


def is_round_trip(buy_qty: float, sell_qty: float) -> bool:
    """04 section 5.3: both sides traded, and the net is at most 10% of the larger side."""
    if buy_qty <= 0 or sell_qty <= 0:
        return False
    return abs(buy_qty - sell_qty) <= 0.1 * max(buy_qty, sell_qty)
