# 05 — Frontend

## 1. Global shell

- **Top bar:**
  - site name;
  - a "Data as of 13 Nov 2026" chip. It is amber if any source is stale, and clicking it opens the source-freshness table;
  - the date control (§3);
  - a filter button with a badge showing how many filters are active;
  - a theme toggle.
- **Navigation:** a left rail on desktop (≥ 1024 px) and a bottom tab bar on mobile. The tab bar holds Dashboard, Screener, Compare, Heatmap and More; More holds Institutions, Deals, Stats, Learn and Watchlist.
- **Footer:** the disclaimer from 01 §7, on every page.
- **Routing:** HashRouter. Routes are `#/`, `#/screener`, `#/compare`, `#/heatmap`, `#/stock/:sym`, `#/institutions`, `#/deals`, `#/entity/:id`, `#/stats`, `#/learn`, `#/watchlist`.
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

## 3. Date controls

- **Day mode** (default): a single trading-day picker. Only dates in `meta.tradingDays` are enabled. Defaults to `latestDate`. Add previous/next-day arrows.
- **Range mode** (Compare, and Screener when it is switched to Range):
  - presets 1W, 2W, 1M, 3M, 6M, 1Y, MTD, YTD and Custom;
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
- **Day mode** columns: every `daily/` field. Range mode columns: the §3 range fields of 04.
- Column chooser, with a default set of about 10 columns and the choice saved locally. Multi-column sort. Symbol and name search.
- Preset chips for every list in 04 §2, including "New 52-week high, low delivery", "New 52-week high, heavy delivery" and "Large cap: down on heavy delivery". "Delivery ↑ + Long build-up" is added in Phase 5.
- Every preset that matches a `signal_perf` event shows a one-line "Historically: …" note under the chips (04 §6).
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
   - grouped by sector, then stock;
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
| 4 (F&O only) | Futures OI line, plus a strip coloured by build-up code |

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

### P9 Learn `#/learn`

Static content written from 04 §0, §4 and §8:

- how to read delivery;
- "What a year of data showed": a plain-language summary of docs/research/2026-11-delivery-signal-study.md, linked to the live signal-performance table;
- what each signal means;
- traps: record dates, block deals, circuits, T2T, splits and bonuses, expiry, provisional FII data, current-constituents bias;
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
- Hooks: `useMeta`, `useUniverse`, `useDaily(date)`, `useCum(date)`, `useSymbol(sym)`, `useMarket`, `useInstitutional(kind)`, `useDeals(year)`, `useEntities`.
- Convert `{columns, rows}` into typed row objects once per file. Memoise.
- Range maths: `computeRange(cumA0, cumA1, cumB0, cumB1)` in `src/lib/metrics.ts`, a pure function tested against the shared vectors (04 intro).
- Initial dashboard load: `meta`, `universe`, `daily/latest`, `market` and `institutional/cash`. Target ≤ 600 KB gzipped of data.

## 7. Quality bar

- TypeScript strict, with no `any` in data paths. eslint and prettier must be clean.
- Vitest covers `filters.ts`, `metrics.ts`, the formatters and the dataClient caching.
- Lighthouse on mobile: Performance ≥ 85 and Accessibility ≥ 95 on the Dashboard.
- No console errors. Every page works at 360 px width with no horizontal page scroll.
