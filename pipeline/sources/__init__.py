"""Source registry. One module per source (S5/S6, S9/S10 and S12-S15 share small modules)."""

from __future__ import annotations

from . import (
    s1_cm_delivery,
    s2_cm_udiff,
    s3_fo_udiff,
    s4_pr_zip,
    s5_s6_participant,
    s7_fii_stats,
    s8_fii_dii_cash,
    s9_s10_deals,
    s11_constituents,
    s12_to_s15,
    s16_shareholding,
    s17_symbol_change,
)
from .base import SourceSpec

REGISTRY: dict[str, SourceSpec] = {s.id: s for s in [
    s1_cm_delivery.SPEC, s2_cm_udiff.SPEC, s3_fo_udiff.SPEC, s4_pr_zip.SPEC, s5_s6_participant.SPEC_OI,
    s5_s6_participant.SPEC_VOL, s7_fii_stats.SPEC, s8_fii_dii_cash.SPEC, s9_s10_deals.SPEC_BULK,
    s9_s10_deals.SPEC_BLOCK, s11_constituents.SPEC, s12_to_s15.SPEC_S12, s12_to_s15.SPEC_S13, s12_to_s15.SPEC_S14,
    s12_to_s15.SPEC_S15, s16_shareholding.SPEC, s17_symbol_change.SPEC,
]}


def sort_key(sid: str) -> int:
    return int(sid[1:])


def ordered() -> list[SourceSpec]:
    return [REGISTRY[k] for k in sorted(REGISTRY, key=sort_key)]
