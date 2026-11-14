# 05 — Frontend

## 1. Global shell

- **Top bar:**
  - site name;
  - a "Data as of 13 Nov 2026" chip. It is amber if any source is stale, and clicking it opens the source-freshness table;
  - the date control (§3);
  - a filter button with a badge showing how many filters are active;
  - a theme toggle.
- **Navigation:** a left rail on desktop (≥ 1024 px) and a bottom tab bar on mobile. The tab bar holds Dashboard, Screener, Compare, Heatmap and More; More holds Institutions, Deals, Trail, Runs, Stats, Watchlist and Learn (Institutions and Deals appear once those pages exist; Runs is the Run library, Phase 5B).
- **Footer:** the disclaimer from 01 §7, on every page.
- **Routing:** HashRouter. Routes are `#/`, `#/screener`, `#/compare`, `#/heatmap`, `#/stock/:sym`, `#/institutions`, `#/deals`, `#/entity/:id`, `#/stats`, `#/trail`, `#/trail/:sym`, `#/learn`, `#/watchlist`.
- **State in the URL:** all filter and date state lives in query params, e.g. `#/screener?u=NIFTY200&b=L,M&sec=Financial%20Services&d=2026-11-13`. Links are therefore shareable, and Back/Forward work. Store the last-used filters in `localStorage` (inside try/catch) and apply them only when the URL has none.

## 2. Global filters (a drawer on mobile, a popover on desktop)

| Filter | Options | Default |
|--------|---------|---------|
| Universe | All, Nifty 50, Nifty Next 50 (Junior Nifty), Nifty 100, Nifty 200, Nifty 500, Midcap 150, Smallcap 250, Microcap 250, Total Market, F&O stocks, Watchlist | All |
| Market cap | Large (1–100), Mid (101–250), Small (251–500), Micro (501+), with multi-select. Add custom min/max ₹ Cr. | all |
| Sector | multi-select from `meta.sectors` + "Unclassified" | all |
| Min 20D avg turnover | ₹ Cr input | `meta.settings.minTurnoverAvg20Cr` (1) |
| Min price | ₹ | 0 |
| Hide event-driven rows | toggle; hides rows with `corpAction`, `bulkDeal`, `blockDeal` or `bandHit` | off (flag icons are still shown) |
| Hide ETFs | toggle; hides ETFs and index funds (universe `etf` / flag 512). URL param `hetf=1` | off (ETFs show with an "ETF" badge) |

Show this small note under the Universe and Market cap filters: "Uses current index constituents and today's market-cap ranks."

Filtering is a pure function, `applyFilters(rows, universe, filters)`, in `src/lib/filters.ts`, with unit tests.

## 2b. Timeframe (Phase 3B, 08)

A segmented switch `D | W | M | Q | Custom` sits next to the date control and is stored as `tf=d|w|m|q|c|r` (`tf=c&n=10`: N-day bars; `tf=r&from=..&to=..&base=prev`: a date range). The date control becomes a week, month or quarter picker, which simply sets the global date `d` to the last trading day of the period. Screener, Stock, Compare, Heatmaps and Stats read it; the Dashboard, Learn and Watchlist stay daily. Weekly and monthly Screener and treemap views read the `weekly/` and `monthly/` snapshots; quarterly, custom-N and custom-range views come from `cum/` ranges; Stock pages aggregate on the client with `aggregatePeriods` / `aggregateRange` (`lib/aggregate.ts`). Columns that a day's file does not carry (slim days, 07 section 8) show a dash with a tooltip.

## 3. Date controls

- **Day mode** (default): a single trading-day picker. Only dates in `meta.tradingDays` are enabled. Defaults to `latestDate`. Add previous/next-day arrows.
- **Range mode** (Compare, the Screener when switched to Range, and the Treemap):
  - the range ends on the date picked in the top bar; presets 1W (5 trading days), 2W (10), 1M (21), 3M (63), 6M (126), 1Y (252 or all stored days), MTD, YTD and Custom (two dates, snapped to trading days);
  - URL params: `r` (preset, default 1M), `ra`/`rb` (custom range), `bl` (`p` previous equal period, `20`, `50`, `c`), `ba`/`bb` (custom baseline); Screener range mode adds `rng=1`;
  - a baseline selector: "previous equal period" (default), "prior 20 days", "prior 50 days" or "custom";
  - always state the resolved ranges in words, e.g. "Range 15 Oct–13 Nov 2026 (21 days) vs baseline 15 Sep–14 Oct (21 days)".

## 4. Pages

### P1 Dashboard `#/`

KPI row of stat tiles. Each tile has its value, its change and a 20-day sparkline:

- Market delivery % (ALL `delivPctW`), with pp vs its 20-day average;
- total delivery value (₹ Cr);
- total turnover (₹ Cr);
- advances / declines;
- FII net and DII net (cash, provisional), or "Collecting since <date>" while history is short;
- the number of stocks with spike ≥ 2×.

Cards, each with a top-10 table and a "View all" link to a Screener preset:

- Delivery spikes;
- Delivery drops;
- Highest delivery %;
- Up on heavy delivery (ACC);
- Down on heavy delivery (DIS);
- New 52-week highs, each with its delivery level;
- Largest delivery value;
- Today's largest bulk/block deals (excluding round trips).

Two mini charts:

- market delivery % over 60 days, with Nifty 50 on a second axis;
- FII/DII net over the last 20 days, as bars.

Each card row shows the symbol, an "ETF" badge when the symbol is an ETF, sector chip, close, `ret1`, `delivPct`, `spike` and flag icons. Tapping a row opens the stock page.

### P2 Screener `#/screener`

- A virtualised table of the filtered universe. The symbol cell carries the small "ETF" badge for ETFs (the same badge appears on Dashboard cards, the stock header, search results and the Watchlist).
- **Day mode** columns: every `daily/` field, plus the derived `Change (₹)` = close − prevClose. Range mode columns: the §3 range fields of 04 (plus the ⚠ corporate-action column and the range signal).
- **Default Day columns:** Symbol, **Prev close, Close, Change (₹), Change (%)** (side by side, in that order), Turnover, Deliv %, Deliv % 20D, Deliv % diff, Deliv value, Spike, Signal, Flags. The column chooser lists `prevClose` and `Change (₹)` too. The saved column set is stored under the versioned key `dv.cols.v2`; a set saved under the old key `dv.cols` is migrated once by merging the four price columns in right after the symbol.
- Column chooser with the choice saved locally. Multi-column sort. Symbol and name search.
- **Daily delivery watch** button, first and visually primary (above the chips). One tap sets Universe = Nifty 500, min 20-day average turnover = ₹5 Cr, Hide ETFs = on, Hide event-driven rows = on and the preset Delivery spikes, as shareable URL state (`u=NIFTY500&mt=5&he=1&hetf=1&p=spikes`; the date is kept, other filters, sort, search and range state are replaced or cleared). Under it: "Unusual delivery in liquid Nifty 500 stocks, excluding record dates, deal days and circuits."
- **Preset chips in four labelled groups** (04 §2): Start here (Delivery spikes, Unusual vs own history, Largest delivery value), Direction (Up on heavy delivery, Down on heavy delivery), Patterns (New 52-week high, low delivery; New 52-week high, heavy delivery) and More (collapsed by default: Highest delivery %, Delivery % jump, Delivery % fall, Sustained rise, Delivery drops, Large cap: down on heavy delivery). On mobile the groups stack and More stays collapsed. "Delivery ↑ + Long build-up" and the F&O build-up group (Long build-up, Short build-up, Short covering, Long unwinding) are built in Phase 5 (DEVIATIONS #126).
- Under each preset in Start here, Direction and Patterns, a one-line "Historically: …" note from `signal_perf` (04 §6). Lists that have no measured event say so ("a ranking, not an event"). The "Not a prediction" label sits under the groups.
- **Flag badges use plain words** (the tooltip keeps the explanation): T2T, Corp action, Bulk deal, Block deal, Circuit, F&O ban, 52W high, 52W low, Low liquidity, New listing, Expiry week. The Learn page carries a flag legend.
- Ownership columns, joined from `holdings/latest.json` (Phase 4B): `promoterPct, fiiPct, diiPct, mfPct, fiiChgPp, diiChgPp, mfChgPp`, plus a quarter label in the column header tooltip.
- Ownership presets: "FII stake up last quarter", "DII stake up last quarter", "FII→DII handover", and "Delivery spike + FII stake up".
- In Range mode, add the deal-flow columns `fiiDealNetCr` and `diiDealNetCr`.
- Export the visible rows to CSV.
- Sticky first column (the symbol). On mobile the table scrolls horizontally inside its own container.

### P3 Period Compare `#/compare`

- The range and baseline controls.
- Two ranked tables side by side, "Delivery increased" and "Delivery decreased" (stacked on mobile), with a metric toggle between delivery value and delivery %.
- A quadrant scatter (04 §4.3). Clicking a dot opens the stock page.
- Counts of ACC, DIS, SPU and SPD range signals as filter chips.
- A "Show excluded" toggle (04 §3 rules) that shows excluded rows greyed out, with the reason for each.

### P4 Heatmaps `#/heatmap` (three tabs)

1. **Treemap**
   - grouped by sector, then stock; stocks only (ETFs are not drawn);
   - size: turnover, market cap or delivery value (toggle);
   - colour: `spike` on a log2 scale (diverging at 1×, clamped to [0.25×, 4×]), `delivPctDiff` (±25 pp) or `ret1` (±5%);
   - works in Day and Range mode;
   - tooltip: symbol, name, dp, dpAvg20, spike, ret;
   - tap to drill into a sector; tap a stock to open its page.
2. **Grid (group × day)**
   - rows are sectors (default) or indices or cap buckets, from `market.json`; columns are the last 20 or 60 trading days;
   - colour = the group's `delivPctW` minus its own 60-day mean (pp);
   - when the universe is an index with ≤ 50 stocks, offer a "Stocks" row mode. It loads `symbols/{f}.json` for each stock, at most 50 files and 6 at a time;
   - colour = `spike`.
3. **Calendar:** pick a stock; an ECharts calendar heatmap of `delivPct` over one year.

Colour scales: a diverging blue↔orange scale with a neutral midpoint that works in both light and dark themes, and a legend with numeric ticks. Define the palette once in `src/charts/theme.ts`.

### P5 Stock detail `#/stock/:sym`

**Header:**

- name, symbol, an "ETF" badge for ETFs and index funds (they have no market-cap bucket and no signal), sector, index badges, market cap and bucket, an F&O badge, and the watchlist star;
- today's close, `ret1`, `delivPct` (with its 20-day average), `spike`;
- the signal badge with its explanation and its historical follow-through line for the stock's cap bucket (04 §4.1), plus confluence badges and flags.

**Main chart:** one ECharts instance with vertically stacked grids, a shared x-axis and a shared `dataZoom` (default window 6 months).

| Pane | Content |
|------|---------|
| 1 | Candlestick (or close line). Markers ▲/▼ for bulk/block buys and sells, sized by value. A vertical marker for each corporate-action ex-date. |
| 2 | A stacked bar per day: delivered qty (solid) + non-delivered qty (light) = total volume, plus a 20-day average delivered-qty line. |
| 3 | Delivery % line, its 20-day average line, and a ±1σ (60-day) band |
| 4 (F&O only) | Futures OI line, plus a strip coloured by build-up code. Built in Phase 5 as the F&O pane (DEVIATIONS #126): futures OI with the close, build-up runs shaded, the put-call ratio, the confluence badge, and a plain note for non-F&O stocks |

**Below the chart:**

- the stats panel (04 §6, stock level) with a window selector;
- **Ownership** (Phase 4B):
  - stacked bars per quarter (last 4–8) of Promoter / FII / DII (split into MF, Insurance and other DII) / Retail / Others;
  - QoQ change chips, with ⚠ when the share count changed;
  - a table of named holders > 1%, with category, %, and change (`NEW`/`UP`/`DOWN`/`EXITED`, plus the "below 1% ≠ sold out" note). Each holder links to `#/entity/:id`;
  - an FII-vs-DII deal-flow bar chart (net ₹ Cr per month from `dealFlows`).
  - If the stock has no filings yet: "Shareholding not yet collected for this stock".
- the calendar heatmap;
- a table of the last 30 days;
- a deals table (entity links to `#/entity/:id`);
- a corporate-actions list.

Unknown symbol: a friendly not-found message with search.

### P6 Institutions `#/institutions` (four tabs)

Banner on tabs 1–3: "These FII/DII figures are provisional and combined across NSE, BSE and MSEI. Per-stock FII/DII data comes from two other sources: named bulk/block deals (daily, large trades only) and shareholding patterns (quarterly). See the Holdings tab and the Deals page."

1. **Cash:**
   - daily FII and DII net as grouped bars;
   - cumulative lines;
   - Nifty 50 on a second axis;
   - range presets;
   - a monthly table (buy, sell, net) and streaks;
   - "Collecting since <date>" whenever history is shorter than the selected range.
2. **Derivatives positioning (S5/S6):**
   - FII index-futures long % line, with a band from the 10th to 90th historical percentile;
   - net index-futures contracts by participant (four lines);
   - options call/put net by participant;
   - volume-share stacked area;
   - a latest-day table with day changes.
3. **FII derivatives (S7):** net buy value by category (bars), with the OI value trend.
4. **Holdings (quarterly, S16; Phase 4B):**
   - a quarter picker, with "N of M companies filed" while a quarter is in progress;
   - ranking tables from 04 §5.4 (FII / DII / MF stake up and down, FII→DII handover, new named holders), all respecting the global filters;
   - the aggregate trend: market-cap-weighted FII% vs DII% vs MF% per quarter for the selected universe (e.g. Nifty 500);
   - a sector table of FII% and DII% with QoQ change.

### P7 Deals `#/deals` and Entity `#/entity/:id`

**Deals page:**

- a table with filters: date range, type (bulk, block), side, **category (FII / DII / Other)**, entity type, minimum value ₹ Cr, "Hide round trips" (on by default), and symbol;
- "Top buyers" / "Top sellers" by net value for the range, with a category switch;
- "FII vs DII by stock": for the range, a per-stock table of FII net and DII net via deals, plus the "FII selling to DII" and reverse lists (04 §5.3), with the large-trades caveat.

**Entity page:**

- totals, and a category badge (FII/DII/Other, marked "inferred" when it is);
- **disclosed holdings** (S16): every stock where this entity is a named holder > 1%, with % and the change vs the previous quarter. This works as a partial portfolio view; label it "only holdings above 1% are disclosed";
- a per-stock net table;
- a deal timeline (scatter of date × value, coloured by side);
- an aliases list, and a link explaining how to edit `config/entities.json`.

### P8 Market Statistics `#/stats`

- Delivery % trend for multiple selected groups (ALL, indices, sectors, buckets), as one line chart with a legend.
- Today's histogram of delivery %.
- Scatter of delivery % vs `ret1`.
- Sector bars of delivery value, with delivery % vs the 20-day average.
- A cap-bucket comparison table.
- The signal-performance table (Phase 3). Rows are events and columns are cap groups; there is a horizon switch (1/5/20 days). Each cell shows the median excess and the hit rate, with `n` on hover. The disclaimer label from 04 §6 sits above the table.

### P8b Smart Money Trail `#/trail` and `#/trail/:sym` (Phase 3C, 07 §6A)

- **Entry points:** a prominent filled "Smart Money Trail" button on the Dashboard header and next to the Screener's watch buttons, "Show this stock's trail" in every Stock page header, and a "Trail" item in the menu.
- **Market mode.** Controls, all in the URL: window `tw` (3M, 6M default, 1Y), universe `tu` (Nifty 500 default), sector `ts`, as-of month-end `ta`. Sections: an insights panel (5 to 10 template sentences, each with "Show the N rows"; `ti` selects one), the strongest A and strongest D lists, the Taste-changing list, the four indicators with their rules and A/D counts, sector rotation (bar chart, week grid, table), the track record table, and the slots for later indicators ("arrives in Phase 4 / 4B / 5"). Every list header and indicator row has a "Historically: ..." line read from `stats/trail_perf.json`. In as-of mode a "Since" column shows the change of the last close since that day (blank across a split or bonus).
- **Stock mode.** Computed in the browser from `symbols/{f}.json` by `trailForRows` (TS twin of `pipeline/trail.py`). Narrative (3 to 5 sentences), the four indicators with code, value and Historically line, the tally and flip, a price line with weekly delivery balance and spike-day bars, the comparison with the sector median, and the weekly timeline table.
- **Run shading (Phase 5B):** the weekly chart shades this stock's UP runs (teal) and DOWN runs (orange) with the Runs tab's bars (DEVIATIONS #163).
- **Wording:** "Evidence summary, not advice. You decide." No buy/sell/hold/add/reduce, no rating. The wording test (`words.test.ts`) scans the trail source and the generated sentences for imperative advice.

### P8c Run library `#/runs` (Phase 5B, 07 §7)

- **Filters in the URL:** direction (`dir`), minimum move (`mm`, 20 to 50%), universe (`u`, with the watchlist), cap bucket (`b`), sector (`sec`) and start-date range (`from`, `to`). The global keys are shared with the Filters panel.
- **Runs table** from `runs/library.json`: the first 200 filtered rows with "Show all", the whole filtered list in the CSV. A row opens the stock's Runs tab at that run (`?tab=runs&run=<start>`).
- **"What came before big moves":** grouped bars of UP, DOWN and ordinary medians for each feature, with window and cap-bucket switches (`stats/run_footprints.json`).
- **"Does it raise the odds?":** one quintile chart per feature (P(big up) and P(big down), base rates as dashed lines), switching between the 20-day lift and the 60-day long-horizon table.
- **Caveats panel:** survivorship, one sample period, before costs, correlated features, footprints rather than identities, and "Historical, not a prediction. Evidence, not advice."
- Lazy-loaded. Logic in `lib/runLibrary.ts`, charts in `charts/runsLibrary.ts`. DEVIATIONS #157 to #161.

### P9 Learn `#/learn`

Static content written from 04 §0, §4 and §8:

- how to read delivery;
- "What a year of data showed": a plain-language summary of docs/research/2026-11-delivery-signal-study.md, linked to the live signal-performance table;
- what each signal means;
- traps: record dates, block deals, circuits, T2T, splits and bonuses, expiry, provisional FII data, current-constituents bias;
- "Reading footprints" (Phase 5B): a short plain-language guide to runs and footprints, and three case studies picked from the data by a rule (`lib/caseStudies.ts`), each with its footprint card (DEVIATIONS #162);
- data sources and update times;
- the source-freshness table (from `meta.sources`).

### P10 Watchlist `#/watchlist`

- Starred symbols from `localStorage`.
- Shown as Screener day mode restricted to the watchlist, with a compact sparkline column of delivery % over 20 days (loaded from the symbol files, at most 50).

## 5. Charts: conventions

- Import ECharts modularly (`echarts/core` plus only the charts and components used). Lazy-load pages with `React.lazy`. Keep a single wrapper component, `<EChart option={…} />`, that handles resize, theme and dispose.
- If a dataviz skill is available in your environment, load it before writing chart code. Either way, apply these rules:
  - a consistent palette in light and dark themes;
  - delivery increase = blue/teal and decrease = orange;
  - candles use the conventional green up / red down;
  - neutral greys for non-delivered volume.
- Every axis has units. Tooltips use the formatting rules in 04 §7.
- Empty states: "Not enough history yet (needs 10 trading days)". Loading skeletons with the same dimensions as the final content, so layout doesn't shift.
- Touch: tooltips trigger on tap; dataZoom has a slider on mobile and inside-zoom on desktop.

## 6. Data loading (`src/lib/dataClient.ts`)

- On start, fetch `meta.json` with `cache: 'no-store'`. Fetch every other file with `?v=<meta.generatedAt>` and the default cache, so each deploy busts the cache while files are reused within a deploy.
- Keep an in-memory LRU cache of 40 files. Deduplicate concurrent requests for the same URL.
- Hooks: `usePeriods`, `usePeriodSnapshot`, `useTimeframe`, `useMeta`, `useUniverse`, `useDaily(date)`, `useCum(date)`, `useSymbol(sym)`, `useMarket`, `useInstitutional(kind)`, `useDeals(year)`, `useEntities`.
- Convert `{columns, rows}` into typed row objects once per file. Memoise.
- Range maths: `computeRange(cumA0, cumA1, cumB0, cumB1)` in `src/lib/metrics.ts`, a pure function tested against the shared vectors (04 intro).
- Initial dashboard load: `meta`, `universe`, `daily/latest`, `market` and `institutional/cash`. Target ≤ 600 KB gzipped of data.

## 7. Quality bar

- TypeScript strict, with no `any` in data paths. eslint and prettier must be clean.
- Vitest covers `filters.ts`, `metrics.ts`, the formatters and the dataClient caching.
- Lighthouse on mobile: Performance ≥ 85 and Accessibility ≥ 95 on the Dashboard.
- No console errors. Every page works at 360 px width with no horizontal page scroll.

## Phase 4 as built (2026-11-14)

- **P6 Institutions** (`#/institutions`, tabs `tab=cash|deriv|s7|holdings`): the provisional banner on tabs 1 to 3; cash summary, daily and cumulative chart, monthly table, the "Collecting since" note; derivatives (latest positioning table, FII index-futures long share with its own 10th to 90th percentile band, net index futures by participant, volume share); FII derivatives (S7 net bought value by category, OI value trend). The Holdings tab says "arrives in Phase 4B".
- **P7 Deals** (`#/deals`): filters in the URL (from, to, type, side, category, minimum value, symbol, hide round trips); totals by category; top entities by net value; "FII vs DII by stock" with the two lists and an all-stocks table; the deal list (first 200 rows). **Entity** (`#/entity/:id`): totals, category and an "inferred" note, per-stock net, timeline (bought above zero, sold below), disclosed holdings placeholder (4B), aliases.
- **Stock page:** deal markers on the price chart (triangles above the high for bought, below the low for sold, sized by value); the deal list with entity links and round-trip notes; the monthly net via deals bar chart.
- **Trail:** the sector table gains "FII via deals" and "DII via deals"; the stock mode gains a "Named deals" card with the entity behind each deal (DEVIATIONS #81, #82).
- **Caveat and history gap:** every deals view shows the large-trades caveat (04 5.3) and the history-gap note (DEVIATIONS #87).

## Phase 4B as built (2026-11-14)

- **P1 Stock page Ownership** (`components/Ownership.tsx`): a stacked bar per quarter (last four stored) of Promoter, FII, MF, Insurance, Other DII, Retail and Others, with the table beside it; the change chips in pp, ⚠ and the dilution caveat when the share count moved by more than 2%; the named holders above 1% of the latest quarter with NEW, UP, DOWN, SAME and EXITED status and entity links; the EXITED caveat; the filed date of each quarter; and the empty state "No shareholding filings stored for this stock yet." (DEVIATIONS #112, #113, #116, #118).
- **P6 Institutions, Holdings tab** (`components/HoldingsTab.tsx`): coverage ("Holdings stored for N of M companies", with an in-progress note), market-cap-weighted trends by group (All, Large, Mid, Small, Micro, `tab=holdings&hg=`), and the biggest QoQ rises and falls for FII, DII, MF and Promoter, excluding dilution (DEVIATIONS #110, #111).
- **P7 Entity page, disclosed holdings** (`components/Ownership.tsx`): stocks where the entity is a named holder above 1%, latest quarter first, with % and status (DEVIATIONS #115).
- **P2 Screener**: ownership columns (Promoter %, FII %, DII %, MF %, the three pp changes, Filed) and an "Ownership (quarterly filings)" preset group in the day view, with one explanation per preset (DEVIATIONS #114, #117).
- Local data: 19 stocks have holdings; every view shows its empty state for the rest. The Micro group has no stocks yet.

## Phase 5 polish as built (2026-11-15)

- **CSV export** (`lib/csv.ts`): RFC 4180 escaping, raw numbers, file names `view-YYYY-MM-DD.csv`. "Download CSV" exports the rows shown (after filters and sort) in `DataTable` and on the plain tables of Stock, Deals, Entity, Institutions, Stats, Ownership, Holdings, Compare and Trail (DEVIATIONS #129–#137 list the tables not exported).
- **Empty and error states** (`lib/errors.ts`): a 404 shows "No data for this date." (holdings: "Not available for this stock."; F&O: "No F&O data for this date."); other failures show an error box with "Try again"; the Screener's empty result has "Reset the filters".
- **Colour tokens**: the light `up` / `dec` text colours are `#0a7c42` / `#b45309` (WCAG AA on white and slate-50/100). Chart series keep their brighter colours (DEVIATIONS #138).
- **Checks** (`scripts/smoke.mjs`): `SMOKE_THEME=light|dark`, axe WCAG 2 A/AA on every route, 404-date and network-error cases. On 2026-11-15 axe reported 0 violations on 13 routes × light/dark × 360/1280 px.
- **Lighthouse** (manual, not a dependency): mobile Dashboard on a local `vite preview` of the production build, 2026-11-15: **Performance 92, Accessibility 100** (LCP 0.8 s, TBT 340 ms, CLS 0.014). Command in README.

### Stock page: Runs tab and smart-money panel (Phase 5B part 2a, 07 §7)

- **Header:** a smart-money panel under the header chips: "6M: n of 8 footprints lean accumulation, m leans distribution", the "Historically" line of the matching tally bucket (`stats/trail_perf.json`, kind `tally`; "too few dates" below 6 month-ends), the label "Evidence summary, not advice. You decide." and a "details" link to `#/trail/:sym`.
- **Overview / Runs switch** (`?tab=runs`). The Runs tab is lazy-loaded.
- **Runs tab:** price (raw close) with runs shaded (UP teal, DOWN orange) and tooltips giving the move and days; the selected run's pre (grey), early (violet) and full (amber) windows; markers for deals, results dates, corporate actions and quarter ends; a footprint pane (`delivBal60`, `delivValRatio60`). The runs table (newest first, a row button per run, CSV). The footprint card of the selected run: pre, early and full against this stock's ordinary days (pre only) and the market medians, then the named deals (FII, DII, Other, Rs Cr), the holdings change (pp), the F&O fields and the results-date count, with a dash where the source did not cover the window. "This stock's pattern" from `runSummary` (not enough runs yet below 3 in a direction). Empty states: fewer than 80 trading days; no runs of 20% or more in the stored history.
- **Tables** scroll inside their own container; the page has no horizontal scroll at 360 px. Colours: the `up` and `dec` text tokens only for text (AA).
- DEVIATIONS #150 to #156.

## Phase 5B part 2b as built (2026-11-15): the Run library, Learn case studies, trail shading

Built: the `#/runs` Run library (P8c), the Learn page's "Reading footprints" section with three data-picked case studies (P9), the Runs tab's `?run=` selection, and the run shading on the stock trail (P8b). Shared pieces: `charts/runs.ts` (`runBarData`, `runCoverage`) used by the Runs tab and the trail. DEVIATIONS #157 to #167.
