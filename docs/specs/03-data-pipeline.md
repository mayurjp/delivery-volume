# 03 — Data Pipeline

## 1. CLI

All commands are idempotent and safe to re-run.

| Command | Behaviour |
|---------|-----------|
| `python -m pipeline verify-sources --date 2026-11-13` | Phase 0 tool. For every source S1–S17 it prints the HTTP status, byte size, detected header, row count and validation result. Exits non-zero if any VERIFIED source fails. `--json` writes a machine-readable report. |
| `python -m pipeline fetch --date D` / `--since D` / `--sources s1,s5` | Downloads into `store/`. Skips any file already stored, unless `--force`. |
| `python -m pipeline backfill --from 2025-11-01 [--to D]` | Loops `fetch` over the range for the sources that have history. Resumable. Prints progress and an ETA. |
| `python -m pipeline backfill-deals --from D --to D` | Optional, local only. Uses the cookie-gated historical bulk/block API (S9/S10 note). |
| `python -m pipeline fetch-shareholding [--backfill] [--quarter YYYY-MM-DD] [--symbols A,B] [--max-requests N]` | S16. Without `--backfill`, checks companies whose latest quarter is missing and that weren't checked in the last `recheckDays`, in market-cap rank order, capped at `maxRequestsPerRun`. `--backfill` fetches every quarter within `quartersBack`, uncapped unless `--max-requests` is given. Resumable. |
| `python -m pipeline build --out site/public/data` | Rebuilds all generated JSON from `store/`. Pure: no network access. |
| `python -m pipeline update [--no-build]` | `fetch` for the last `lookbackDaysForFetch` calendar days, for anything missing, then `build`. Honours each source's `runIn` setting. |
| `python -m pipeline status` | Coverage table: each source × the last 30 trading days (✓ / missing / n.a.), plus a list of gaps. |

The run environment is read from env `PIPELINE_ENV=actions|local` (default `local`). A source whose `runIn` excludes the current environment is skipped, and the skip is logged.

## 2. Configuration (`config/settings.json`)

```json
{
  "backfillFrom": "2025-11-01",
  "lookbackDaysForFetch": 7,
  "requestDelaySec": 1.0,
  "universeSeries": ["EQ"],
  "excludedSeries": ["SM", "ST"],
  "t2tSeries": ["BE", "BZ"],
  "windows": { "short": 5, "base": 20, "long": 50, "z": 60, "pctile": 250 },
  "minPeriodsFraction": 0.5,
  "liquidity": { "minTurnoverAvg20Cr": 1.0, "minBaseDelivValCr": 0.5 },
  "mcapBuckets": { "largeMaxRank": 100, "midMaxRank": 250, "smallMaxRank": 500 },
  "carryForwardMaxDays": 60,
  "sources": {
    "cm_delivery":     { "runIn": ["actions", "local"] },
    "cm_udiff":        { "runIn": ["actions", "local"] },
    "fo_udiff":        { "runIn": ["actions", "local"] },
    "pr_zip":          { "runIn": ["actions", "local"] },
    "participant_oi":  { "runIn": ["actions", "local"] },
    "participant_vol": { "runIn": ["actions", "local"] },
    "fii_stats":       { "runIn": ["actions", "local"] },
    "fii_dii_cash":    { "runIn": ["actions", "local"] },
    "deals":           { "runIn": ["actions", "local"] },
    "constituents":    { "runIn": ["actions", "local"] },
    "indices_close":   { "runIn": ["actions", "local"] },
    "hl52":            { "runIn": ["actions", "local"] },
    "fo_ban":          { "runIn": ["actions", "local"] },
    "equity_list":     { "runIn": ["actions", "local"] },
    "symbol_change":   { "runIn": ["actions", "local"] },
    "shareholding":    { "runIn": ["actions", "local"], "quartersBack": 4, "maxRequestsPerRun": 600, "recheckDays": 7 }
  }
}
```

## 3. Raw store layout (`store/`, committed)

```
store/
  calendar.json                          {"tradingDays": [...], "noData": {...}, "lastChecked": "..."}
  cm_delivery/2026/2026-11-13.csv.gz     S1 file exactly as downloaded (all series), gzipped
  cm_isin/2026/2026-11-13.csv.gz         S2 reduced: symbol, series, isin
  fo_extract/2026/2026-11-13.csv.gz      S3 reduced extract (below)
  mcap/2026/2026-11-13.csv.gz            S4 mcap: symbol, series, issueSize, mcapRs
  etf/2026/2026-11-13.csv.gz             S4 etf (ETFs traded that day): symbol, series. Written from 2026-11-13 onward; the build unions all days
  corp_actions/2026/2026-11-13.csv.gz    S4 bc, equity series only, + `kind` column
  band_hits/2026/2026-11-13.csv.gz       S4 bh as downloaded
  participant_oi/2026/2026-11-13.csv     S5 as downloaded
  participant_vol/2026/2026-11-13.csv    S6 as downloaded
  fii_stats/2026/2026-11-13.json         S7 parsed
  fii_dii_cash/2026.jsonl                S8, one JSON line per trade date (raw API payload + fetchedAt)
  deals/2026.csv                         S9+S10 merged, deduped: date,type,symbol,securityName,client,side,qty,price,remarks
  indices_close/2026/2026-11-13.csv.gz   S12
  hl52/2026/2026-11-13.csv.gz            S13
  fo_ban/2026/2026-11-13.txt             S14
  constituents/2026-11-09/*.csv          S11 snapshot folder, created only when any file changed
  equity_list/2026-11-09.csv.gz          S15 snapshot, created only when changed
  ref/symbolchange/2026-11-14.csv.gz     S17 symbol changes (whole file), created only when the content changed (gzip mtime 0)
  shareholding/index.json                per symbol: quarters stored, lastChecked, listing payload hash
  shareholding/2026-09-30/RELIANCE.xml.gz   S16 XBRL as downloaded (quarter-end folder; symbol via fileKey)
  shareholding/2026-09-30/RELIANCE.json  S16 parsed: category totals + named holders > 1% (03 §5.10 shape)
  logs/fetch-2026-11.jsonl               {ts, env, source, date, url, http, bytes, rows, status, ms, error}
```

Rules:

- Write atomically: write a temp file, validate it, then rename. **Never overwrite an existing dated file unless `--force` is given.**
- gzip with `mtime=0`, so identical content produces identical bytes and makes no git diff.
- Expected growth is about 200–250 KB per trading day, about 55 MB a year.

**`fo_extract` columns:** `symbol, instType, expiry, optType, oi, chgOi, volume, valueRs, close, settle, underlying`.

- Futures (`STF`, `IDF`): one row per symbol and expiry.
- Options (`STO`, `IDO`): **sum across strikes**, giving one row per symbol × expiry × optType.
- Strikes are not kept in v1.

## 4. Symbols, universe and series

- **Analytics universe** for a day: rows with `SERIES` in `universeSeries` (EQ). Rows in `excludedSeries` (SME: SM, ST) are dropped at parse time and appear in no generated file. The raw S1 file in `store/` still contains them, because it is stored exactly as downloaded.
- **BE/BZ days** stay in a symbol's history for price continuity, but with delivery fields null and flag `t2t`. They are excluded from every delivery average and ranking.
- **Symbol changes (S17, Phase 3C; supersedes the ISIN-only rule below, DEVIATIONS #70):** `store/ref/symbolchange/` is fetched with the other weekly reference snapshots (`fetch`, `backfill` and `update` re-check S11, S15 and S17 every 6 days) and in `verify-sources`. The build maps stored history under an old symbol to today's symbol **only for rows dated before the effective date**, transitively (LTI → LTIM → LTM). The ISIN timeline wins where both know the symbol. A mapped row that would collide with a row of the target symbol on the same date stays unmapped (symbol reuse), and an old symbol that trades again today is never mapped for undated uses. Every file family (`symbols/`, `cum/`, `daily/`, periods, stats) therefore sees one continuous series.
- **Symbol changes (ISIN):** build an ISIN→symbol timeline from `cm_isin` (and S15 snapshots). When a new symbol takes over an ISIN that an older symbol held, merge the history under the new symbol and keep `aliases: [old]`. If no ISIN data exists for a period, do not merge.
- **Filenames:** `fileKey(symbol)` keeps `[A-Za-z0-9-]` and replaces every other character with `_` plus its 2-digit uppercase hex code. For example, `M&M` becomes `M_26M` and `BAJAJ-AUTO` stays `BAJAJ-AUTO`. The key is emitted in `universe.json` as `f`. The frontend never derives it.
- **Sector:** from the latest TOTALMARKET constituents (S11), otherwise `"Unclassified"`.
- **Market cap:** `mcapCr = mcapRs / 1e7` from S4. Rank by `mcapCr` descending among universe stocks each day. Buckets: `L` rank 1–100, `M` 101–250, `S` 251–500, `U` (micro) 501+, `null` if no mcap. This follows SEBI's rank method (top 100 / 101–250). Splitting 251+ into Small and Micro is our own addition for usability. The UI must say so.
- **Index membership:** a bitmask over `meta.indices` order, plus a `FNO` bit from S3.

## 5. Generated JSON (`site/public/data/`, not committed)

Shared conventions:

- Minified JSON. Every file has `"schemaVersion": 1` and a JSON Schema in `pipeline/schemas/`. `build` validates every file it writes and fails on any violation.
- Table-shaped data uses `{"columns": [...], "rows": [[...], ...]}`. `null` means missing.
- Rounding: prices to 2 dp, % to 2 dp, ₹ Cr to 2 dp, ratios to 3 dp, quantities as integers.
- TypeScript types in `site/src/types/data.ts` must mirror the schemas exactly.

### 5.1 `meta.json`

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-13T19:42:10+05:30",
  "latestDate": "2026-11-13",
  "firstDate": "2025-11-03",
  "tradingDays": ["2025-11-03", "...", "2026-11-13"],
  "indices": ["NIFTY50","NIFTYNEXT50","NIFTY100","NIFTY200","NIFTY500","MIDCAP150","SMALLCAP250","MICROCAP250","TOTALMARKET","FNO"],
  "sectors": ["Automobile and Auto Components", "..."],
  "constituentsAsOf": "2026-11-09",
  "sources": {
    "cm_delivery":  { "latest": "2026-11-13", "gaps": [] },
    "fii_dii_cash": { "latest": "2026-11-13", "gaps": ["2026-10-21"], "collectingSince": "2026-11-17" }
  },
  "settings": { "minTurnoverAvg20Cr": 1.0, "minBaseDelivValCr": 0.5 }
}
```

### 5.2 `universe.json`

There is one row per symbol in the latest day's universe. Symbols with no trade in the last `carryForwardMaxDays` trading days are dropped.

```json
{ "schemaVersion": 1,
  "columns": ["sym","f","name","isin","sector","idx","mcapCr","mcapRank","bucket","listedOn","aliases","mcapEstimated","etf"],
  "rows": [["RELIANCE","RELIANCE","Reliance Industries Ltd.","INE002A01018","Oil Gas & Consumable Fuels",1023,1712345.67,1,"L","1995-11-29",[]]] }
```

`etf` (bool) marks ETFs and index funds (flag bit 512 in the daily files). An ETF keeps its metrics but has `mcapRank = null` and `bucket = null`: ETFs are excluded from market-cap ranking, so real companies keep correct Large/Mid/Small ranks. Detection rule: DEVIATIONS #32. Each `symbols/{f}.json` carries the same `etf` boolean in its meta (next to `bucket`).

### 5.3 `daily/{YYYY-MM-DD}.json`, one per trading day

Each file has one row per universe symbol that traded that day, plus t2t-series rows (flagged). Target size: ≤ 250 KB gzipped. **Only the newest `publish.dailyFullTradingDays` (260) days carry every column; older days carry the slim set** `meta.publish.dailySlimColumns` (07 §8). The F&O columns are not published until Phase 5 (DEVIATIONS #55).

| Column | Meaning (formulas in 04) |
|--------|--------------------------|
| `sym`, `series` | |
| `open`, `high`, `low`, `close`, `prevClose`, `vwap` | from S1 |
| `vol`, `turnoverCr`, `trades` | |
| `delivQty`, `delivPct`, `delivValCr` | |
| `delivValAvg5`, `delivValAvg20`, `delivValAvg50` | prior-N averages (exclude today) |
| `delivPctAvg20` | value-weighted, prior 20 |
| `volAvg20`, `turnoverAvg20Cr`, `tradeSizeRatio` | |
| `spike`, `delivPctDiff`, `relVol`, `ret1`, `clv`, `vwapGap` | |
| `delivPctZ60`, `delivPctPctile` | |
| `streak` | signed int: +k means k consecutive days above `delivPctAvg20`; −k means below |
| `signal` | `ACC` `DIS` `ABS` `SPU` `SPD` or null (04 §4). Always null for ETF rows (04 §4.1) |
| `flags` | bitmask, see the table below |
| `futOi`, `futOiChgPct`, `buildup`, `pcr` | F&O stocks only, otherwise null |

Flags bitmask:

| Bit | Name | Rule |
|-----|------|------|
| 1 | `t2t` | series is BE/BZ today |
| 2 | `corpAction` | an equity corporate-action ex-date within ±2 trading days (DIVIDEND, BONUS, SPLIT, RIGHTS, BUYBACK) |
| 4 | `bulkDeal` | the symbol has a bulk deal today |
| 8 | `blockDeal` | the symbol has a block deal today |
| 16 | `bandHit` | in S4 `bh` today |
| 32 | `fnoBan` | in S14 today |
| 64 | `high52` | today's high > `Adjusted_52_Week_High` in today's S13 file. S13 file(T) holds the 52-week values through T−1, so the rule is high(T) > file(T), never "the high date is today". Skip `-`/missing. |
| 128 | `low52` | low(T) < `Adjusted_52_Week_Low` in today's S13 file (same rule) |
| 256 | `lowLiquidity` | `turnoverAvg20Cr < minTurnoverAvg20Cr` |
| 512 | `etf` | the symbol is an ETF / index fund (set on every row of the symbol; rule in DEVIATIONS #32) |
| 1024 | `newListing` | fewer than 20 valid prior days |
| 2048 | `expiryWeek` | an F&O monthly expiry (any `STF` expiry date) within the next 5 trading days |

### 5.4 `cum/{YYYY-MM-DD}.json`: cumulative sums for range maths

There is one row per universe symbol. A symbol that did not trade that day is **carried forward** with its last values, for up to `carryForwardMaxDays`. File size is about 60 KB gzipped.

```json
{ "schemaVersion": 1, "date": "2026-11-13",
  "columns": ["sym","lastClose","lastTradeDate","cDelivValCr","cTurnoverCr","cDelivQty","cVol","cDays","cDelivValUpCr","cDelivValDnCr","cTrades"],
  "rows": [["RELIANCE", 1450.2, "2026-11-13", 912345.67, 2012345.12, 812345678, 1712345678, 253, 450123.4, 430222.1, 9123456]] }
```

- Every sum starts at the first store date and includes **valid delivery days only** (04 §1). `cDays` counts those days.
- `cDelivValUpCr` / `cDelivValDnCr` are the delivery value on days the close was above / below `prevClose`; `cTrades` sums the trades. They give `delivBalance` (up ÷ down) and `avgTradeSize` (turnover ÷ trades) for any range (08 §5A).
- For range R = [a, b], the sum is `X(b) − X(prev(a))`, where `prev(a)` is the trading day before `a`. If `a` is the first store date, or the symbol is absent from `cum/prev(a)`, treat the prior sum as 0 and flag the row `listedDuringRange`.

### 5.4b Timeframe files (Phase 3B, 08)

- `periods.json`: `{config, weekly[], monthly[], quarterly[]}`; each entry `{key,start,end,tradingDays,partial,daysIn,daysExpected,stocks,file?}` (start/end = first/last trading day). `config` holds the baselines, thresholds and liquidity floors the client's `aggregatePeriods` needs.
- `weekly/{weekEnd}.json`, `monthly/{YYYY-MM}.json`: slim columnar snapshots, columns `sym,days,open,high,low,close,prevClose,vwap,vol,turnoverCr,trades,delivQty,delivPct,delivValCr,ret,clv,avgTradeSize,delivBalance,delivValAvgN,delivPctAvgN,turnoverAvgCr,spike,delivPctDiff,relTurnover,tradeSizeRatio,delivPctZ,delivPctPctile,streak,signal,flags,adjusted`. No quarterly files.
- `market.json` gains `weekly`, `monthly`, `quarterly` blocks `{keys,ends,partial,groups,indexClose}`.
- `stats/signal_perf_periods.json`: forward excess returns after weekly / monthly signals (entry = close of the first trading day after the period; horizons 20 and 60 trading days for weekly, 63 and 126 for monthly).

### 5.5 `symbols/{f}.json`: full history of one stock

```json
{ "schemaVersion": 1, "sym": "RELIANCE", "name": "...", "sector": "...", "idx": 1023, "bucket": "L",
  "columns": ["date","series","open","high","low","close","prevClose","vwap","vol","turnoverCr","trades","delivQty","delivPct","delivValCr","delivPctAvg20","spike","signal","flags"],  // + futOi, futOiChgPct, buildup, pcr from Phase 5
  "rows": [ ... ],
  "deals": [{"date":"2026-11-13","type":"block","client":"...","entityId":"...","side":"BUY","qty":4200000,"price":246.75,"valueCr":103.64,"roundTrip":false}],
  "corpActions": [{"exDate":"2026-08-14","kind":"DIVIDEND","purpose":"DIVIDEND - RS 5.5 PER SHARE"}],
  "holdings": { "columns": ["quarter","filedOn","promoterPct","fiiPct","diiPct","mfPct","insurancePct","bankPct","pensionPct","otherDiiPct","retailPct","othersPct","totalShares"], "rows": [] },
  "namedHolders": { "columns": ["quarter","category","subType","holder","entityId","shares","pct"], "rows": [] },
  "dealFlows": { "columns": ["date","category","buyValueCr","sellValueCr","netValueCr"], "rows": [] } }
```

`dealFlows` has one row per date × category (`FII`, `DII`, `Other`) on which this stock had deals, with round trips excluded.

### 5.6 `market.json`: per-day aggregates by group

Groups:

- `ALL` (every **stock** in the universe, ETFs excluded);
- `IDX:<key>` for each index in `meta.indices`;
- `SEC:<sector>` (including `SEC:Unclassified`);
- `MC:L|M|S|U`;
- `ETF` (every ETF / index fund, flag 512, as its own group).

**Stocks only:** `ALL` and every `IDX:*`, `SEC:*` and `MC:*` group exclude ETFs (flag 512), so delivery %, turnover, advance/decline and spike counts describe companies. ETF creation/redemption activity would otherwise distort them. ETFs are only in the `ETF` group.

Membership for every date uses the *current* constituents and buckets.

```json
{ "schemaVersion": 1, "dates": ["..."],
  "groups": { "ALL": { "turnoverCr": [], "delivValCr": [], "delivPctW": [], "medianDelivPct": [], "adv": [], "dec": [], "unch": [], "spikeCount2x": [] },
              "IDX:NIFTY50": { "...": [] } },
  "indexClose": { "Nifty 50": [], "Nifty Next 50": [], "Nifty Bank": [], "Nifty Midcap 150": [], "Nifty Smallcap 250": [] } }
```

### 5.7 Institutional files

- `institutional/cash.json`: columns `date, fiiBuy, fiiSell, fiiNet, diiBuy, diiSell, diiNet` (₹ Cr), one row per trading day since collection began. A missing day gets a row with nulls.
- `institutional/participants.json`:
  - `oi` and `vol` tables, with columns `date, participant, futIdxLong, futIdxShort, futStkLong, futStkShort, optIdxCallLong, optIdxPutLong, optIdxCallShort, optIdxPutShort, optStkCallLong, optStkPutLong, optStkCallShort, optStkPutShort, totalLong, totalShort`;
  - participant is one of `FII, DII, Pro, Client`.
- `institutional/fii_deriv.json`: S7 parsed, one row per date per instrument category.

### 5.8 Deals and entities

- `deals/{YYYY}.json`: columns `date, type, sym, client, entityId, entityName, entityType, entityCategory, entityTypeInferred, side, qty, price, valueCr, roundTrip`. `entityCategory` is `FII | DII | Other` (04 §5.3).
- `deals/entities.json`: one row per entity: `entityId, entityName, entityType, entityCategory, aliases[], dealCount, buyValueCr, sellValueCr, netValueCr, firstDate, lastDate, topSymbols[]` (top 10 by gross value), plus `disclosedHoldingsCount` and `disclosedHoldingsQuarter` (from S16).
- `deals/flows.json`: per stock per category, for fast range maths. Columns `date, sym, category, buyValueCr, sellValueCr, netValueCr`, round trips excluded. The frontend sums over any range.

### 5.9 `stats/signal_perf.json` (Phase 3)

Forward excess returns after each delivery event, per 04 §6 (method, events, groups and the replication check live there).

```json
{ "schemaVersion": 1, "asOf": "2026-11-13", "window": { "from": "2025-11-03", "to": "2026-11-13" },
  "horizons": [1, 5, 20], "entries": ["t1", "t0"], "groups": ["ALL","L","M","S","U","IDX:NIFTY200"], "minN": 30,
  "events": [{ "id": "ACC", "label": "Up on heavy delivery (ACC)" }],
  "label": "Historical, one sample period, ...",
  "columns": ["event","group","entry","horizon","events","n","days","medianExcess","meanExcess","hitRate"],
  "rows": [["ACC","L","t1",20, 414, 400, 140, -1.04, 0.2, 44.2]] }
```

- `entry`: `t1` = enter at close(t+1) (the default), `t0` = enter at close(t).
- `events` = event count in the group; `n` = observations with a valid window at that horizon; `days` = distinct dates among them. `medianExcess` and `meanExcess` are in percent; `hitRate` is the percent of observations with excess > 0. All three are null when `n` = 0.
- The UI hides every cell with `n` < `minN`.
- Forward returns are close-to-close and drop any window that crosses a price adjustment (04 §6).

### 5.9a Smart Money Trail files (Phase 3C, 07 §6A)

- `trail/latest.json` and `trail/asof/{YYYY-MM-DD}.json` (month-end snapshots, only for days inside the published window; no lookahead, tested): `columns ["sym","strip","3M","6M","1Y"]`. A row is one stock eligible on the as-of day. `strip` is 52 characters of weekly codes (`A`, `D`, `N`, `-`). Each window cell is `null` or an array in `windowColumns` order: `codes` (4 characters, one per indicator: delivery balance, delivery % trend, trade size trend, spike persistence), `delivBal`, `delivPctTrend` (pp), `tradeSizeTrend` (%), `spikeDays`, `spikeUp`, `spikeDn`, `baseSpikeRate` (%), `upCr`, `dnCr`, `consA`, `consD` (% of the window's weeks), `flip` (`A→D`, `D→A` or null) and `flipSince` (the end date of the first week of the opposite run). Top level: `stripWeeks` (52 week-end dates), `indicators` (id, label, rule), `slots` (named deals, holdings, promoter, F&O: "arrives in Phase 4 / 4B / 5"), `config` (the thresholds the browser twin reads), `listSize`, and, in latest.json only, `snapshots` (the as-of dates that exist). `latest.json` has every eligible stock; as-of snapshots only stocks in any index list (today's membership: survivorship is labelled). Sector aggregates and insights are computed in the browser (DEVIATIONS #67).
- `stats/trail_perf.json`: the track record. `columns ["kind","id","window","horizon","n","dates","medianExcess","meanExcess","hitRate"]`; `kind` is `list` (strongA, strongD, flip, flipAD, flipDA) or `indicator` (`delivBal:A`, `delivBal:D`, `delivBal:N`, and so on); horizons 60 and 120 trading days; entry at close(t+1); excess against the median of the Nifty 500 eligible stocks on the same as-of date; windows crossing a price adjustment are dropped (DEVIATIONS #53); `asOfDates` lists the month-ends used.
- Schemas: `trail.schema.json`, `trail_perf.schema.json`. All trail outputs together are about 4.4 MB (budget 25 MB). Stock mode has no per-stock file: the browser computes it from `symbols/{f}.json` (`site/src/lib/trail.ts`, shared vectors `trailVectors.json`).

### 5.9b `stats/split_bonus.json`

Columns `sym, exDate, kind, purpose`: every SPLIT and BONUS ex-date in the stored corporate actions (alias-resolved). Period Compare and range mode use it for the ⚠ "corporate action in range" marker (04 §3), because the symbol files that also carry corporate actions are too many to load for a ranking.

### 5.10 Holdings files (S16, Phase 4B)

**Parsed store file** (`store/shareholding/{quarter}/{f}.json`):

```json
{ "sym": "RELIANCE", "quarter": "2026-09-30", "filedOn": "2026-10-18", "format": "2022",
  "totalShares": 13532472634,
  "categories": { "promoter": {"shares": 0, "pct": 0}, "mf": {}, "insurance": {}, "bank": {}, "pension": {}, "aif": {}, "otherDii": {},
                  "fpi1": {}, "fpi2": {}, "fiiLegacy": {}, "fdi": {}, "swf": {}, "retailSmall": {}, "retailLarge": {}, "corporate": {}, "others": {} },
  "namedHolders": [{ "category": "DII", "subType": "insurance", "holder": "LIFE INSURANCE CORPORATION OF INDIA", "shares": 0, "pct": 0 }] }
```

**Derived groupings** (one definition in `metrics.py`):

| Field | Sum of |
|-------|--------|
| `fiiPct` | `fpi1 + fpi2 + fiiLegacy` (FDI and SWF are shown separately, not in FII) |
| `diiPct` | `mf + insurance + bank + pension + aif + otherDii` |
| `retailPct` | `retailSmall + retailLarge` |
| `othersPct` | 100 − all of the above − promoter |

**Generated files:**

- `holdings/quarters.json`: the list of quarters, and for each quarter `filedCount`, `universeCount` and `complete`. A quarter is complete when ≥ 95% of the universe has filed, or 60 days have passed since quarter end.
- `holdings/{quarter}.json`: one row per stock. Columns: `sym, filedOn, promoterPct, fiiPct, diiPct, mfPct, insurancePct, retailPct, fiiChgPp, diiChgPp, mfChgPp, promoterChgPp, sharesChgPct, holderCount`. Each `*ChgPp` is against the previous quarter. `sharesChgPct` is the change in total shares, used to flag dilution or buybacks (04 §5.4).
- `holdings/holders/{quarter}.json`: every named holder > 1% across all stocks. Columns `sym, category, subType, holder, entityId, shares, pct, chg`, where `chg` is one of `NEW | UP | DOWN | SAME | EXITED`. `EXITED` rows are synthesised from the previous quarter.
- `holdings/aggregates.json`: per quarter per group (`ALL`, `IDX:*`, `SEC:*`, `MC:*`). Market-cap-weighted `promoterPct, fiiPct, diiPct, mfPct, retailPct`. Weights are the S4 market cap on the last trading day of the quarter.
- `holdings/latest.json`: an alias of the latest *complete* quarter's file, plus the in-progress quarter's rows wherever they exist. Each row carries a `quarter` column. The Screener joins this file.

## 6. Rolling-window implementation rules

- Compute per symbol in date order, over **valid delivery days only** (04 §1).
- "Prior N" windows exclude the current day: `series.shift(1).rolling(N, min_periods=ceil(N * minPeriodsFraction))`.
- Value-weighted averages are ratios of sums, never averages of ratios.
- Put every formula in `pipeline/metrics.py` and give each a unit test with hand-computed expected values.
- `build` rebuilds everything from `store/` every run. It must finish in **under 6 minutes for 3 years of data on a GitHub runner** (it was 3 minutes for 1 year; updated in Phase 3B). Text columns are plain `object` (pandas 3's str dtype is slow to group without pyarrow), group keys are integer codes, and table validation checks cell types with a column scan instead of per-cell jsonschema. Vectorise with pandas `groupby` and do not loop over rows in Python.

**Rolling publish window (07 §8, Phase 3C).** `publish.historyTradingDays` (default 750) limits the published files to the last N trading days: `daily/`, `cum/`, `weekly/`, `monthly/`, `symbols/` rows, `market.json`, `periods.json`, `meta.tradingDays` and `trail/asof/`. `store/` and every statistic (`stats/`, `trail_perf`) keep the whole history. `cum/` stays cumulative from the first stored day, so a range difference is the same with or without the clip (tested). `meta.publish` carries `historyTradingDays` and `storeFirstDate`; `meta.firstDate` is the first published day. Periods that start before the window are not published.

## 7. Scheduling and deployment

### `.github/workflows/update-and-deploy.yml`

```yaml
on:
  schedule:
    - cron: "30 13 * * 1-5"   # 19:00 IST: most daily files are out
    - cron: "30 16 * * 1-5"   # 22:00 IST: late files (participant data, FII stats)
    - cron: "30 2 * * 2-6"    # 08:00 IST next morning: catch-up
  workflow_dispatch:
    inputs: { backfill_from: { required: false } }
  push:
    branches: [main]
    paths: ["store/**", "pipeline/**", "config/**", "site/**"]
concurrency: { group: update-deploy, cancel-in-progress: false }
permissions: { contents: write, pages: write, id-token: write }
```

Jobs:

1. **update**
   - checkout, setup-python (pip cache);
   - skip the fetch step when the event is `push`;
   - otherwise run `PIPELINE_ENV=actions python -m pipeline update --no-build`;
   - on the 08:00 IST catch-up run only, also run `python -m pipeline fetch-shareholding`, capped by `maxRequestsPerRun`. That is about 10 minutes, so each company is re-checked roughly weekly;
   - if `store/` changed, commit `data: <latest date>` and push. Pushes made with `GITHUB_TOKEN` do not start new workflow runs, so this cannot loop.
2. **build**
   - `python -m pipeline build`;
   - setup-node, then `npm ci && npm run build` in `site/` with `VITE_BASE=/<repo>/`;
   - upload the pages artifact.
3. **deploy**: `actions/deploy-pages`.

Notes:

- GitHub may start scheduled runs 5–60 minutes late. That is acceptable.
- GitHub disables scheduled workflows in public repos after 60 days with no repo activity. The daily data commits count as activity.
- If S1 has been missing for 2 consecutive weekdays while other sources show those days as trading days, open a GitHub issue using `gh issue create` (nice-to-have).

### Local fallback (Windows)

`scripts/update_local.ps1`:

1. activate `.venv`;
2. run `$env:PIPELINE_ENV='local'; python -m pipeline update --no-build`;
3. `git add store`; commit only if something changed; `git pull --rebase`; `git push`.

The push then triggers the build and deploy jobs. README.md must document:

- creating the venv;
- a Task Scheduler entry for weekdays at 19:30 and 22:30 IST, with "run task as soon as possible after a scheduled start is missed";
- that the PC must be on, and that a `git pull` happens before every run.

## 8. Backfill plan

| Sources | Backfill |
|---------|----------|
| S1, S2, S3, S4, S5, S6, S7, S12, S13, S14 | From `backfillFrom` |
| S11, S15 | Current snapshot only |
| S8 (FII/DII cash) | **None possible.** Starts on the first scheduled run. `meta.sources.fii_dii_cash.collectingSince` tells the UI. |
| S9/S10 (deals) | Forward from the daily files, plus `backfill-deals` (historicalOR endpoint; user-approved 2026-11-14, bulk and block only, capped at 70 records per request, so it is split to single days and a day above the cap is recorded as truncated in `store/deals/_backfill.json`) |
| S16 (shareholding) | 4 quarters via `fetch-shareholding --backfill`. About 4 hours, resumable, ideally run locally. Commit every 250 companies. |

- About 260 trading days × 10 files ≈ 2,600 requests ≈ 45–60 minutes at 1 request/second.
- Run it once, locally or through `workflow_dispatch` with `backfill_from`. The job timeout must allow it.
- Commit after each month of data, so a failure does not lose progress.

## 9. Failure handling

| Situation | Behaviour |
|-----------|-----------|
| 404 on a weekday at the 19:00 run | Normal. Retried at 22:00 and 08:00. |
| Header or schema mismatch | Do not store the file. Log `schema_mismatch` with the received header. The run exits 0 but writes an annotation (`::warning::`). |
| One source keeps failing | Its `meta.sources[x].latest` falls behind and the UI shows an amber badge. Other sources continue. |
| S1 present but S4 mcap missing | Use the most recent previous `issueSize × today's close` to estimate mcap, and flag `mcapEstimated` in the universe. |
| S8 blocked | Logged. The UI shows the gap. Never interpolated. |

## 10. Pipeline tests (pytest)

- **Fixtures:** trimmed real files (about 30 rows each) in `pipeline/tests/fixtures/`. Include an EQ row, a BE row with `-` delivery, an SM row, the title line in the participant files, the padded mcap fields, and the disclaimer lines in the 52-week file.
- **Parser tests:** header stripping, `-` becoming null, date parsing for every format in 02 §0, lakh→crore conversion.
- **Metric tests:** synthetic 30-day series with hand-computed `delivValAvg20`, `delivPctAvg20` (value-weighted), `spike`, `streak`, `clv`, z-score and percentile.
- **Cumulative test:** a range sum taken from cum files equals the direct sum over daily rows, for 5 random ranges and symbols, including a symbol listed mid-range.
- **Symbol-change merge test**, deal dedupe test, round-trip detection test, entity normalisation and FII/DII categorisation test, signal-classification boundary tests.
- **Shareholding test:** parse 2 real XBRL fixtures (one large-cap, one small-cap). The category %s must sum to 100 ± 0.1. Named holders > 1% must be extracted. The QoQ `chg` labels (`NEW`, `UP`, `DOWN`, `EXITED`) must be correct on a synthetic two-quarter pair.
- **Golden test:** `build` on a fixture store produces JSON that validates against the schemas and matches a stored snapshot.
