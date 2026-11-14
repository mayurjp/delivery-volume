# 01 — Product and Architecture

## 1. Purpose

A free, static website that shows, for NSE-listed stocks:

- how much of each day's traded volume ended in actual **delivery** (a change of ownership) instead of being squared off intraday;
- how delivery changes over any chosen date range, against a baseline;
- whether price moves are backed by delivery (conviction) or not (speculation);
- what FIIs and DIIs are doing, using the aggregate data NSE publishes, plus named large investors from bulk and block deals.

Data is end-of-day only. It updates once each trading evening.

## 2. Users and the questions the site must answer

Primary user: an Indian retail investor or trader who checks after market close (after about 19:00 IST), on a phone or a laptop.

| ID | Question | Where it is answered |
|----|----------|----------------------|
| Q1 | Which stocks had unusually high (or low) delivery today compared with their own normal? | Dashboard, Screener |
| Q2 | Over a date range I choose, whose delivery rose or fell the most against a baseline period? | Period Compare |
| Q3 | Is this price move backed by delivery (accumulation/distribution) or is it speculative? | Signals on every page, quadrant scatter |
| Q4 | What are FIIs and DIIs doing in the cash market and in derivatives? | Institutions |
| Q5 | Which named big investors did bulk or block deals, and in which stocks? | Deals & Entities |
| Q6 | Traded vs delivered statistics for the market, an index, a sector, or a market-cap bucket | Market Statistics, Stock page |
| Q7 | Where is delivery concentrated right now? | Heat maps |
| Q8 | Are FIIs or DIIs adding to or cutting this stock, and which named FIIs/DIIs hold it? | Stock page → Ownership; Institutions → Holdings; Deals |

## 3. Scope

### In scope (v1, Phases 0–5)

- F1 Daily delivery metrics for every EQ-series stock. SME series (SM, ST) are excluded.
- F2 Top lists: delivery spikes and drops, highest delivery %, largest delivery value, accumulation/distribution signals.
- F3 Any date-range comparison against a baseline period.
- F4 Filters: index membership (Nifty 50, Nifty Next 50 a.k.a. "Junior Nifty", Nifty 100, 200, 500, Midcap 150, Smallcap 250, Microcap 250, Total Market, F&O stocks), market-cap bucket, sector, minimum turnover, watchlist.
- F5 Heat maps: sector/stock treemap, sector×day grid, per-stock calendar.
- F6 Stock detail page: price, stacked delivered/non-delivered volume, delivery % with bands, deals and corporate-action markers, F&O open interest.
- F7 FII/DII cash flows (aggregate, provisional) with history accumulated from the day collection starts.
- F8 Participant-wise derivatives positioning (FII / DII / Pro / Client), from NSE archives, with backfill.
- F9 Bulk and block deals with client names, normalised into "entities" (e.g. all "GOLDMAN SACHS …" accounts become one entity).
- F10 F&O open-interest build-up classification and PCR for F&O stocks.
- F11 Market statistics: delivery % trends by index, sector and cap bucket; distributions.
- F12 Learn page explaining how to read delivery data, and its traps.
- F13 Historical performance of each signal (forward returns), clearly labelled as historical.
- F14 **FII vs DII per stock from bulk/block deals.**
  - Every named deal client is classified as FII, DII or Other.
  - The site shows each stock's FII and DII deal flows (buy, sell, net) and gives every institution its own page.
  - Updated daily, but it covers large trades only.
- F15 **Quarterly shareholding per stock.**
  - Promoter / FII / DII (with MF, insurance, banks, pension split out) / retail %, with quarter-on-quarter change.
  - The named institutions holding more than 1%, from NSE shareholding-pattern filings.
  - Rankings of the largest FII and DII stake increases and cuts.

### Out of scope for v1

BSE data, intraday or live data, user accounts, server-side alerts, SAST/insider disclosures, monthly mutual-fund portfolios (published by each AMC, not by NSE), any buy/sell recommendations. Phase 6 lists the optional later items.

## 4. Architecture

```
            ┌──────────────────────── GitHub Actions (cron, weekday evenings IST) ───────────────────────┐
            │                                                                                           │
 NSE  ──────┤  python -m pipeline update        python -m pipeline build         npm run build           │
 archives   │  (download + validate)   ──►      (derive JSON from store)  ──►   (Vite, site/)  ──► deploy-pages
 (+1 API)   │          │                                 │                                              │
            │          ▼                                 ▼                                              │
            │   store/  (committed,               site/public/data/*.json                                │
            │   append-only raw files)            (generated every run, NOT committed)                   │
            └───────────────────────────────────────────────────────────────────────────────────────────┘
                       ▲
                       │ fallback: the same `pipeline update` run on the user's Windows PC
                       │ by Task Scheduler, then `git push` → the push triggers build + deploy

 Browser ──► GitHub Pages (static) ──► fetches /data/*.json only. Custom-range analytics run client-side.
```

Principles:

1. **No server and no browser→NSE calls.** NSE blocks cross-origin requests and bots, so all fetching happens in the pipeline.
2. **`store/` is the source of truth.** It is append-only: each file for a date is written once, after validation. Git history therefore grows linearly, by about 50–60 MB a year.
3. **Generated JSON is disposable.** It is rebuilt from `store/` on every deploy, so the JSON format can change freely without migrations.
4. **Cumulative-sum columns** (see 03 §5.4) mean any date-range comparison needs at most 4 small files in the browser, never one file per day.
5. **Per-source isolation.** Each source has its own fetch, parse, validate and freshness status. The site shows how fresh each source is.

### Hosting

- Default: **public GitHub repo + GitHub Pages + GitHub Actions**, all free. Deploy uses `actions/upload-pages-artifact` + `actions/deploy-pages`. The data JSON is never committed.
- Alternative: **Cloudflare Pages** (works with a private repo) via `cloudflare/wrangler-action`. Keep the deploy step in its own job so it can be swapped.
- Limits to respect: GitHub Pages site ≤ 1 GB; Cloudflare Pages ≤ 20,000 files per deploy and ≤ 25 MiB per file. The expected output is about 3,500 files and 150 MB for one year, so it fits both.

## 5. Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Pipeline | Python 3.12, requests, pandas, xlrd, jsonschema, pytest | `requirements.txt` with pinned versions |
| Frontend build | Vite, TypeScript strict | `base` from env `VITE_BASE` (repo name for GitHub Pages) |
| UI | React 18, Tailwind CSS, react-router (HashRouter) | HashRouter because GitHub Pages has no SPA fallback |
| Charts | Apache ECharts 5, modular imports (`echarts/core` + only the charts and components used) | One library covers candlestick, bars, lines, treemap, heatmap, calendar, scatter, dataZoom |
| Tables | TanStack Table v8 + TanStack Virtual | About 3,000 rows, virtualised |
| Dates | date-fns | Never parse trading dates through `new Date("YYYY-MM-DD")` in UTC; treat them as strings |
| Tests | pytest, Vitest; optional Playwright smoke test | |
| Lint | ruff (Python), eslint + prettier (TS) | |

Pin exact versions current at build time.

## 6. Repository layout

```
/
├─ pipeline/
│  ├─ __main__.py          CLI entry (see 03 §1)
│  ├─ config.py            loads config/*.json
│  ├─ http.py              session, headers, rate limit, retry, response validation
│  ├─ calendar.py          trading-day discovery
│  ├─ store.py             atomic read/write of store/
│  ├─ symbols.py           symbol→filename encoding, ISIN-based symbol-change merge
│  ├─ entities.py          deal client-name normalisation
│  ├─ metrics.py           all formulas from 04 (single implementation)
│  ├─ sources/             one module per source S1–S15: fetch(), parse(), validate()
│  ├─ build/               one module per generated JSON family
│  ├─ schemas/             JSON Schema for every generated file
│  └─ tests/ (+ fixtures/)
├─ config/
│  ├─ settings.json        backfill start, windows, liquidity floors, per-source run location
│  ├─ signals.json         signal thresholds (04 §4)
│  └─ entities.json        institution alias patterns → canonical entity + type
├─ store/                  committed raw data (03 §3)
├─ scripts/
│  └─ update_local.ps1     Windows fallback: update, commit store/, push
├─ site/
│  ├─ public/data/         generated, gitignored
│  └─ src/ (pages/, components/, charts/, lib/metrics.ts, lib/dataClient.ts, types/data.ts)
├─ .github/workflows/
│  ├─ update-and-deploy.yml
│  └─ ci.yml
├─ docs/specs/             these files (+ SOURCE_STATUS.md and DEVIATIONS.md created during the build)
└─ README.md               setup, local run, fallback setup, disclaimer
```

## 7. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Performance | First load ≤ 1.5 MB transferred (gzip), JS included. Dashboard interactive in < 3 s on a mid-range phone on 4G. Sorting or filtering 3,000 rows in < 100 ms. Heavy pages lazy-loaded. |
| Mobile | Fully responsive. Every chart usable by tapping (tooltips on tap). No horizontal page scroll; wide tables scroll inside their own container. |
| Accessibility | Colour-blind-safe palettes: blue/teal for increase and orange for decrease on delivery metrics, a diverging scale for heat maps. Never rely on colour alone: always show signed numbers (+/−). Keyboard-navigable tables. |
| Dark mode | Supported; follows the OS setting, with a manual toggle. |
| Reliability | One source failing must not block the others. The site shows "Data as of <date>" and a freshness badge for each source. |
| Privacy | No analytics, trackers or cookies by default. The watchlist lives in `localStorage` (wrap every access in try/catch). |
| Legal/disclaimer | Footer on every page: "Data source: NSE India (nseindia.com). FII/DII figures are provisional. For education only; not investment advice. Not affiliated with NSE." NSE's terms of use restrict redistributing its data. Keep the site non-commercial, and let the user decide whether to make it public. |
| Time | All dates are IST trading dates. Store and pass them as `YYYY-MM-DD` strings end to end. |
