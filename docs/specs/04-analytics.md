# 04 — Analytics: Metrics, Signals and Interpretation

Each formula here is implemented once in Python (`pipeline/metrics.py`). The range metrics in §3 are also implemented in TypeScript (`site/src/lib/metrics.ts`). Both implementations share test vectors: export a JSON of inputs and expected outputs from the pytest suite, and assert the same results in Vitest.

## 0. The one truth the UI must teach

> **Every delivered share has both a buyer and a seller.** Delivery % does not say whether buyers or sellers won. It says how much of the day's trading ended in a real change of ownership, as opposed to positions squared off intraday.
>
> - High delivery means holders were changing hands: positional, often institutional, activity.
> - Low delivery means mostly traders.
> - **Direction comes from price action:** the return, where the close sits in the day's range, and close vs VWAP.

So every "buying vs selling" label combines a delivery metric with a price metric. Show this text on the Learn page, and in a short tooltip wherever a signal badge appears.

**What a year of data showed** ([docs/research/2026-11-delivery-signal-study.md](../research/2026-11-delivery-signal-study.md)):

- A heavy-delivery up day did **not** predict further outperformance. It was flat to negative in every cap bucket.
- In large caps, the heavy-delivery day's move tended to reverse.
- A rise on low delivery faded in small and micro caps.
- New 52-week highs on **low** delivery did better than those on heavy delivery.

Therefore:

- signal labels **describe what happened** and never predict;
- every signal badge shows that signal's historical follow-through for the stock's cap bucket (§6);
- the UI must never call a signal bullish, bearish, a buy or a sell.

## 1. Notation and valid days

For symbol *s* on trading day *t*, from S1:

- `vol` = TTL_TRD_QNTY
- `dq` = DELIV_QTY
- `dp` = DELIV_PER
- `tv` = TURNOVER_LACS × 1e5 (₹)
- `vwap` = AVG_PRICE
- `c` = CLOSE_PRICE, `pc` = PREV_CLOSE, `h` = HIGH_PRICE, `l` = LOW_PRICE
- `trades` = NO_OF_TRADES

**A valid delivery day** means:

- series in `universeSeries` (EQ);
- `dq` not null;
- `vol > 0`.

Every rolling window and cumulative sum uses valid days only. "Prior N" means the N valid days before *t*, excluding *t*.

## 2. Daily per-stock metrics

| Field | Formula | Unit | Notes |
|-------|---------|------|-------|
| `turnoverCr` | tv / 1e7 | ₹ Cr | |
| `delivValCr` | dq × vwap / 1e7 | ₹ Cr | Delivery value. Robust to splits. |
| `delivPct` | dp (or dq / vol × 100) | % | Equal to the value-based % on a single day, because tv = vol × vwap |
| `delivValAvgN` | mean(`delivValCr`, prior N), N ∈ {5, 20, 50} | ₹ Cr | min_periods = ⌈N/2⌉ |
| `delivPctAvg20` | Σ dv / Σ tv × 100 over prior 20 | % | Value-weighted. Never average the percentages. |
| `volAvg20`, `turnoverAvg20Cr` | prior-20 means | | |
| `spike` | `delivValCr / delivValAvg20` | × | null if `delivValAvg20` is null or < `minBaseDelivValCr` |
| `delivPctDiff` | `delivPct − delivPctAvg20` | pp | percentage points |
| `relVol` | `vol / volAvg20` | × | |
| `ret1` | c / pc − 1 | % | |
| `clv` | ((c − l) − (h − c)) / (h − l); 0 if h = l | −1…+1 | Close location: +1 means it closed at the high |
| `vwapGap` | (c − vwap) / vwap | % | Closing above VWAP means buyers pushed late |
| `avgTradeSize` | tv / trades | ₹ | |
| `tradeSizeRatio` | `avgTradeSize / mean(avgTradeSize, prior 20)` | × | Rising trade size hints at larger participants |
| `nonDelivQty` | vol − dq | shares | Intraday / squared-off volume |
| `delivPctZ60` | (dp − mean(dp, prior 60)) / std(dp, prior 60) | σ | null if std = 0 or fewer than 30 days |
| `delivPctPctile` | percentile rank of today's dp among the last 250 valid days, today included | 0–100 | |
| `streak` | signed count of consecutive valid days ending at *t* with dp > (or <) that day's `delivPctAvg20` | days | |
| `lowLiquidity` flag | `turnoverAvg20Cr < minTurnoverAvg20Cr` (default ₹1 Cr) | | Excluded from rankings by default |

### Daily top lists (Dashboard and Screener presets)

Every list excludes these by default: `lowLiquidity`, `t2t` and `newListing`. ETFs (flag `etf`) stay in the lists with an "ETF" badge, and the global "Hide ETFs" filter (05 §2) removes them. They never appear in the signal-based lists, because they have no signal (4.1).

| List | Sort | Extra filter |
|------|------|--------------|
| Delivery spikes | `spike` desc | `delivValCr ≥ 1` |
| Delivery drops | `spike` asc | `delivValAvg20 ≥ 1` |
| Highest delivery % | `delivPct` desc | `turnoverCr ≥ 5` |
| Delivery % jump | `delivPctDiff` desc | |
| Delivery % fall | `delivPctDiff` asc | |
| Largest delivery value | `delivValCr` desc | |
| Sustained rise | `streak` desc | `streak ≥ 5` |
| Unusual vs own history | `delivPctZ60` desc | `delivPctZ60 ≥ 2` |
| Up / Down on heavy delivery | `spike` desc within `signal = ACC` / `DIS` | |
| New 52-week high, low delivery | `ret1` desc | `high52` flag AND `spike < 1` |
| New 52-week high, heavy delivery | `spike` desc | `high52` flag AND `spike ≥ 2` |
| Large cap: down on heavy delivery | `spike` desc | bucket `L` AND `signal = DIS` |

The thresholds in the "Extra filter" column live in `config/signals.json → lists`.

**How the Screener presents them (05 §4, P2):** the preset chips sit in four labelled groups, in this order.

| Group | Lists |
|-------|-------|
| Start here | Delivery spikes, Unusual vs own history, Largest delivery value |
| Direction | Up on heavy delivery, Down on heavy delivery |
| Patterns | New 52-week high, low delivery; New 52-week high, heavy delivery |
| More (collapsed by default) | Highest delivery %, Delivery % jump, Delivery % fall, Sustained rise, Delivery drops, Large cap: down on heavy delivery |

A **Daily delivery watch** button comes first and is visually primary. One tap sets Universe = Nifty 500, minimum 20-day average turnover = ₹5 Cr, Hide ETFs = on, Hide event-driven rows = on (corporate action, bulk/block deal and circuit days) and the preset Delivery spikes, as ordinary shareable URL state (`u=NIFTY500&mt=5&he=1&hetf=1&p=spikes`). Its one-line explanation: "Unusual delivery in liquid Nifty 500 stocks, excluding record dates, deal days and circuits."

## 3. Range metrics (computed client-side from `cum/` files)

Inputs: range R = [a, b] and baseline B = [a′, b′] (trading days). Let `prev(x)` be the trading day before *x*. For each symbol and each cumulative field X:

```
X(R) = X(b) − X(prev(a))                      // X ∈ {cDelivValCr, cTurnoverCr, cDelivQty, cVol, cDays}
n(R)          = cDays(R)
avgDelivVal(R) = cDelivValCr(R) / n(R)         // ₹ Cr per day
delivPctW(R)   = cDelivValCr(R) / cTurnoverCr(R) × 100
avgTurnover(R) = cTurnoverCr(R) / n(R)
ret(R)         = lastClose(b) / lastClose(prev(a)) − 1
```

Baseline options:

1. The previous period with the same number of trading days (default).
2. The N trading days before `a` (N = 20 or 50).
3. A custom range.

Comparison fields:

| Field | Formula |
|-------|---------|
| `delivValChgPct` | avgDelivVal(R) / avgDelivVal(B) − 1 |
| `delivPctChgPp` | delivPctW(R) − delivPctW(B) |
| `turnoverChgPct` | avgTurnover(R) / avgTurnover(B) − 1 |
| `ret` | ret(R) |
| `coverage` | n(R) / tradingDays(R) |

Rules:

- Exclude a row from rankings (show it greyed out under a "Show excluded" toggle) when any of these holds:
  - `coverage < 0.6`;
  - n(B) < 0.6 × tradingDays(B);
  - avgDelivVal(B) < `minBaseDelivValCr`;
  - avgTurnover(B) < `minTurnoverAvg20Cr`.
- **Use value-based fields only.** Quantities change across splits and bonus issues.
- If a SPLIT or BONUS ex-date falls inside [prev(a), b], `ret(R)` is wrong because prices are unadjusted. Show a ⚠ "corporate action in range: price return not adjusted" marker, and drop the row from return-based quadrant views.
- "Top delivery increased" sorts by `delivValChgPct` desc, and "decreased" sorts ascending. A toggle switches the ranking metric to `delivPctChgPp`.

A range comparison fetches at most 4 files: `cum/prev(a)`, `cum/b`, `cum/prev(a′)` and `cum/b′`.

## 4. Signals: buying vs selling interest

All thresholds live in `config/signals.json`. These are the defaults.

### 4.1 Daily signal (`signal` column)

Evaluated only when the row is valid, not `lowLiquidity` or `t2t`, **not an ETF** (`etf` flag), and it has at least 10 prior valid days. **ETF rows always have `signal = null`**: ETF delivery reflects creation/redemption and authorised-participant arbitrage, not investor interest, so a delivery-based reading would mislead. ETF rows keep every other metric (`spike`, `delivPctDiff`, `ret1`, ...). The first matching rule wins, in this order:

| Code | Label shown | Condition | Meaning shown in tooltip (describes the day only) |
|------|-------------|-----------|--------------------------|
| `ACC` | Up on heavy delivery | ret1 ≥ +1.0% AND spike ≥ 1.5 AND delivPctDiff ≥ +5 AND clv ≥ +0.3 | The price rose on unusually high delivery and closed near the high |
| `DIS` | Down on heavy delivery | ret1 ≤ −1.0% AND spike ≥ 1.5 AND delivPctDiff ≥ +5 AND clv ≤ −0.3 | The price fell on unusually high delivery and closed near the low |
| `ABS` | Heavy delivery, flat price | \|ret1\| < 1.0% AND spike ≥ 2.0 AND delivPctDiff ≥ +10 | A large transfer of shares with little price change |
| `SPU` | Up on low delivery | ret1 ≥ +2.0% AND relVol ≥ 2 AND delivPctDiff ≤ −10 | The rise came mostly from intraday trading; little of it ended in delivery |
| `SPD` | Down on low delivery | ret1 ≤ −2.0% AND relVol ≥ 2 AND delivPctDiff ≤ −10 | The fall came mostly from intraday trading; little of it ended in delivery |

Every tooltip ends with one line from `stats/signal_perf.json` for the stock's cap bucket, e.g. "Historically (Large caps, 1 yr): 20-day median vs peers −1.0%, beat peers 44% of the time (n=414)."

**Context flags shown next to any signal** (they do not suppress it):

- `corpAction`: delivery jumps before dividend, bonus or buyback record dates (people buying to become eligible). This is not organic interest.
- `bulkDeal` / `blockDeal`: a single negotiated counterparty, not broad interest.
- `bandHit`: at an upper or lower circuit, volume is one-sided and thin, so delivery % is inflated.
- `expiryWeek`: F&O rollover distorts volume.

### 4.2 Range signal (Period Compare)

The same structure, using range fields:

| Code | Condition |
|------|-----------|
| `ACC` | ret ≥ +3% AND delivValChgPct ≥ +30% AND delivPctChgPp ≥ +3 |
| `DIS` | ret ≤ −3% AND delivValChgPct ≥ +30% AND delivPctChgPp ≥ +3 |
| `SPU` | ret ≥ +5% AND delivPctChgPp ≤ −5 |
| `SPD` | ret ≤ −5% AND delivPctChgPp ≤ −5 |

### 4.3 Quadrant scatter (day or range)

- x = `ret1` or `ret(R)`.
- y = `delivPctDiff` or `delivPctChgPp`.
- Bubble size = turnover; colour = sector.

| Quadrant | Label |
|----------|-------|
| Top-right | "Price ↑ on rising delivery" |
| Top-left | "Price ↓ on rising delivery" |
| Bottom-right | "Price ↑ on falling delivery" |
| Bottom-left | "Price ↓ on falling delivery" |

Draw dashed axes at 0. Clamp the axes at the 2nd and 98th percentiles so outliers don't squash the plot, and pin outliers to the edge with a marker.

### 4.4 F&O build-up (F&O stocks)

- `futOi(t)` = Σ OI over all `STF` expiries for the symbol. Summing all expiries removes most of the rollover noise.
- `futOiChgPct` = futOi(t) / futOi(t−1) − 1.
- Price change = spot `ret1`.

| Code | Price | OI change | Label |
|------|-------|-----------|-------|
| `LB` | > 0 | ≥ +2% | Long build-up |
| `SB` | < 0 | ≥ +2% | Short build-up |
| `SC` | > 0 | ≤ −2% | Short covering |
| `LU` | < 0 | ≤ −2% | Long unwinding |
| null | otherwise | | Neutral |

`pcr` = Σ PE OI / Σ CE OI across all `STO` expiries.

**Confluence badges:**

- `ACC` + `LB` → "Heavy delivery + long build-up".
- `DIS` + `SB` → "Heavy delivery + short build-up".
- `ACC` + `SC` → "Heavy delivery + short covering".

Their follow-through is to be measured with the S3 history (study still pending). Until it is, the badges get no "confirmed" wording.

## 5. Institutional analytics

### 5.1 FII/DII cash (S8)

These are aggregate provisional figures for all FIIs and all DIIs across exchanges. **They are not per stock and not per institution.** Show this sentence as a banner on the page.

- Daily `fiiNet` and `diiNet` (₹ Cr).
- Rolling 5-day and 20-day sums, plus month-to-date, calendar-year-to-date and since-collection totals.
- Streak: consecutive days of net buying or net selling, for each of FII and DII.
- Combined: `fiiNet + diiNet`. Flag days when FII and DII take opposite sides of more than ₹1,000 Cr each.
- Overlay: Nifty 50 close (S12).

### 5.2 Derivatives positioning (S5/S6/S7)

For each participant P in {FII, DII, Pro, Client}:

| Metric | Formula |
|--------|---------|
| `futIdxNet` | futIdxLong − futIdxShort (contracts) |
| `futIdxLongPct` | futIdxLong / (futIdxLong + futIdxShort) × 100 |
| `futStkNet` | futStkLong − futStkShort |
| `optIdxCallNet`, `optIdxPutNet` | CallLong − CallShort, PutLong − PutShort |
| `roughOptBias` | optIdxCallNet − optIdxPutNet. Label it "rough: contract counts, not delta-adjusted". |
| Day change | of each metric above |
| History percentile | of `futIdxLongPct` over all stored days (to show "lowest in N months") |

- Volume share: each participant's share of index-futures and index-options volume (S6).
- From S7: FII net buy value in ₹ Cr per category (index futures, index options, stock futures, stock options), and the OI value.
- **Do not hard-code "bullish/bearish" thresholds.** Show values, changes and historical percentiles only.

### 5.3 Bulk and block deals: tracking named institutions

| Item | Rule |
|------|------|
| `valueCr` | qty × price / 1e7 |
| Round trip | Same client, symbol and date with both BUY and SELL; `netQty` = buy − sell. Flag `roundTrip` when \|netQty\| ≤ 10% of max(buyQty, sellQty). These are usually arbitrage or proprietary trading, not conviction. Hidden by default in "conviction" views. |
| Entity normalisation | `config/entities.json`: `[{ "id": "goldman-sachs", "name": "Goldman Sachs", "type": "FPI", "patterns": ["GOLDMAN SACHS"] }]`. Match case-insensitively, after collapsing whitespace and punctuation. Unmatched clients become their own entity, with `id` = slug of the cleaned name. |
| Type inference (when no pattern matches; mark it `entityTypeInferred = true`) | Check in order: contains `MUTUAL FUND` or ends in ` MF` → `MF`; `INSURANCE` or `ASSURANCE` → `Insurance`; `PENSION` or `PROVIDENT` → `Pension`; ` BANK` → `Bank`; `PTE`, `PLC`, `LLC`, ` FUND`, `- ODI`, `SICAV`, `MAURITIUS`, `SINGAPORE` → `FPI (likely)`; `TRADING`, `SECURITIES`, `BROKING`, `CAPITAL MARKETS`, `LLP` → `Trader/Prop (likely)`; otherwise `Other`. |
| Category (`entityCategory`) | Derived from the type: `FPI` / `FPI (likely)` → **FII**. `MF`, `Insurance`, `Bank`, `Pension`, `AIF` → **DII**. Everything else (`Trader/Prop (likely)`, `Promoter`, `Other`) → **Other**. `entities.json` may set `category` explicitly, and that overrides the derived value. Note: a pattern-matched name ending in `- ODI` is an FPI issuing offshore derivative instruments, so it stays FII. |
| Seeding | Seed `entities.json` from the client names seen in the backfilled S16 named-holder lists and in deals. Cover at minimum the 50 largest FII and 50 largest DII names by value. The user reviews and edits the file, so keep it human-editable and documented (a `README` block at the top of the JSON). Use the same `entityId` for a firm in both deals and holdings. |

Entity views:

- Total buy, sell and net per entity.
- Per-stock net position change over the selected range.
- Timeline of deals.
- "Top buyers" / "Top sellers" by net value for a range, by entity type and by category.

**FII vs DII deal flows per stock (from `deals/flows.json`):**

- For any range, sum per stock: `fiiDealNetCr`, `diiDealNetCr` and `otherDealNetCr`, with round trips excluded.
- Rankings:
  - "FII net buying via deals";
  - "DII net buying via deals";
  - "FII selling to DII": stocks where FII net < 0 and DII net > 0 in the same range, and the reverse.
- The caveat must show next to every one of these views: "Deals capture only large trades (bulk/block). They are a small, visible slice of total FII/DII activity."

### 5.4 Quarterly holdings (S16)

| Metric | Definition |
|--------|------------|
| `fiiPct`, `diiPct`, `mfPct`, `insurancePct`, `promoterPct`, `retailPct` | 03 §5.10 groupings, as % of total shares |
| `fiiChgPp` etc. | This quarter − previous quarter, in percentage points |
| `sharesChgPct` | totalShares(q) / totalShares(q−1) − 1 |
| `dilutionFlag` | \|sharesChgPct\| > 2%. A % change can come from new issuance or a buyback rather than buying or selling, so show ⚠ "share count changed" next to the change. |
| `fiiSharesChgPct` | FII-held shares(q) / FII-held shares(q−1) − 1. This measures actual buying or selling, regardless of dilution. Skip it if a split or bonus ex-date (S4 `bc`) falls inside the quarter, unless both quarters' totals are adjusted by the ratio. |
| Named-holder change | Comparing a holder's % with the previous quarter gives `NEW` (absent before), `UP` / `DOWN` (\|Δ\| ≥ 0.05 pp), `SAME`, or `EXITED`. **`EXITED` means only "no longer listed above 1%"**, which may mean the holder fell below 1% rather than sold out. The UI must say so. |
| Group aggregates | Market-cap-weighted averages per index, sector and bucket (03 §5.10) |

Rankings for the latest complete quarter, with an "include in-progress quarter" toggle:

- largest FII stake increase and cut (pp);
- the same for DII and for MF;
- largest promoter cut;
- most new named FII/DII holders;
- "FII→DII handover": FII down by ≥ 1 pp while DII is up by ≥ 1 pp, and the reverse.

Exclude stocks with `dilutionFlag` from the pp rankings by default.

**Combined view (stock page):** quarterly ownership bars, overlaid with the deal flows and the delivery-% trend over the same quarters. A stake change that coincides with delivery spikes and named deals is the strongest evidence available. Present it descriptively, never as a recommendation.

## 6. Statistics (traded vs delivered)

**Market and group level** (from `market.json`):

- `delivPctW` trend per group, with a 20-day average line.
- Share of stocks with spike ≥ 2.
- Advance/decline.
- Delivery value by sector.
- Delivery % by cap bucket.
- Histogram of today's `delivPct` across the universe (bins of 5%), with the median marked.

**Stock level** (from `symbols/{f}.json`, over a selectable window of 1M, 3M, 6M or 1Y):

- mean, median, min, max and standard deviation of delivery %;
- days with delivery % > 60%;
- average turnover and average delivery value;
- today's percentile;
- longest above-average streak;
- correlation of daily delivery % with the next day's return (label it "historical, descriptive").

**Signal performance (Phase 3, `stats/signal_perf.json`).** Reproduce the method of the research study exactly.

- **Events:**
  - each daily signal code;
  - "delivery ≥ 2× and price up ≥ 1%";
  - 52-week-high breakout: all, with low delivery (spike < 1), and with heavy delivery (spike ≥ 2);
  - delivery streak reaching 5 and reaching 10, any price and with the price up over the last 5 days;
  - "Delivery spike 2× or more" (any price move) and "Delivery % z-score 2 or more": the events behind the Delivery spikes and Unusual vs own history lists (not in the research study, so not part of the replication check);
  - Phase 5 F&O combinations (F&O-stock benchmark): LB, SB, SC and LU alone; ACC+LB; ACC+SC; DIS+SB; DIS+LU. They are tracked live because the 1-year samples are small (see the study);
  - Phase 4 deals combinations: FII net buy/sell, DII net buy/sell, ≥ ₹25 Cr variants, FII-sells-DII-buys, and other-only net buy. Measure from close(t+1), because deals are published after the close;
- **Entry timing:** report every event at close(t+1) entry by default, since delivery and deals data are published after the close. Close(t) entry is available as a toggle. For entry lag L and horizon k the forward return is close(t+L+k) / close(t+L) − 1.
- **Groups:** `ALL`, `L`, `M`, `S`, `U` and `IDX:NIFTY200`.
- **Eligible rows:** EQ series, and not `lowLiquidity`, T2T or ETF. Thresholds are applied to the published (rounded) daily values, so anyone can reproduce them from `daily/*.json`.
- **Excess return** = the stock's forward return minus the **median** forward return, on the same day, of every eligible stock in the same group with a valid window. Drop any window that crosses a price adjustment (prevClose(t) vs close(t−1) differs by more than 3%, anywhere in t+1 … t+L+k). Prices come from every stored row, whatever that day's liquidity flag.
- **Per event × group × horizon (1, 5, 20 days):** `n`, `days` (distinct dates), `medianExcess`, `meanExcess`, `hitRate` (share with excess > 0), `asOf`, and the sample window.
- **Display:**
  - lead with the median and the hit rate;
  - show the mean only on hover;
  - hide any cell with n < 30.
- **Label:** "Historical, one sample period, current index/cap membership, before costs. Not a prediction."
- **Replication check:** a pytest (`pipeline/tests/test_signal_perf.py`, marked `slow`) runs `docs/research/scripts/signal_fwd.py` and `signal_fwd2.py` (entry lag 0 and 1) on the same store and compares their printed output with the shipped `stats/signal_perf.json`, programmatically. Event counts must be equal, median excess within ±0.1 pp and hit rate within 1 pp, for every cell the scripts print (cells with n < 30 must also be thin in the JSON). The scripts are the reference, and the research study's tables are their output on the same data.

## 7. Formatting

- Money: `Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })` + " Cr".
- Quantities: en-IN grouping. In compact views, show "12.3 L" or "1.2 Cr" shares.
- Percentages and pp: always signed (`+4.2 pp`, `−1.3%`). Ratios: `2.4×`.
- Dates: `13 Nov 2026` in the UI and ISO in URLs.

## 8. Glossary (also shown on the Learn page)

| Term | Meaning |
|------|---------|
| Delivery quantity | Shares that changed ownership at settlement, i.e. were not squared off intraday |
| Delivery % | Delivery quantity / traded quantity |
| T2T (BE/BZ series) | Trade-for-trade: every trade must be delivered, so delivery % carries no information |
| FII/FPI | Foreign institutional/portfolio investors |
| DII | Domestic institutions: mutual funds, insurers, banks, pension funds |
| Pro | Brokers trading on their own account |
| Client | Everyone else, mostly retail and HNIs |
| Bulk deal | One client trades more than 0.5% of a company's listed shares in a day; the name is published |
| Block deal | A large trade in the separate block-deal window; the name is published |
| Open interest (OI) | Outstanding derivative contracts not yet closed |
| PCR | Put-call ratio of open interest |
| Shareholding pattern | A quarterly filing by each company showing who owns its shares by category, and naming every public shareholder above 1% |
| FPI Category I / II | SEBI's classes of foreign portfolio investors (e.g. sovereign and regulated funds are Category I). Both count as FII here. |
| ODI | Offshore derivative instruments, issued by FPIs to overseas clients. Deals in an "… - ODI" account are FPI activity. |
