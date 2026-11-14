"""Symbol -> filename encoding and ISIN-based symbol-change merge."""

from __future__ import annotations

import re

import pandas as pd


def file_key(symbol: str) -> str:
    """Keep [A-Za-z0-9-]; every other character becomes '_' + its 2-digit uppercase hex code (M&M -> M_26M)."""
    return re.sub(r"[^A-Za-z0-9-]", lambda m: f"_{ord(m.group(0)):02X}", symbol)


def build_alias_map(isin_df: pd.DataFrame) -> dict[str, str]:
    """old symbol -> current symbol, from an ISIN->symbol timeline.

    isin_df columns: date (ISO str), symbol, isin. When a new symbol takes over an ISIN that an older symbol held
    (the two never trade under that ISIN on the same date), the old symbol maps to the newest one. ISINs seen on
    only one symbol, or seen under two symbols on the same date, are left alone (no merge without evidence).
    """
    alias: dict[str, str] = {}
    if isin_df.empty:
        return alias
    df = isin_df[["date", "symbol", "isin"]].drop_duplicates()
    for _, g in df.groupby("isin"):
        syms = g["symbol"].unique()
        if len(syms) < 2:
            continue
        by_sym = {s: set(g.loc[g["symbol"] == s, "date"]) for s in syms}
        if any(by_sym[a] & by_sym[b] for i, a in enumerate(syms) for b in syms[i + 1:]):
            continue  # concurrent symbols on one ISIN: not a rename
        order = sorted(syms, key=lambda s: max(by_sym[s]))
        newest = order[-1]
        for s in order[:-1]:
            if max(by_sym[s]) < min(by_sym[newest]):
                alias[s] = newest
    # resolve chains A->B->C
    for k in list(alias):
        seen = {k}
        while alias[k] in alias and alias[k] not in seen:
            seen.add(alias[k])
            alias[k] = alias[alias[k]]
    return alias
