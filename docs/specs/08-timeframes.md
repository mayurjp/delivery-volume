# 08 — Weekly and Monthly Timeframes (Phase 3B)

**Requested by the user on 2026-11-14.** Every analysis view offers **Daily / Weekly / Monthly**.

Daily data is noisy. Weekly and monthly aggregation shows slower accumulation and distribution, the "smart money" shifts in 07, more clearly.

**Placement:** Phase 3B runs right after Phase 3 and before Phase 4. It ships together with the **3-year history merge and publishing rules** (07 §8), because both change the generated outputs.

## 1. Periods

| Timeframe | Period | Label | Baseline for "vs normal" | Long baseline (z-score, percentile) |
|-----------|--------|-------|---------------------------|--------------------------------------|
| Daily (`d`) | trading day | `2026-11-13` | prior 20 days (as today) | prior 60 / 250 days |
| Weekly (`w`) | ISO week, Mon–Sun | the week's last trading day, e.g. `w/e 13 Nov 2026` | prior **10** weeks | prior 52 weeks |
| Monthly (`m`) | calendar month | `Nov 2026` | prior **6** months | prior 24 months |

- A special session on a Sunday (Muhurat trading) belongs to that ISO week, which runs Monday to Sunday.
- **Partial periods:** the current week or month is marked `partial: true`, with `daysIn` and `daysExpected`. The UI shows "in progress (3 of 5 days)". Partial periods are excluded from baselines and from signal-performance events.
- A stock counts in a period if it has at least one valid day in it. Its `days` field records how many.

## 2. Aggregation (per stock per period)

| Field | Rule |
|-------|------|
| `open` | open on the first trading day the stock traded in the period |
| `high`, `low` | max high, min low |
| `close`, `prevClose` | last close in the period; the close of the last day before the period |
| `vwap` | Σ turnover ÷ Σ volume |
| `vol`, `turnoverCr`, `trades`, `delivQty`, `delivValCr` | sums over valid days. Delivery fields are summed over valid delivery days only (04 §1). |
| `delivPct` | Σ delivValCr ÷ Σ turnoverCr on valid delivery days × 100. Value-weighted; never an average of daily %. |
| `ret` | close ÷ prevClose − 1, using split-adjusted prices (07 §1) |
| `clv` | close location within the period's high–low range |
| `avgTradeSize` | Σ turnover ÷ Σ trades |
| `delivBalance` | Σ delivery value on up days ÷ Σ on down days, within the period |
| `spike` | delivValCr ÷ the mean of the prior N complete periods (N from §1) |
| `delivPctDiff` | delivPct − the value-weighted delivPct of the prior N periods |
| `relTurnover`, `tradeSizeRatio` | the same, vs the prior N periods |
| `delivPctZ`, `delivPctPctile` | vs the long baseline |
| `streak` | consecutive periods with delivPct above its N-period baseline (signed) |
| `flags` | OR of the daily flags during the period, plus `high52`/`low52` when the period's high/low broke the prior 52-week level |
| `signal` | §3 |
| F&O | `futOi` at period end, `futOiChgPct` vs the previous period end, and the period build-up from ret and OI change. Monthly OI change uses **all expiries combined** to remove rollover. |

## 3. Period signals

The structure is the same as 04 §4.1, with thresholds per timeframe in `config/signals.json → periods.{w,m}`:

| Code | Weekly default | Monthly default |
|------|----------------|-----------------|
| ACC: up on heavy delivery | ret ≥ +3%, spike ≥ 1.5, delivPctDiff ≥ +5, clv ≥ +0.3 | ret ≥ +6%, spike ≥ 1.4, delivPctDiff ≥ +4, clv ≥ +0.3 |
| DIS: down on heavy delivery | ret ≤ −3%, spike ≥ 1.5, delivPctDiff ≥ +5, clv ≤ −0.3 | ret ≤ −6%, spike ≥ 1.4, delivPctDiff ≥ +4, clv ≤ −0.3 |
| ABS: heavy delivery, flat price | \|ret\| < 2%, spike ≥ 2, delivPctDiff ≥ +8 | \|ret\| < 3%, spike ≥ 1.8, delivPctDiff ≥ +6 |
| SPU / SPD: up / down on low delivery | \|ret\| ≥ 5%, relTurnover ≥ 2, delivPctDiff ≤ −8 | \|ret\| ≥ 10%, relTurnover ≥ 1.8, delivPctDiff ≤ −6 |

The same exclusions apply: ETFs, low liquidity (on the period's average daily turnover), T2T, and too little history (fewer than 6 weeks / 4 months).

## 4. Outputs

- `periods.json`: the lists of weeks and months, each with `{key, start, end, tradingDays, partial}`.
- `weekly/{weekEnd}.json` and `monthly/{YYYY-MM}.json`: one Screener snapshot per period, columnar like `daily/`, with the §2 fields. **Slim column set only.**
- `market.json` gains `weekly` and `monthly` blocks with the same groups and fields as the daily block (05 P8).
- **Stock pages aggregate on the client** from the daily rows in `symbols/{f}.json` (3 years). Use one TS function, `aggregatePeriods(rows, tf)`, and its Python twin in `pipeline/metrics.py`. Both are tested on the same shared vectors.
- **Institutional cash, deals and participant data** are aggregated on the client (sums; positions at period end).
- **Size:** about 156 weekly and 36 monthly files. Include them in the 07 §8 `dist/` size budget, and report the actual size.

## 5. UI

- **Global timeframe switch** `D | W | M`, next to the date control. It is stored in the URL as `tf=d|w|m`. The date picker switches to a week or month picker.
- **Screener:**
  - Day/Week/Month snapshots, where every preset uses the period fields;
  - **"Weekly delivery watch"** and **"Monthly delivery watch"** variants of the Daily delivery watch button (same filters, period presets);
  - Range mode stays date-based.
- **Stock page:**
  - candles, stacked delivered/non-delivered bars and delivery % per period;
  - the dataZoom default is 1 year for weekly and 3 years for monthly;
  - the calendar heatmap stays daily;
  - the Runs tab and the smart-money panel (07) can show weekly bars of `delivBalance` and `spike`.
- **Compare:** range presets in weeks and months, e.g. "last 4 weeks vs previous 12 weeks" and "last 3 months vs previous 6 months".
- **Heatmaps:** the treemap colours by the period fields. Grid columns become the last 20 weeks or the last 12 months.
- **Market Statistics and Institutions:** trend lines and bars per period, using sums for flows and period-end values for positions.
- **Signal performance:**
  - per timeframe, events are the period signals;
  - forward horizons: 4 and 12 weeks for weekly, 3 and 6 months for monthly;
  - entry is the close of the first trading day after the period ends;
  - the excess-return method is the same as 04 §6;
  - cells with n < 30 are hidden. Monthly cells will often be thin; say so.

## 5A. Custom date ranges and custom bar sizes (user request, 2026-11-14)

The timeframe switch becomes `D | W | M | Q | Custom`.

**Quarterly (`q`):**
- Periods are calendar quarters, matching results and shareholding.
- The baseline is the prior 4 quarters; the long baseline is the prior 8.
- Signal thresholds come from `periods.q` (start from the monthly defaults × 1.5 for `ret`).
- No snapshot files. The Screener's quarterly view is computed from `cum/` ranges (below), and stock pages aggregate on the client.

**Custom range, across all stocks (Screener and Compare):**
- The user picks any start–end date and, optionally, a baseline (previous equal period / prior N days / custom), as in Range mode (04 §3).
- Every stock gets one aggregate row over the range, computed from `cum/` with at most 4 fetches.
- To support this, **add these cumulative columns to `cum/` (03 §5.4):**
  - `cDelivValUpCr` and `cDelivValDnCr` (delivery value on up days and down days), which give `delivBalance` for any range;
  - `cTrades`, which gives `avgTradeSize` and `tradeSizeRatio` for any range.
- Fields available for any range: sums, value-weighted delivery %, return (with the ⚠ for corporate actions in the range), delivery balance, average trade size, and their changes vs the baseline. **High, low and clv are not derivable from cum.** They are shown only on the stock page; the Screener shows "—" with a tooltip.

**Custom bar size (Stock page):**
- "Custom" adds a bar-size input: **N trading days**, 2–120 (e.g. 3, 10, 60), aligned to end at the latest date.
- Alternatively, the user picks a start–end range to aggregate into a **single bar** and footprint card, the same card as the 07 Runs footprint (pre/early/full style).
- Both use the client-side `aggregatePeriods(rows, {kind: 'n', n})` and `aggregateRange(rows, a, b)`, with Python twins and shared vectors.

**URL state:** `tf=q`, `tf=c&n=10`, or `tf=r&from=2026-06-01&to=2026-09-30&base=prev`. Every custom view is shareable.

## 6. Acceptance (Phase 3B)

- **Aggregation unit tests:**
  - OHLC, value-weighted delivery %, and split-adjusted returns across a split;
  - partial periods, a holiday week, and the Muhurat Sunday inside its ISO week;
  - a stock that trades only some days of a period.
- The Python and TS `aggregatePeriods` produce identical results on the shared vectors.
- For any complete week or month, the snapshot's sums equal the `cum/` range sums for the same dates.
- Period signals are tested on their boundaries. Signal performance shows weekly and monthly tables.
- The `tf` switch round-trips through the URL, including `q`, custom N-day bars and custom ranges. The smoke test covers D/W/M/Q/Custom on Screener, Stock, Heatmaps and Stats at 360 px and 1280 px.
- Custom range from `cum/` (including the new `cDelivValUpCr`, `cDelivValDnCr` and `cTrades`) equals the direct daily sums for 5 random ranges and stocks, including one with a split in the range.
- `aggregatePeriods(rows, {kind: 'n', n})` and `aggregateRange` match their Python twins on the shared vectors.
- The `dist/` size stays within the 07 §8 budget, and the build time stays within the 03 §6 limit. Report both.
