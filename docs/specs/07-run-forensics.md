# 07 — Run Forensics and Smart-Money Footprints (Phase 5B)

**Requested by the user on 2026-11-14.**

- For any stock, show what came **before and during** its big price runs, up or down: volume, delivery, trade size, named big players, holdings and F&O positioning. The user can then learn to read these footprints over time.
- Summarise whether **long-term buying or selling** is under way, i.e. whether "smart money's taste" for the stock is changing, so the user can decide for themselves whether to stay or reduce a holding.
- Everything is **descriptive evidence**. The UI never says buy, sell, hold, add or reduce.

Evidence base: [docs/research/2026-11-run-footprints-study.md](../research/2026-11-run-footprints-study.md). Read it first.

> **Reality check, shown on the page.** NSE does not publish *who* took delivery of a stock on a given day. The app shows big players' **footprints**:
>
> - delivery value vs normal;
> - delivery on up days vs down days;
> - average trade size;
> - named bulk/block deals;
> - quarterly FII/DII/MF/promoter holdings and named holders above 1%;
> - futures open interest.

## 1. Definitions

| Term | Rule |
|------|------|
| Adjusted close | Back-adjust closes for splits and bonuses. When \|prevClose(t)/close(t−1) − 1\| > 3%, multiply all earlier closes by that ratio. Used for runs and returns only, never displayed as the price. |
| Run | A zig-zag on adjusted close with reversal `runs.reversalPct` (default 12). A run is a leg with \|move\| ≥ `runs.minMovePct` (20) and ≥ `runs.minDays` (5) trading days. Direction is UP or DOWN. Settings live in `config/settings.json → runs`. |
| Windows | **pre** = the 20 trading days ending at the run's start pivot. **base** = the 60 days before pre. **early** = the first 5 days after the pivot. **full** = pivot → end pivot. **post** = the 20 days after the end. |
| Ordinary days | The same window features for every eligible stock-day, used as the comparison baseline |

## 2. Footprint features (each window vs base)

| Feature | Formula | Source |
|---------|---------|--------|
| `delivValRatio` | mean delivery value (window) ÷ mean (base) | S1 |
| `delivPctChgPp` | delivPctW(window) − delivPctW(base) | S1 |
| `turnoverRatio` | mean turnover (window) ÷ mean (base) | S1 |
| `tradeSizeRatio` | mean(turnover/trades) window ÷ base | S1 |
| `delivBalance` | Σ delivery value on up days ÷ Σ on down days, within the window | S1 |
| `spikeDays` | days with delivery value ≥ 2× its prior-20-day mean | S1 |
| `priceChgPct`, `relStrength` | adjusted return; return minus the Nifty 50 return and minus the sector-median return | S1, S12 |
| `dealsNetCr.{FII,DII,Other}` | net value via bulk/block deals, round trips excluded | S9/S10 + entities (Phase 4) |
| `holdChgPp.{fii,dii,mf,promoter}` | from the last quarter ending before the pivot to the first quarter ending after the run's end | S16 (Phase 4B) |
| `futOiChgPct`, `buildupDays.{LB,SB,SC,LU}` | F&O stocks only | S3 (Phase 5) |
| `events` | results dates (board meetings whose purpose includes "Financial Results"), corporate actions, circuits | S4 `bm` (§8), S4 `bc`, flags |

## 3. Daily footprint indicators

Add these to the daily and symbol files:

- `delivBal20`, `delivBal60`, `delivBal120`: `delivBalance` over the last N trading days.
- `delivValRatio60`: mean delivery value over 20 days ÷ the prior 60 days.
- `tradeSizeRatio60`: the same for average trade size.
- `delivPctTrend`: delivery % over 20 days minus over 120 days (pp).

These drive the Stock page "Footprints" chart pane (§7).

## 4. Per-stock run analysis

Add to `symbols/{f}.json`:

- `runs`: one row per run, with `dir, start, end, movePct, days` plus the §2 features for the pre, early and full windows.
- `runSummary`: the median features of **this stock's** UP-run pre windows, its DOWN-run pre windows, and its ordinary days, with counts. If there are fewer than 3 runs in a direction, show "not enough runs yet" for that direction.

## 5. Market-wide run library and statistics

- `runs/library.json`: every run in the universe (non-ETF EQ). Columns: `sym, dir, start, end, movePct, days, bucket, sector`, plus the key pre and early features.
- `stats/run_footprints.json`:
  1. **Medians** by window × direction vs ordinary, overall and by cap bucket. This is Part A of the study.
  2. **Lift tables** (no hindsight). For each feature, quintile → P(big up ≥ `runs.bigMovePct`, default 15) and P(big down) over the next 20 days, entered at close(t+1), with the base rates. This is Part B.
  3. **A long-horizon version:** 60-day features → next 60/120 days. Computed only when the store has ≥ 2 years; until then the UI shows "needs more history".
- The pipeline must reproduce `docs/research/scripts/run_footprints.py` on the same store. Make that a pytest.

## 6. Smart-money panel (long-term positioning)

Shown on the Stock page for 3M, 6M and 1Y windows. Each indicator gets a direction: ↑ leans accumulation, ↓ leans distribution, → neutral. Thresholds live in `config/signals.json → smartMoney`.

| Indicator | ↑ | ↓ |
|-----------|---|---|
| Delivery balance (window) | > 1.2 | < 0.8 |
| Delivery % trend vs own 1-year average | > +3 pp | < −3 pp |
| Average trade size trend | > +10% | < −10% |
| Named deals, FII + DII net | > +₹10 Cr | < −₹10 Cr |
| FII + DII + MF holdings change, last 2 quarters | > +0.5 pp | < −0.5 pp |
| Promoter holdings change, last 2 quarters | > +0.5 pp | < −0.5 pp (promoter selling) |
| F&O: OI trend with price (F&O stocks) | long build-up dominant | short build-up dominant |

- **Tally line:** "Over 6 months: 4 of 7 footprints lean accumulation, 1 leans distribution, 2 are neutral." Each row expands to show its numbers and a sparkline.
- **Track record:** the pipeline computes forward 60- and 120-day excess returns by tally bucket (e.g. ≥ 4 accumulation, ≥ 4 distribution, mixed), using the §5.3 method. Until 2 years of history exist, show "Track record needs more history".
- **Wording:** the label is "Evidence summary, not advice. You decide." No buy/sell/hold/add/reduce, and no composite score dressed up as a rating.

## 6A. Smart Money Trail (user request, 2026-11-14)

A prominent **"Smart Money Trail"** button opens a one-click analysis of where big-player footprints have been **building up or unwinding**, and **whether that has recently changed** ("smart money's taste is changing"). It appears on the Dashboard, the Screener and every Stock page ("Show this stock's trail"). Route: `#/trail` (market) and `#/trail/:sym` (stock).

### Indicators

These are the §6 indicators, computed per stock per **week**: delivery balance, delivery % trend, average trade size trend, delivery-spike persistence, named deals (FII+DII net), holdings change (FII/DII/MF, promoter) and F&O OI with price. Each week gets a direction code: `A` (leans accumulation), `D` (leans distribution) or `N`.

### Trail metrics per stock, for windows 3M / 6M / 1Y

| Metric | Definition |
|--------|------------|
| `tally` | count of indicators leaning A and leaning D over the window (§6 thresholds) |
| `consistency` | share of weeks in the window coded A (or D). A trail is "persistent" when ≥ 60% of weeks agree. |
| `strip` | the last 52 weekly codes, for the mini trail strip |
| `flip` | **taste change:** the window leaned A (or D) but the last 6 weeks lean the other way with ≥ 3 indicators, or the reverse. Stored as `flip: "A→D" \| "D→A" \| null` with the week it started. |
| `events` | named deals (entity, side, value), holdings changes with named holders entering or exiting, results dates, circuits, corporate actions, within the window |

### Market mode (`#/trail`)

Controls: window (3M / 6M / 1Y), universe (default **Nifty 500**, with the liquidity floor), sector filter, and an **"as of" date** picker.

1. **Strongest accumulation trail** and **Strongest distribution trail**. Ranked by tally, then consistency. Each row shows the mini strip, the tally, the key numbers, and event chips (e.g. "DII block buy ₹120 Cr", "MF +1.2 pp").
2. **Taste changing.** Stocks with a recent `flip`, newest first. This is the list that speaks to "stay or reduce weightage", while still being evidence only.
3. **Sector rotation.** For each sector:
   - the share of stocks leaning A vs D;
   - the value-weighted delivery balance;
   - named FII vs DII deal flows;
   - the holdings shift.
   Sorted by net accumulation. A bar chart and a weekly sector × week grid.
4. **Insights panel.** 5–10 plain-language observations generated **deterministically from the computed statistics, using templates** (no LLM). For example:
   - "38 Nifty 500 stocks show ≥ 5 of 7 accumulation footprints over 6 months; most are in Healthcare (9) and Capital Goods (6)."
   - "12 stocks flipped from accumulation to distribution in the last 6 weeks."
   - "Via deals, FIIs net sold ₹2,140 Cr in Financial Services while DIIs bought ₹1,860 Cr."
   Every insight links to the rows behind it.
5. **Track record:** see §6 track record. For each past "as of" date, how the accumulation, distribution and flip lists did over the next 60 and 120 trading days (median excess vs universe, hit rate, n). Labelled "Historical, not a prediction".

### Stock mode (`#/trail/:sym`)

- A weekly **timeline table**: one row per week and one column per indicator, coloured A / D / N, with event markers.
- A price line above it, with weekly delivery balance and spike bars.
- Holdings bars per quarter, with named holders (NEW / UP / DOWN / EXITED).
- The deals list with entities.
- **The narrative summary:** 3–5 template sentences, e.g. "Over 6 months delivery has been heavier on up weeks (1.6×), MFs added 0.8 pp last quarter, and no promoter selling. In the last 4 weeks, however, delivery shifted to down weeks (0.7×) and FIIs sold ₹85 Cr via a block deal."
- Comparison with the sector's median trail.

### "As of" history (for learning)

- The pipeline stores a trail snapshot at **every month-end** in the history (3 years means about 36 snapshots), in `trail/asof/{YYYY-MM-DD}.json`, alongside `trail/latest.json`.
- The user can pick a past date and see what the trail said then, next to the price afterwards. This is how the user learns to read the trail.

### Outputs

- `trail/latest.json` and `trail/asof/*.json`: per stock, the three windows' metrics plus the strip; sector aggregates; the insights.
- `trail/{f}.json`: the per-stock weekly timeline, or embed it in `symbols/{f}.json` if size allows.
- `stats/trail_perf.json`: the track record.
- These count toward the 07 §8 size budget.

### Staged delivery

| Phase | What the trail gets |
|-------|---------------------|
| **3C** (new, right after 3B) | Trail **v1 with the delivery footprints only**: delivery balance, delivery % trend, trade size, spike persistence. Includes the market and stock modes, as-of snapshots, insights and the track record. Slots for the other indicators show "arrives in Phase 4 / 4B / 5". |
| **4** | Named deals indicator, and the FII-vs-DII sector flows |
| **4B** | Holdings indicators and named holders |
| **5** | The F&O indicator |
| **5B** | Runs integration (runs shaded on the stock trail) and the final track-record polish |

Each of those phases' acceptance includes "the indicator is wired into the trail, and the trail tests are updated".

### Acceptance

- Direction-code and flip unit tests on synthetic weekly series.
- Insight templates are tested: every number in an insight equals its source statistic.
- An as-of snapshot uses only data on or before its date (no-lookahead test).
- The wording test: no buy/sell/hold/add/reduce.
- The smoke test covers `#/trail` and `#/trail/:sym`, plus the "Smart Money Trail" buttons on the Dashboard, Screener and Stock pages.

## 7. UI

**Stock page: new "Runs" tab.**

- A price chart with runs shaded (UP teal, DOWN orange).
- A footprint pane with `delivBal60` and `delivValRatio60`.
- Markers for deals, results dates, corporate actions and quarter ends.
- A runs table. Clicking a run highlights its windows and opens a footprint card: pre, early and full vs this stock's ordinary days, and vs the market-wide medians.
- A "This stock's pattern" card from `runSummary`.

**Stock page header:** a compact smart-money panel (the tally plus a "details" link to §6).

**New page `#/runs`, "Run library":**

- **Filters:** direction, minimum move, universe, cap, sector and date range.
- **Runs table:** click a row to open that stock's Runs tab at that run.
- **"What came before big moves":** grouped bars of UP / DOWN / ordinary medians for each feature.
- **"Does it raise the odds?":** quintile bars of P(big up) and P(big down), with a base-rate line, for each feature.
- **Disclaimers:** the study caveats.

**Learn page: "Reading footprints".**

- A plain-language guide.
- **Three case studies picked automatically from the data:** the largest UP and DOWN runs among the top 200 in the last year, each rendered with its footprint card.

## 8. Data additions

- **S4 `bm{DDMMYYYY}.txt` (board meetings).**
  - Verify its format first, then store a daily extract (`store/board_meetings/YYYY/DATE.csv.gz`: symbol, meetingDate, purpose).
  - Backfill one year by re-downloading the PR zips: 256 requests, about 175 MB transferred, keeping only the `bm` extract.
  - Use: results-date markers, plus a results event study per stock (delivery and return around results days).
- **3-year history (APPROVED by the user on 2026-11-14, including publishing it on the website).**
  - **Data:** S1 and S12 from 2023-11-14, and the S3 extract from 2024-07-08 (the UDiFF start). It is downloaded to `.history_staging/` (gitignored), in the store's exact formats, with its own `calendar.json`. The staging loader is `docs/research/scripts/load_history.py`.
  - **Merge step** (do this in the phase that implements the publishing rules below): move the staged files into `store/`, and merge the staged `tradingDays`/`noData` into `store/calendar.json`. Then re-run the backfill for the sources the pipeline needs over the new range, *only if their rules require it*. The rule: no new source history beyond S1, S12 and S3 without asking the user. Rolling metrics recomputed over 3 years change the first year's warm-up values; that is expected.
  - **Publish all 3 years on the site, within the GitHub Pages 1 GB limit:**
    - `cum/`, `symbols/` (full history), `market.json`, run outputs and statistics: full 3 years.
    - `daily/`: full columns for the last `publish.dailyFullTradingDays` (default 260). Older days use a slim column set (sym, series, OHLC, prevClose, vwap, vol, turnoverCr, trades, delivQty, delivPct, delivValCr, spike, delivPctDiff, ret1, signal, flags). Day mode works for any date in 3 years; columns that are missing show "—" with a tooltip.
  - **Size budget:** `npm run build` must report the total size of `dist/`. Fail CI if it exceeds 900 MB, and warn above 700 MB. Document the fallback in DEVIATIONS when it is needed: move hosting to Cloudflare Pages (no total-size cap; 20,000 files and 25 MiB per file) with `cloudflare/wrangler-action`, which needs the user's Cloudflare account. Ask the user before switching.

## 9. Acceptance (Phase 5B)

- Run detection is unit-tested on synthetic series with known pivots, including a split adjustment.
- `stats/run_footprints.json` reproduces the research script's output on the same store (a pytest).
- A no-hindsight test: lift features use data ≤ t only, and entry is at close(t+1).
- The wording test passes: no advice words anywhere in Runs, the smart-money panel or Learn.
- Run detection plus features for 750 stocks × the full store finishes in ≤ 30 s within `pipeline build`.
- Case studies render from data, not from hard-coded text.

## 10. Placement

- Phase 5B, after Phase 5. It needs Phase 4 entities and deals, Phase 4B holdings, and Phase 5 F&O.
- The delivery-only parts (§1–5 without big-player fields, plus the Runs tab) may be built earlier if convenient. They must leave slots for the later fields.
