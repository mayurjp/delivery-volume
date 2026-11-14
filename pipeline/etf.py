"""ETF / index-fund detection (DEVIATIONS #32).

A symbol is an ETF when EITHER
  1. it appears in the PR zip's `etf{DDMMYYYY}.csv` on any stored day (store/etf/), OR
  2. it has an EQ row, is absent from the S15 equity master list (EQUITY_L.csv lists equities only) AND has never
     appeared in any stored S4 `mcap` file (ETFs have no market cap there; a real company that S15 has not caught up
     with yet, or one delisted since, does appear in mcap).

Rule 1 is exact but the PR file omits the gold/silver commodity ETFs (45 of 357 on 2026-11-13); rule 2 covers them.
"""

from __future__ import annotations

from collections.abc import Iterable


def detect_etf(symbols: Iterable[str], pr_etf: set[str], s15_symbols: set[str], mcap_symbols: set[str]) -> set[str]:
    """Subset of `symbols` (EQ-series symbols, alias-resolved) that are ETFs.

    `s15_symbols` empty means no S15 snapshot is stored: rule 2 is then disabled (it would flag everything).
    """
    out = set()
    for s in symbols:
        if s in pr_etf:
            out.add(s)
        elif s15_symbols and s not in s15_symbols and s not in mcap_symbols:
            out.add(s)
    return out
