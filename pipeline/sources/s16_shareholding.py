"""S16: quarterly shareholding-pattern filings (Phase 4B).

Two parts:

* The listing (cookie-gated `www.nseindia.com`): one call per date window returns every filing whose submission date
  falls in the window, with the quarter end (`date`), the broadcast timestamp and the XBRL link. Only the listing is
  cookie-gated. The XBRL files on `nsearchives.nseindia.com` need no cookies.
* The XBRL (BSE-format SHP taxonomy, two namespace versions, matched by local name). It is parsed to the 03 section 5.10
  extract: category totals as % (fractions x 100), named holders above 1% and the totals check.

Facts are keyed by context. A context with one member on `CategoryOfShareholdersAxis` carries a category total. A named
holder is a fact `NameOfTheShareholder` in a context whose typed member on `DetailsOfSharesHeldBy*Axis` names a value
context; the shares and % are in that value context. See SOURCE_STATUS.md, S16.
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta

from .base import Parsed, SourceSpec

HOME = "https://www.nseindia.com/"
PAGE = "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern?symbol=RELIANCE"
API = "https://www.nseindia.com/api/corporate-share-holdings-master"
QUARTER_MONTH_DAY = {(3, 31), (6, 30), (9, 30), (12, 31)}
LISTING_WINDOW_DAYS = 120  # the date-range listing was verified with a 120-day window (SOURCE_STATUS S16)

# 03 section 5.10 category keys, by the CategoryOfShareholdersAxis member (local name).
CATEGORY_KEYS = ["promoter", "mf", "insurance", "bank", "pension", "aif", "otherDii", "fpi1", "fpi2", "fiiLegacy",
                 "fdi", "swf", "retailSmall", "retailLarge", "corporate", "others"]
PUBLIC_KEYS = [k for k in CATEGORY_KEYS if k not in ("promoter", "others")]
MEMBER_KEY = {
    "ShareholdingOfPromoterAndPromoterGroupMember": "promoter",
    "MutualFundsOrUTIMember": "mf",
    "InsuranceCompaniesMember": "insurance",
    "BanksMember": "bank",
    "IndianFinancialInstitutionsOrBanksMember": "bank",
    "ProvidentFundsOrPensionFundsMember": "pension",
    "AlternativeInvestmentFundsMember": "aif",
    "NBFCsRegisteredWithRBIMember": "otherDii",
    "OtherFinancialInstitutionsMember": "otherDii",
    "SovereignWealthFundsDomesticMember": "otherDii",
    "VentureCapitalFundsMember": "otherDii",
    "AssetReconstructionCompaniesMember": "otherDii",
    "OtherInstitutionsDomesticMember": "otherDii",
    "InstitutionsForeignPortfolioInvestorCategoryOneMember": "fpi1",
    "InstitutionsForeignPortfolioInvestorCategoryTwoMember": "fpi2",
    "OtherInstitutionsForeignMember": "fiiLegacy",
    "ForeignVentureCapitalInvestorsMember": "fiiLegacy",
    "ForeignDirectInvestmentMember": "fdi",
    "SovereignWealthFundsForeignMember": "swf",
    "ResidentIndividualShareholdersHoldingNominalShareCapitalUpToRsTwoLakhMember": "retailSmall",
    "ResidentIndividualShareholdersHoldingNominalShareCapitalInExcessOfRsTwoLakhMember": "retailLarge",
    "BodiesCorporateMember": "corporate",
}
# Subtotals and members that the category keys above do not use. They are never summed. Everything else in the
# category axis that is not mapped lands in `others` (as the residual of PublicShareholdingMember) and is listed
# in `unmapped` for review.
SUBTOTAL_MEMBERS = {
    "ShareholdingPatternMember", "PublicShareholdingMember", "NonInstitutionsMember", "InstitutionsDomesticMember",
    "InstitutionsForeignMember", "IndianMember", "ForeignMember", "OtherIndianShareholdersMember",
    "OtherForeignShareholdersMember", "SharesHeldByNonPromoterNonPublicShareholdersMember",
    "CentralGovernmentOrStateGovernmentSMember",
    "ShareholdingByCompaniesOrBodiesCorporateWhereCentralOrStateGovernmentIsPromoterMember",  # inside promoter
}
NPNP_MEMBER = "SharesHeldByNonPromoterNonPublicShareholdersMember"
PUBLIC_MEMBER = "PublicShareholdingMember"
TOTAL_MEMBER = "ShareholdingPatternMember"
CAT_AXIS = "CategoryOfShareholdersAxis"

# Named holders: DetailsOfSharesHeldBy<X>Axis -> (category, subType). Category is FII, DII, Promoter or Other.
NAMED_AXIS = {
    "MutualFundsOrUTI": ("DII", "mf"),
    "InsuranceCompanies": ("DII", "insurance"),
    "ProvidentFundsOrPensionFunds": ("DII", "pension"),
    "AlternativeInvestmentFunds": ("DII", "aif"),
    "OtherInstitutionsDomestic": ("DII", "otherDii"),
    "IndianFinancialInstitutionsOrBanks": ("DII", "bank"),
    "InstitutionsForeignPortfolioInvestorOne": ("FII", "fpi1"),
    "InstitutionsForeignPortfolioInvestorTwo": ("FII", "fpi2"),
    "OtherInstitutionsForeign": ("FII", "fiiLegacy"),
    "ForeignCompanies": ("Other", "foreignCompany"),
    "OtherForeignShareholders": ("Other", "otherForeign"),
    "OthersIndianShareholders": ("Other", "otherIndian"),
    "OtherNonInstitutions": ("Other", "nonInstitution"),
    "BodiesCorporate": ("Other", "corporate"),
    "ResidentIndividualShareholdersHoldingNominalShareCapitalInExcessOfRsTwoLakh": ("Other", "retailLarge"),
    "NonResidentIndividualsOrForeignIndividuals": ("Other", "nri"),
    "DirectorsAndDirectorsRelatives": ("Other", "director"),
    "KeyManagerialPersonnel": ("Other", "kmp"),
    "CustodianOrDRHolder": ("Other", "custodian"),
    "CentralGovernmentOrStateGovernments": ("Other", "government"),
    # Companies whose shares are held by a promoter that is a government company (the filing's own promoter
    # classification): tagged Promoter (07, 4B: promoter names from the XBRL).
    "ShareholdingByCompaniesOrBodiesCorporateWhereCentralOrStateGovernmentIsPromoter": ("Promoter", "govtPromoted"),
}
MIN_NAMED_PCT = 1.0  # named holders above 1% (03 5.10)
TOTALS_TOLERANCE_PCT = 0.1  # category totals sum to 100 +/- 0.1


def candidates(d: date) -> list[tuple[str, str]]:
    """Verify-sources probe: one date-range listing that ends on `d`."""
    frm = d - timedelta(days=LISTING_WINDOW_DAYS)
    return [("B:date-range", listing_url(frm, d))]


def listing_url(frm: date, to: date) -> str:
    return f"{API}?index=equities&from_date={frm:%d-%m-%Y}&to_date={to:%d-%m-%Y}"


def parse(body: bytes, d: date, label: str = "") -> Parsed:
    """Verify-sources view of the listing: JSON list of filings."""
    p = Parsed()
    try:
        payload = json.loads(body)
    except ValueError:
        p.errors.append("not JSON")
        return p
    if not isinstance(payload, list):
        p.errors.append(f"listing is {type(payload).__name__}, not a list")
        return p
    p.rows = len(payload)
    p.header = sorted({k for r in payload[:50] if isinstance(r, dict) for k in r})
    p.notes.append(f"{len(payload)} filings in window; quarter ends: {sorted({r.get('date') for r in payload})[:6]}")
    if not payload:
        p.errors.append("empty listing")
    p.data = payload
    return p


SPEC = SourceSpec("S16", "shareholding", "Shareholding-pattern listing (date range) and XBRL", "json", candidates,
                  parse, verified="VERIFIED", cookie_gated=True, warm=(HOME, PAGE), referer=PAGE)


# ---- listing ------------------------------------------------------------------------------------------------------

_MON = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
                                   start=1)}


def _parse_mon_date(s: str) -> date | None:
    m = re.match(r"\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})", str(s or ""))
    if not m or m.group(2).upper() not in _MON:
        return None
    try:
        return date(int(m.group(3)), _MON[m.group(2).upper()], int(m.group(1)))
    except ValueError:
        return None


def quarter_end(s: str) -> date | None:
    """'30-SEP-2026' -> date, only when it is a calendar quarter end (other dates are not quarterly filings)."""
    d = _parse_mon_date(s)
    if d is None or (d.month, d.day) not in QUARTER_MONTH_DAY:
        return None
    return d


def broadcast_at(s: str) -> datetime | None:
    """'14-NOV-2026 16:44:46' -> naive datetime (IST, as NSE publishes it)."""
    m = re.match(r"\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?", str(s or ""))
    if not m or m.group(2).upper() not in _MON:
        return None
    hh, mm, ss = (int(m.group(i) or 0) for i in (4, 5, 6))
    try:
        return datetime(int(m.group(3)), _MON[m.group(2).upper()], int(m.group(1)), hh, mm, ss)
    except ValueError:
        return None


def slim_listing(rows: list[dict]) -> list[dict]:
    """The fields the pipeline uses, for a listing snapshot in the store."""
    keep = ("symbol", "name", "isin", "date", "broadcastDate", "submissionDate", "revisedData", "recordId", "xbrl",
            "xbrlFileSize", "pr_and_prgrp", "public_val", "employeeTrusts")
    return [{k: r.get(k) for k in keep} for r in rows if isinstance(r, dict)]


# ---- XBRL ---------------------------------------------------------------------------------------------------------

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _dim_value(el) -> str:
    """Member value of an explicitMember (text) or a typedMember (the child element's text)."""
    if _local(el.tag) == "explicitMember":
        return (el.text or "").strip().split(":")[-1]
    for c in el.iter():
        if c is not el and c.text and c.text.strip():
            return c.text.strip().split(":")[-1]
    return ""


def _contexts(root) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for el in root:
        if _local(el.tag) != "context":
            continue
        end = None
        members = []
        for c in el.iter():
            t = _local(c.tag)
            if t in ("instant", "endDate"):
                end = (c.text or "").strip()
            elif t in ("explicitMember", "typedMember"):
                members.append((c.get("dimension", "").split(":")[-1], _dim_value(c)))
        out[el.get("id")] = {"end": end, "members": members}
    return out


def _num(text: str) -> float | None:
    try:
        return float(str(text).replace(",", "").strip())
    except ValueError:
        return None


def parse_xbrl(body: bytes) -> dict:
    """Parse one SHP XBRL filing to the 03 section 5.10 extract (without the listing fields).

    Returns a dict with `ok` (False when the file is not a usable SHP filing), `problems` (strings) and the extract.
    Totals failures are reported in `problems` and `checks`; the caller decides, the parser never raises on data.
    """
    out: dict = {"ok": False, "problems": [], "unmapped": []}
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        out["problems"].append(f"xml: {e}")
        return out
    ns = ""  # the SHP taxonomy namespace is the first non-XBRL-core namespace on a child (the root is xbrli)
    for el in root:
        if el.tag.startswith("{") and "xbrl.org" not in el.tag:
            ns = el.tag[1:].split("}")[0]
            break
    out["format"] = ns.rsplit("/", 2)[-2] if ns.count("/") >= 2 else None  # e.g. 2025-10-31 (the taxonomy date)
    contexts = _contexts(root)
    facts: dict[str, dict[str, str]] = {}
    company: dict[str, str] = {}
    for el in root:
        cr = el.get("contextRef")
        if not cr:
            continue
        name = _local(el.tag)
        text = (el.text or "").strip()
        facts.setdefault(cr, {})[name] = text
        if cr == "MainD" or cr == "MainI":
            company.setdefault(name, text)
    qe_text = company.get("DateOfReport") or ""
    try:
        quarter = date.fromisoformat(qe_text)
    except ValueError:
        out["problems"].append(f"DateOfReport not parsed: {qe_text!r}")
        return out
    out.update({
        "sym": company.get("Symbol", "").strip(),
        "isin": company.get("ISIN") or None,
        "companyName": company.get("NameOfTheCompany") or None,
        "sme": company.get("WhetherCompanyIsSME", "").strip().lower() in ("yes", "true", "y"),
        "quarter": quarter.isoformat(),
    })

    # Category totals: contexts with one CategoryOfShareholdersAxis member and the report date as their end.
    totals: dict[str, dict] = {}
    for cid, c in contexts.items():
        if c["end"] != qe_text:
            continue
        cats = [v for d, v in c["members"] if d == CAT_AXIS]
        if len(cats) != 1 or any(d != CAT_AXIS for d, _ in c["members"]):
            continue
        f = facts.get(cid, {})
        shares = _num(f.get("NumberOfFullyPaidUpEquityShares", ""))
        pct = _num(f.get("ShareholdingAsAPercentageOfTotalNumberOfShares", ""))
        totals[cats[0]] = {"shares": shares, "pct": None if pct is None else pct * 100,
                           "holders": _num(f.get("NumberOfShareholders", ""))}
    total = totals.get(TOTAL_MEMBER, {})
    total_shares = int(total["shares"]) if total.get("shares") else None
    if not total_shares:
        out["problems"].append("no total shares (ShareholdingPatternMember)")
        return out
    out["totalShares"] = total_shares

    def shares_pct(member: str) -> tuple[int, float] | None:
        t = totals.get(member)
        if not t or t["shares"] is None:
            return None
        sh = int(t["shares"])
        pct = t["pct"] if t["pct"] is not None else sh / total_shares * 100
        return sh, round(pct, 6)

    cats: dict[str, tuple[int, float]] = {}
    for member, key in MEMBER_KEY.items():
        sp = shares_pct(member)
        if sp is None or sp[0] == 0:
            continue
        cats[key] = (cats.get(key, (0, 0.0))[0] + sp[0], cats.get(key, (0, 0.0))[1] + sp[1])
    for member in totals:
        if member not in MEMBER_KEY and member not in SUBTOTAL_MEMBERS and member != NPNP_MEMBER and member != TOTAL_MEMBER:
            if totals[member]["shares"] and totals[member]["shares"] > 0:
                out["unmapped"].append(member)

    promoter = cats.get("promoter", (0, 0.0))
    public_sp = shares_pct(PUBLIC_MEMBER)
    npnp_sp = shares_pct(NPNP_MEMBER) or (0, 0.0)
    if public_sp is None:  # public = total - promoter - nonpromoter-nonpublic
        public_sp = (total_shares - promoter[0] - npnp_sp[0], 100 - promoter[1] - npnp_sp[1])
        out["problems"].append("PublicShareholdingMember missing; public derived as the residual")
    # A public leaf larger than the whole public total cannot be public. HDFC Life files HDFC Bank (its promoter) under
    # the legacy "Indian financial institutions or banks" member: drop that leaf, flag it, and tag the holder Promoter.
    overlap = [k for k in PUBLIC_KEYS if k in cats and cats[k][0] > public_sp[0]]
    for k in overlap:
        out["problems"].append(f"{k} ({cats[k][1]:.2f}%) exceeds the public total: treated as promoter-group overlap")
        cats.pop(k)
    out["promoterOverlap"] = overlap
    mapped_public = [cats[k] for k in PUBLIC_KEYS if k in cats]
    residual_sh = public_sp[0] - sum(s for s, _ in mapped_public)
    residual_pct = public_sp[1] - sum(p for _, p in mapped_public)
    if residual_sh < -1 or residual_pct < -0.01:
        out["problems"].append(f"public leaves exceed public total by {-residual_pct:.3f} pp (double count?)")
    # `others` takes the residual of public plus the non-promoter non-public holding (custodian/DR, EBT).
    cats["others"] = (residual_sh + npnp_sp[0], residual_pct + npnp_sp[1])
    for k in CATEGORY_KEYS:
        cats.setdefault(k, (0, 0.0))

    sum_sh = promoter[0] + public_sp[0] + npnp_sp[0]
    sum_pct = promoter[1] + public_sp[1] + npnp_sp[1]
    checks = {"sumPct": round(sum_pct, 4), "sumSharesPct": round(sum_sh / total_shares * 100, 4),
              "reportedTotalPct": total.get("pct") and round(total["pct"], 4)}
    checks["ok"] = abs(sum_sh / total_shares * 100 - 100) <= TOTALS_TOLERANCE_PCT
    if not checks["ok"]:
        out["problems"].append(f"category totals sum to {sum_sh / total_shares * 100:.3f}%, not 100 +/- 0.1")
    out["checks"] = checks
    out["promoterPct"] = round(promoter[1], 4)
    out["publicPct"] = round(public_sp[1], 4)

    # Named holders above 1%. Join the name context to its value context (same typed-member value).
    by_member: dict[tuple[str, str], list[str]] = {}
    for cid, c in contexts.items():
        for d, v in c["members"]:
            by_member.setdefault((d, v), []).append(cid)
    named = []
    for el in root:
        if _local(el.tag) != "NameOfTheShareholder":
            continue
        cr = el.get("contextRef")
        ctx = contexts.get(cr, {})
        axes = [(d, v) for d, v in ctx.get("members", []) if d.startswith("DetailsOf") or d.startswith("DetailsShares")]
        if len(axes) != 1 or not axes[0][0].endswith("Axis"):
            out["problems"].append(f"name {cr}: no single details axis")
            continue
        axis, member_value = axes[0][0], axes[0][1]
        base = re.sub(r"^(DetailsOfSharesHeldBy|DetailsSharesHeldBy|DetailsOf)", "", axis)[: -len("Axis")]
        # the value context carries the same typed value on the same axis (its id may differ: PAC_Public15 vs
        # DetailsOf...ForPublic15), and its facts are named either way (NumberOfShares / PercentageOfShareholdingByPAC)
        value_ctxs = [c for c in by_member.get((axis, member_value), []) if c != cr]
        f = {}
        for vc in value_ctxs:
            cand = facts.get(vc, {})
            if any(k in cand for k in ("NumberOfFullyPaidUpEquityShares", "NumberOfShares")):
                f = cand
                break
        value_ctx = value_ctxs[0] if value_ctxs else member_value
        shares = _num(f.get("NumberOfFullyPaidUpEquityShares", f.get("NumberOfShares", "")))
        pct = _num(f.get("ShareholdingAsAPercentageOfTotalNumberOfShares", f.get("PercentageOfShareholdingByPAC", "")))
        count = _num(f.get("NumberOfShareholders", "1"))
        name = (el.text or "").strip()
        if pct is None or shares is None:
            out["problems"].append(f"named holder {name!r}: no shares/pct in {value_ctx}")
            continue
        if count is not None and count != 1:
            continue  # an aggregate row (e.g. "Foreign Institutional Investors" with 9 holders), not one holder
        pct *= 100
        if pct < MIN_NAMED_PCT:
            continue
        if "ActingAsPersonsInConcert" in base:  # a public group filed as persons acting in concert (names a fund)
            cat, sub = "Other", "actingInConcert"
        elif base == "IndividualsOrHUF":
            cat, sub = "Other", "individual"
        else:
            cat, sub = NAMED_AXIS.get(base, ("Other", "unclassified"))
        if sub == "unclassified":
            out["unmapped"].append(f"named axis {base}")
        if shares > public_sp[0] and cat != "Promoter":  # bigger than the public total: promoter group (see above)
            cat, sub = "Promoter", "promoterGroup"
        named.append({"category": cat, "subType": sub, "holder": name, "shares": int(shares), "pct": round(pct, 4)})

    out["categories"] = {k: {"shares": cats[k][0], "pct": round(cats[k][1], 4)} for k in CATEGORY_KEYS}
    out["namedHolders"] = sorted(named, key=lambda h: -h["pct"])
    out["ok"] = True
    return out

