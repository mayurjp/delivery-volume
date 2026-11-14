# SOURCE_STATUS (Phase 0)

Probe date: trade date 2026-11-13 (Fri), run on 2026-11-14 (Sat) from the user's Windows PC (Python `requests`,
browser User-Agent, `Referer: https://www.nseindia.com/`, 1 request/second).
Command: `python -m pipeline verify-sources --date 2026-11-13 --json`. Reports: `reports/verify-sources-local-2026-11-13.json`
and `reports/verify-cookie-local-2026-11-13.json` (S8 and S16, run separately). Both reports are local artifacts (gitignored).

## Source x environment

"actions" is pending because the GitHub repo did not exist when this was written; the workflow
`.github/workflows/verify-sources.yml` (workflow_dispatch) is ready and uploads the report as an artifact.

| ID | Source | local: HTTP | local: rows | local: header OK | actions |
|----|--------|-------------|-------------|------------------|---------|
| S1 | sec_bhavdata_full | 200 (404 on holidays/weekends; see notes) | 3,566 (EQ 2,744) | yes | pending: GitHub repo not created yet |
| S2 | UDiFF CM bhavcopy | 200 | 3,727 | yes | pending: GitHub repo not created yet |
| S3 | UDiFF F&O bhavcopy | 200 | 43,553 (STO 35,971, IDO 6,915, STF 649, IDF 18) | yes | pending: GitHub repo not created yet |
| S4 | PR zip (mcap, bc, bh) | 200 | mcap 2,667 (ex-SME) | yes (all three) | pending: GitHub repo not created yet |
| S5 | participant OI | 200 | 5 (Client, DII, FII, Pro, TOTAL); Long == Short total | yes | pending: GitHub repo not created yet |
| S6 | participant volume | 200 | 5 | yes | pending: GitHub repo not created yet |
| S7 | FII derivatives stats (.xls) | 200 | 16 data rows | yes | pending: GitHub repo not created yet |
| S8 | FII/DII cash | 200 (cookie session) | 2 | yes | pending: GitHub repo not created yet |
| S9 | bulk deals | 200 | 136 | yes | pending: GitHub repo not created yet |
| S10 | block deals | 200 | 26 | yes | pending: GitHub repo not created yet |
| S11 | index constituents (9 files) | 200 x9 | 2,307 total | yes | pending: GitHub repo not created yet |
| S12 | all-index close | 200 | 167 | yes | pending: GitHub repo not created yet |
| S13 | 52-week high/low | 200 | 5,974 | yes | pending: GitHub repo not created yet |
| S14 | F&O ban list | 200 | 1 (KAYNES) | yes | pending: GitHub repo not created yet |
| S15 | EQUITY_L | 200 | 2,635 | yes | pending: GitHub repo not created yet |
| S16 | shareholding listing | 200 (cookie session, 3 variants) | per-symbol 23; date-range 4,153 | n/a (JSON) | pending: GitHub repo not created yet |

All 16 worked locally. No call was refused by the permission system.

## Findings that differ from the specs

1. **S1 and holidays.** NSE does not always 404 on a holiday. For 2026-11-10 (a market holiday) the S1 URL returned
   **200 with the previous trading day's file** (`DATE1` = 2026-11-09). The `DATE1` check is therefore mandatory;
   the pipeline treats a whole-file date mismatch as "missing". Conversely, Sunday 2026-11-08 (Diwali Muhurat session)
   does have an S1 file, so weekends must be probed.
2. **S14** is `Securities in Ban For Trade Date 04-NOV-2025: NIL` on one line when the list is empty (no second line).
3. **S4 `bc` PURPOSE** uses abbreviations (`INTDIV - RS 2 PER SH`, `FVSPLT FRM RS 10 TO RE 1`, `BUY BACK`, `BONUS 3:2`).
   Classification matches stems, not words.
4. **S8** category strings are `DII` and `FII/FPI` (no asterisks).
5. **Historical bulk-deals endpoint in the spec is dead** (`/api/historical/bulk-deals` -> HTTP 503). See S9/S10 below.

## Observed publish times

Only one probing time was possible (the morning after the trade date, so everything was already out), so the
17:00/18:00/19:00/21:00 IST sweep was **not** done. Indirect evidence: the PR zip members are stamped 16:35; the
S16 filings carry `broadcastDate` stamps such as `13-NOV-2026 14:41:06`. Re-run the workflow/command at the
required times once a schedule exists.

## S3: units of `OpnIntrst`

`OpnIntrst` is in **shares (quantity), not contracts**. Evidence from 2026-11-13: 100% of the 649 stock-futures rows have
OI that is an exact multiple of `NewBrdLotQty`, versus 0.5% for `TtlTradgVol`; `TtlTrfVal / (TtlTradgVol x ClsPric)` is
about the lot size (median 602, median lot 600), so **volume is in contracts** and **OI is in shares** (RELIANCE Nov
expiry: 120,643,500 shares = 241,287 contracts of 500). Not compared against NSE's website (no way to do that from
the pipeline); the arithmetic is self-consistent. Build-up classification uses % change only, so it is unaffected.

## S4 `bh` (price-band hits) header

`SYMBOL,SERIES,SECURITY,HIGH/LOW` (`H` or `L`). 251 rows on 2026-11-13 across EQ 74, BE 58, BZ 30, SM 56, ST 32, GS 1.
`bc` header as in the spec; `mcap` header as in the spec (trailing spaces on the last column name).

## S7 `.xls` layout (sheet1, 35 rows x 7 columns)

```
r0  FII DERIVATIVES STATISTICS FOR 13-Nov-2026
r1  ['', BUY, BUY, SELL, SELL, 'OPEN INTEREST AT THE END OF THE DAY', '']
r2  ['', 'No. of contracts', 'Amt in Crores', 'No. of contracts', 'Amt in Crores', 'No. of contracts', 'Amt in Crores']
r3  INDEX FUTURES        11374  1966.71  17575  3040.86  181012  30663.09
r4    BANKNIFTY FUTURES   4846   886.31   8470  1548.16   42681   7804.69
r5    FINNIFTY FUTURES      20     3.33     13     2.16     413     68.90
r6    MIDCPNIFTY FUTURES  1296   223.56    350    60.30   23218   4004.49
r7    NIFTY FUTURES       5206   852.42   8735  1428.96  114284  18709.40
r8    NIFTYFPI FUTURES       0     0.00      0     0.00       0      0.00
r9    NIFTYNXT50 FUTURES     6     1.09      7     1.27     416     75.61
r10 (blank)
r11 INDEX OPTIONS     7157094 1183680.34 7158398 1184253.71 3615017 604619.64
r12-r17 BANKNIFTY / FINNIFTY / MIDCPNIFTY / NIFTY / NIFTYFPI / NIFTYNXT50 OPTIONS
r18 (blank)
r19 STOCK FUTURES      275871  19030.37  300016  20543.44  6171737 413411.47
r20 (blank)
r21 STOCK OPTIONS      302710  22135.19  303412  22234.98  1543136 106999.04
r22-r25 blank; r26+ notes (value definitions)
```

All numbers are strings in the cells. Per-index sub-rows exist for index futures and index options only. Parser
(`pipeline/sources/s7_fii_stats.py`) emits `{category, level: total|instrument, buyContracts, buyAmtCr, sellContracts,
sellAmtCr, oiContracts, oiAmtCr}` and validates the four total rows. Storage and build are Phase 4.

## S8: FII/DII cash

Works from this PC with a `requests.Session` that first GETs `https://www.nseindia.com/` and
`https://www.nseindia.com/reports/fii-dii`, then calls `https://www.nseindia.com/api/fiidiiTradeReact` with
`Referer: https://www.nseindia.com/reports/fii-dii` and `Accept: application/json`. Payload: a JSON array of 2 objects
`{category: "DII" | "FII/FPI", date: "13-Nov-2026", buyValue, sellValue, netValue}` (keys only; values are strings in
Rs Cr). Latest day only. Not tested without cookies (the spec already notes a 301). **From GitHub Actions: pending.**
Open-source clients (nsepython, nselib) call the same URL; nsepython additionally uses `curl_cffi` (browser TLS
fingerprint) with warm-up, which suggests the Akamai layer may reject plain `requests` from datacenter IPs.

## S9/S10 and historical deals

Latest day only at `bulk.csv`/`block.csv` (file `Date` = 13-NOV-2026). The spec's historical URL
`/api/historical/bulk-deals?from=..&to=..` returned **HTTP 503 (retired)**. A working replacement, found in the
open-source `nsepython` source (`nse_largedeals_historical`) and confirmed once from this PC:
`https://www.nseindia.com/api/historicalOR/bulk-block-short-deals?optionType=bulk_deals|block_deals|short_selling&from=DD-MM-YYYY&to=DD-MM-YYYY`
(cookie session, Referer `https://www.nseindia.com/report-detail/display-bulk-and-block-deals`). Returns `{"data":[...]}`
with keys `BD_DT_DATE, BD_SYMBOL, BD_SCRIP_NAME, BD_CLIENT_NAME, BD_BUY_SELL, BD_QTY_TRD, BD_TP_WATP, BD_REMARKS`
(a 4-day window gave 70 bulk and 34 block rows). Not wired into `backfill-deals` (Phase 4, needs the user's OK since it
is not the URL the spec lists).

## S16: shareholding

**Endpoint discovery.** `nseindiapy` 0.1.0 (PyPI) has no shareholding endpoint. `nselib` 2.5.1 has none either.
`nsepython` 2.101 (`rahu.py`, `share_holding()`) uses `https://www.nseindia.com/api/top-corp-info?symbol=X&market=equities`,
which returns only summary percentages. The listing endpoint below is the one the NSE shareholding page uses; its
name came from my knowledge of the NSE site, not from those libraries, and was confirmed by probing.

**Listing (works, cookie-gated).** Warm up with `https://www.nseindia.com/` and
`https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern?symbol=RELIANCE`, then:

- Per symbol: `GET /api/corporate-share-holdings-master?index=equities&symbol=RELIANCE` returns 23 filings back to
  2021 (Referer = the page above). Keys: `symbol, name, date` (quarter end, `30-SEP-2026`), `pr_and_prgrp`, `public_val`,
  `employeeTrusts` (summary %), `submissionDate`, `broadcastDate`, `revisedData` (`N` / `Revised`), `xbrl` (URL),
  `xbrlFileSize`, `recordId`, plus free-text notes. `isin` is null here.
- **All companies at once (exists, preferred):** `GET /api/corporate-share-holdings-master?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY`
  filters by submission date. A 120-day window returned 4,153 filings for 2,402 distinct symbols (filing quarters
  30-Sep-2026: 2,372; 30-Jun-2026: 1,505; and stragglers), `isin` populated, 175 marked `Revised`. This cuts the
  request budget from about 14,000 to a few dozen listing calls plus one XBRL download per filing.
- `top-corp-info` also works (summary % per quarter for the last 5 quarters).

**XBRL location.** All 4,153 `xbrl` links point at `https://nsearchives.nseindia.com/corporate/xbrl/SHP_<id>_<ts>_WEB.xml`
(**no cookies**; downloaded from this PC with the standard archive headers; 0.5 MB for RELIANCE). Only the listing is
cookie-gated.

**Format across the backfill quarters.** RELIANCE for 30-Sep-2025, 31-Dec-2025, 31-Mar-2026, 30-Jun-2026 and
30-Sep-2026 were all downloaded. Namespace `http://www.bseindia.com/xbrl/shp/2025-05-31/in-bse-shp` is used for Sep-2025
and `.../2025-10-31/in-bse-shp` from Dec-2025. Category members are identical except one extra
`ForeignCompaniesMember` in Sep-2025, so one parser covers all four quarters (only the taxonomy namespace must be
matched by local name, not by URI). Checked on one large-cap only; small caps may omit categories.

**Element mapping (local names; instance values are fractions, 0.5044 = 50.44%).**
Facts are keyed by context. A context with one `explicitMember` on dimension `CategoryOfShareholdersAxis` carries the
category total through `NumberOfFullyPaidUpEquityShares` (shares) and `ShareholdingAsAPercentageOfTotalNumberOfShares`:

| 03 section 5.10 key | `CategoryOfShareholdersAxis` member |
|---|---|
| promoter | `ShareholdingOfPromoterAndPromoterGroupMember` |
| mf | `MutualFundsOrUTIMember` |
| insurance | `InsuranceCompaniesMember` |
| bank | `BanksMember` |
| pension | `ProvidentFundsOrPensionFundsMember` |
| aif | `AlternativeInvestmentFundsMember` |
| otherDii | `NBFCsRegisteredWithRBIMember`, `OtherFinancialInstitutionsMember`, `SovereignWealthFundsDomesticMember` (domestic institutions subtotal = `InstitutionsDomesticMember`) |
| fpi1 / fpi2 | `InstitutionsForeignPortfolioInvestorCategoryOneMember` / `...CategoryTwoMember` |
| fiiLegacy | `OtherInstitutionsForeignMember` (legacy "Foreign Institutional Investors" line; subtotal `InstitutionsForeignMember`) |
| fdi | `ForeignDirectInvestmentMember` |
| swf | no foreign SWF member seen for RELIANCE (domestic one is above); check other filings |
| retailSmall / retailLarge | `ResidentIndividualShareholdersHoldingNominalShareCapitalUpToRsTwoLakhMember` / `...InExcessOfRsTwoLakhMember` |
| corporate | `BodiesCorporateMember` |
| others | `NonResidentIndiansMember`, `ForeignNationalsMember`, `OtherNonInstitutionsMember`, government/IEPF members; `NonInstitutionsMember` is the subtotal |
| total | `ShareholdingPatternMember` (percent 1.0) |

Company facts (context `MainD`): `Symbol`, `ISIN`, `NameOfTheCompany`, `WhetherCompanyIsSME`, `DateOfReport`.
**Named holders (> 1%)**: a name fact `NameOfTheShareholder` sits in a context `D_<Category>_ContextN` whose
`typedMember` (dimension `DetailsOfSharesHeldBy<Category>Axis`, e.g. `...MutualFundsOrUTIAxis`, `...InsuranceCompaniesAxis`,
`...OtherInstitutionsForeignAxis`, `...ProvidentFundsOrPensionFundsAxis`) has value `<Category>_ContextN`; the shares and
percent are in the context with that same id. Join on the typedMember value. Example: `SBI Mutual Funds`, 338,019,479
shares, 2.54%. Note that RELIANCE lists no named FPI above 1% (only a generic "Foreign Institutional Investors" row),
so FPI named holders will often be absent.

## Not tested / open

- All sources from GitHub Actions (pending the repo and a workflow run).
- Observed publish-time sweep (needs runs at 17:00/18:00/19:00/21:00 IST on a trading day).
- Fixtures for 2 real XBRL files and parsing code are Phase 4B.
