# 02 — Data Sources

Status legend:

- **VERIFIED**: downloaded and inspected on 2026-11-14 (trade date 13-Nov-2026) from a residential connection in India.
- **UNVERIFIED**: endpoint known but not yet confirmed. Phase 0 must confirm it.

All sources must be re-verified **from a GitHub Actions runner** in Phase 0. The runners sit in US datacenters, and NSE treats datacenter traffic differently.

## 0. General HTTP rules

- Headers on every request: a current desktop-Chrome `User-Agent`, `Referer: https://www.nseindia.com/`, `Accept: */*`, `Accept-Language: en-US,en;q=0.9`.
- At most 1 request/second, sequential only.
- Retries: 3 attempts with backoff of 2 s, 6 s and 18 s, on timeouts, 5xx, 429 and connection resets. Timeout 30 s.
- **HTTP 404 means "not published (yet)"**, not an error. Log it as `missing`.
- Validate every body before storing it. NSE sometimes returns `200` with an HTML error page. Check the zip magic bytes (`PK`) for zips, the expected header row for CSVs, and the `CDFV2`/BIFF signature for `.xls`.
- Date tokens used in URLs:

| Token | Example for 13-Nov-2026 |
|-------|-------------------------|
| `DDMMYYYY` | `13112026` |
| `DDMMYY` | `131126` |
| `YYYYMMDD` | `20261113` |
| `DD-Mon-YYYY` | `13-Nov-2026` |

## 1. Source catalogue

| ID | Source | Frequency | History available? | Status |
|----|--------|-----------|--------------------|--------|
| S1 | Security-wise delivery (`sec_bhavdata_full`) | Daily | Yes (2024 file verified) | VERIFIED |
| S2 | UDiFF CM bhavcopy (ISIN map) | Daily | Yes | VERIFIED |
| S3 | UDiFF F&O bhavcopy | Daily | From 08-Jul-2024 in this format | VERIFIED |
| S4 | PR zip: market cap, corporate actions, price-band hits | Daily | Yes | VERIFIED |
| S5 | Participant-wise open interest | Daily | Yes | VERIFIED |
| S6 | Participant-wise trading volume | Daily | Yes | VERIFIED |
| S7 | FII derivatives statistics (`.xls`) | Daily | Yes | VERIFIED (layout not yet parsed) |
| S8 | FII/DII cash-market activity (provisional) | Daily | **No: latest day only** | UNVERIFIED (cookie-gated API) |
| S9 | Bulk deals | Daily | **Latest day only** from this URL | VERIFIED |
| S10 | Block deals | Daily | **Latest day only** from this URL | VERIFIED |
| S11 | Index constituents (+ sector) | When changed | Current only | VERIFIED |
| S12 | All-index closing values | Daily | Yes | VERIFIED |
| S13 | 52-week high/low | Daily | Yes | VERIFIED |
| S14 | F&O ban list | Daily | Yes | VERIFIED |
| S15 | Equity master list (`EQUITY_L.csv`) | When changed | Current only | VERIFIED |
| S16 | Shareholding-pattern filings (per company) | Quarterly | Yes (past quarters per company) | UNVERIFIED (cookie-gated API) |

---

## S1 — Security-wise delivery (primary source)

```
https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{DDMMYYYY}.csv
```

Size about 400 KB and about 3,570 rows. The 2024 file `sec_bhavdata_full_13112024.csv` also downloaded, so backfill works.

Header (exactly as served, with a space after every comma):

```
SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
```

Sample rows:

```
20MICRONS, EQ, 13-Nov-2026, 186.95, 185.60, 186.72, 182.26, 184.75, 184.09, 184.85, 37270, 68.90, 1524, 20990, 56.32
21STCENMGM, BE, 13-Nov-2026, 55.04, 55.04, 55.90, 54.00, 54.10, 54.10, 54.55, 6389, 3.49, 57, -, -
AATMAJ, SM, 13-Nov-2026, 25.70, 26.95, 26.95, 25.30, 26.80, 26.40, 26.29, 26000, 6.84, 13, 16000, 61.54
```

Quirks:

- Parse with `skipinitialspace=True` and strip every header and every string value.
- `DELIV_QTY` and `DELIV_PER` are `-` for trade-for-trade series (BE, BZ) and for GS, GB and similar instruments. In trade-for-trade, every trade must be delivered, so the figure carries no information. Parse `-` as **null, never 0**.
- `AVG_PRICE` is the VWAP. `TURNOVER_LACS` is in ₹ lakh, so ₹ Cr = value / 100.
- `DATE1` has the format `13-Nov-2026`. Check that it matches the requested date.
- Row counts by series on 13-Nov-2026: EQ 2744, SM 387, BE 206, ST 85, GS 48, GB 42, BZ 34, IV 10, RR 6, E1 4. No EQ row had `-` delivery that day.
- SME series (SM, ST) do have delivery values, but the user has **excluded them**. Drop them at parse time.
- A stock can move between EQ and BE (into or out of trade-for-trade). Key history by `SYMBOL`, and record the series for each day.

Validation: the header matches; total rows are between 2,000 and 8,000; EQ rows ≥ 1,500; at least 99% of numeric fields parse.

## S2 — UDiFF CM bhavcopy (used for the ISIN map)

```
https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{YYYYMMDD}_F_0000.csv.zip
```

A zip containing one CSV with the same name minus `.zip`. Common UDiFF header:

```
TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4
```

Store only `TckrSymb, SctySrs, ISIN` (a tiny file). It is used to detect symbol changes (03 §4). The bhavcopy has no delivery fields, so S1 stays the primary source.

## S3 — UDiFF F&O bhavcopy

```
https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{YYYYMMDD}_F_0000.csv.zip
```

About 1.4 MB zipped. Same header as S2.

- `FinInstrmTp`: `STF` stock futures, `IDF` index futures, `STO` stock options, `IDO` index options. `OptnTp`: `CE` / `PE`. `XpryDt` is the expiry.
- Sample: `2026-11-13,2026-11-13,FO,NSE,STO,68351,,ABCAPITAL,,2026-12-29,2026-12-29,365.00,PE,ABCAPITAL26DEC365PE,...,408.00,3.76,0,0,0,0.00,0,F1,1550,,,,,`
- **Units of `OpnIntrst` (contracts or shares): verify in Phase 0** by comparing one symbol with NSE's website. Build-up classification uses % change only, so the units do not affect it, but label the units correctly in the UI.
- This format starts on 08-Jul-2024. The default backfill (2025-11-01) is inside it, so ignore the older format.
- **Do not store the raw file** (about 350 MB a year). Store a reduced extract (03 §3).
- The F&O universe is the set of unique `TckrSymb` with `STF` rows on that date.

## S4 — PR zip (market cap, corporate actions, price-band hits)

```
https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{DDMMYY}.zip
```

About 680 KB. Verified contents: `an, bc, bh, bm, corpbond, etf, gl, hl, mcap, pd, pr, readme, sme, tt`, each named `{prefix}{DDMMYYYY}.csv|txt`. Use these three:

**mcap{DDMMYYYY}.csv**: full market cap per security.

```
Trade Date,Symbol,Series,Security Name,Category,Last Trade Date,Face Value(Rs.),Issue Size,Close Price/Paid up value(Rs.),Market Cap(Rs.)
13 NOV 2026,20MICRONS,EQ,20 MICRONS LTD           ,Listed    ,13 NOV 2026,               5.00,          35286502,            184.10,     6495892153.20
```

- Every field is space-padded, so strip them all. `Trade Date` has the format `13 NOV 2026`. `Market Cap(Rs.)` is in rupees and is *full* market cap, not free-float. `Issue Size` is shares outstanding.
- Store only `symbol, series, issueSize, mcapRs`.

**bc{DDMMYYYY}.csv**: corporate actions (announced and upcoming).

```
SERIES,SYMBOL,SECURITY,RECORD_DT,BC_STRT_DT,BC_END_DT,EX_DT,ND_STRT_DT,ND_END_DT,PURPOSE
```

- Contains debt instruments too. Keep only the equity series (EQ, BE, BZ, SM, ST).
- `PURPOSE` is free text, e.g. "DIVIDEND - RS 5 PER SHARE", "BONUS 1:1", "FACE VALUE SPLIT", "BUYBACK". Classify it by keyword into `DIVIDEND | BONUS | SPLIT | RIGHTS | BUYBACK | OTHER`.

**bh{DDMMYYYY}.csv**: securities that hit their price band (circuit) that day. **Dump and record the header in Phase 0.**

## S5 — Participant-wise open interest

```
https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_{DDMMYYYY}.csv
```

Line 1 is a title, so skip it. Line 2 is the header. Some names have trailing spaces, so strip them:

```
Client Type,Future Index Long,Future Index Short,Future Stock Long,Future Stock Short,Option Index Call Long,Option Index Put Long,Option Index Call Short,Option Index Put Short,Option Stock Call Long,Option Stock Put Long,Option Stock Call Short,Option Stock Put Short,Total Long Contracts,Total Short Contracts
FII,62546,118466,3586466,2585271,755197,1137053,972780,749988,337709,419459,450575,335393,6298430,5212472
```

Rows: `Client, DII, FII, Pro, TOTAL`. Units: number of contracts. Validation: Long totals equal Short totals in the TOTAL row.

## S6 — Participant-wise trading volume

```
https://nsearchives.nseindia.com/content/nsccl/fao_participant_vol_{DDMMYYYY}.csv
```

Identical layout to S5. Values are contracts traded that day.

## S7 — FII derivatives statistics

```
https://nsearchives.nseindia.com/content/fo/fii_stats_{DD-Mon-YYYY}.xls      e.g. fii_stats_13-Nov-2026.xls
```

A legacy Excel file (CDFV2/BIFF, about 9 KB), parsed with `xlrd`. **Phase 0: dump every row and record the layout in SOURCE_STATUS.md.** Expected rows are INDEX FUTURES, INDEX OPTIONS, STOCK FUTURES and STOCK OPTIONS (maybe also per-index rows), each with buy contracts, buy amount (₹ Cr), sell contracts, sell amount (₹ Cr), open-interest contracts and OI amount. Store the parsed result as JSON.

## S8 — FII/DII cash-market activity (provisional)

```
https://www.nseindia.com/api/fiidiiTradeReact          UNVERIFIED
```

- Calling it without cookies returns `301`, which was observed. The usual pattern is a `requests.Session()` that first GETs `https://www.nseindia.com/` and `https://www.nseindia.com/reports/fii-dii` to collect cookies. It then calls the API with the same session and `Referer: https://www.nseindia.com/reports/fii-dii`.
- Expected JSON: an array of `{ "category": "DII **" | "FII/FPI *", "date": "13-Nov-2026", "buyValue": "...", "sellValue": "...", "netValue": "..." }`, values in ₹ Cr, possibly as strings.
- What this number is:
  - **one combined figure for all FIIs/FPIs and one for all DIIs**, not per institution and not per stock;
  - it covers the cash market across NSE, BSE and MSEI;
  - it is **provisional**.
- **It returns only the latest day.** The pipeline must capture it every trading day; missed days cannot be recovered from NSE. Record gaps and never interpolate.
- Risk: `www.nseindia.com/api/*` often rejects datacenter IPs. If it fails from GitHub Actions in Phase 0, set `config/settings.json → sources.fii_dii_cash.runIn = ["local"]` so it runs only from the user's PC (03 §7). Ask the user before using any non-NSE substitute (e.g. NSDL's FPI daily reports).

## S9 / S10 — Bulk and block deals

```
https://nsearchives.nseindia.com/content/equities/bulk.csv
https://nsearchives.nseindia.com/content/equities/block.csv
```

```
bulk:  Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price,Remarks
block: Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price
13-NOV-2026,MEESHO,Meesho Limited,ADITYA BIRLA SUN LIFE MUTUAL FUND,BUY,4200000,246.75
```

- **These URLs hold only the most recent trading day.** Take the date from the `Date` column (format `13-NOV-2026`), never from the run date. If the job runs before NSE publishes, it receives the previous day's file again. Dedupe on `(date, type, symbol, client, side, qty, price)`.
- A bulk deal is any client trading more than 0.5% of a company's listed shares in one day. A block deal is a large single trade done in the separate block-deal window. These are the **only NSE daily data that name the institution**.
- Optional historical backfill (UNVERIFIED, cookie-gated like S8): `https://www.nseindia.com/api/historical/bulk-deals?from=DD-MM-YYYY&to=DD-MM-YYYY` and `.../block-deals?...`. Offer it as a one-time local command, `pipeline backfill-deals`. It is not required.

## S11 — Index constituents (and sector)

```
https://nsearchives.nseindia.com/content/indices/{file}
```

| Index key | File | Rows |
|-----------|------|------|
| NIFTY50 | `ind_nifty50list.csv` | 50 |
| NIFTYNEXT50 (Junior Nifty) | `ind_niftynext50list.csv` | 50 |
| NIFTY100 | `ind_nifty100list.csv` | 100 |
| NIFTY200 | `ind_nifty200list.csv` | 200 |
| NIFTY500 | `ind_nifty500list.csv` | 500 |
| MIDCAP150 | `ind_niftymidcap150list.csv` | 150 |
| SMALLCAP250 | `ind_niftysmallcap250list.csv` | 250 |
| MICROCAP250 | `ind_niftymicrocap250_list.csv` (note `_list`) | 250 |
| TOTALMARKET | `ind_niftytotalmarket_list.csv` (note `_list`) | 750 |

Header: `Company Name,Industry,Symbol,Series,ISIN Code`.

- The `Industry` column has about 20 values (e.g. "Financial Services", "Metals & Mining"). Use it as **Sector**. Take it from TOTALMARKET, which covers 750 stocks. Every other stock gets the sector `"Unclassified"`.
- Fetch every Monday (and on manual runs). Store a new snapshot only when the content changes. Only current membership is available, so the UI must say that filters use today's constituents.
- The F&O stock list comes from S3, not from here.

## S12 — All-index closing values

```
https://nsearchives.nseindia.com/content/indices/ind_close_all_{DDMMYYYY}.csv
```

```
Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield
Nifty 50,13-11-2026,25209.85,25246.35,25054.4,25144.3,-155.05,-.61,239573267,25397.2,20.49,3.08,1.4
```

`Index Date` has the format `dd-mm-yyyy`. Values like `-.61` must parse. This file is used for the Nifty overlays on charts.

## S13 — 52-week high/low (adjusted)

```
https://nsearchives.nseindia.com/content/CM_52_wk_High_low_{DDMMYYYY}.csv
```

Two quoted disclaimer lines come first, then:

```
"SYMBOL","SERIES","Adjusted_52_Week_High","52_Week_High_Date","Adjusted_52_Week_Low","52_Week_Low_DT"
```

`-` means no value. Values are adjusted for corporate actions. Used for the new-52-week-high/low flags.

## S14 — F&O ban list

```
https://nsearchives.nseindia.com/archives/fo/sec_ban/fo_secban_{DDMMYYYY}.csv
```

```
Securities in Ban For Trade Date 13-NOV-2026:
1,KAYNES
```

Shown as an info badge only.

## S15 — Equity master list

```
https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv
```

```
SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
20MICRONS,20 Microns Limited,EQ,06-OCT-2008,5,1,INE144J01027,5
```

The header has leading spaces. Gives company names, ISIN and listing date. Fetch weekly and snapshot when it changes.

## S16 — Shareholding pattern (quarterly, SEBI LODR Regulation 31)

Companies file within 21 days after each quarter end (31 Mar, 30 Jun, 30 Sep, 31 Dec). Some file late. NSE shows the filings on this web page:

```
https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern?symbol={SYMBOL}
```

**Listing endpoint (UNVERIFIED).**

- The page loads its data from a JSON call, believed to be `https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol={SYMBOL}`. It is cookie-gated like S8.
- It is expected to return one entry per filed quarter, with summary % (promoter & promoter group, public) and a link to the filing's XBRL file.
- Phase 0 must:
  - confirm the exact URL and payload. If needed, read the source of a maintained open-source NSE client (for example `nseindiapy` on GitHub) to see which endpoint it calls;
  - check whether a date-range variant lists **all companies' filings at once**. That variant is preferred, because it needs far fewer requests.

**XBRL file (UNVERIFIED).** Each filing is published in the Regulation 31 shareholding taxonomy (see NSE's "XBRL information" page). Check whether the XBRL link points to `nsearchives.nseindia.com` (no cookies; should work from Actions) or to `www.nseindia.com` (cookie-gated).

**Extract per company per quarter.** Map the exact XBRL element names in Phase 0 and record them in SOURCE_STATUS.md.

- **Category totals** (shares and % of total):
  - Promoter & promoter group.
  - Institutions (Domestic): Mutual Funds, Insurance Companies, Banks, Provident/Pension Funds, Alternative Investment Funds, NBFCs and other financial institutions.
  - Institutions (Foreign): Foreign Portfolio Investors Category I and II (plus any legacy "Foreign Institutional Investors" line), Foreign Direct Investment, Sovereign Wealth Funds.
  - Non-institutions: resident individuals (≤ ₹2 lakh and > ₹2 lakh nominal capital, where present), bodies corporate, others.
  - Total shares.
- **Named shareholders holding more than 1%** within each public category: name, shares and %. This is the **only** NSE source that says *which* FII or DII holds a stock.
- SEBI revised the format over time, and older filings grouped domestic and foreign institutions differently. Phase 0 must check that all 4 quarters in the backfill window share one layout. If they don't, map both layouts.

**Request budget.**

- Per-symbol listing needs about 2,750 companies × (1 listing call + 1 XBRL per new quarter).
- Backfilling 4 quarters ≈ 14,000 requests ≈ 4 hours at 1 request/second. It must be resumable and capped per run (03 §2). A date-range listing, if it exists, cuts this sharply.

## 2. Trading calendar

There is no holiday API. **A trading day is a date for which S1 exists.**

- On each run, probe every calendar date in the lookback window (default 7 days), **weekends included**. Special sessions such as Diwali Muhurat trading can fall on a weekend.
- Record results in `store/calendar.json`. A date that is still missing after the next morning's catch-up run is marked `no-data`, and is re-checked for 3 more days before it is treated as final.

## 3. Known gaps and not-used sources

| Item | Why it is not in v1 |
|------|---------------------|
| BSE delivery data | NSE has well over 90% of cash-equity turnover. BSE uses scrip codes, so it needs an ISIN merge. Phase 6 option. |
| Per-stock or per-institution *daily* FII/DII buy/sell | Not published by NSE or anyone else. Closest proxies: S9/S10 deals (daily, large trades only, named) and S16 holdings (quarterly, % plus named holders > 1%). |
| Monthly mutual-fund portfolios | Published by each AMC, not by NSE. Not in v1. |
| Short-selling reports | Not verified. Do not add without asking. |
| Historical FII/DII cash data from NSE | Not available from NSE. Collect from day one. |
