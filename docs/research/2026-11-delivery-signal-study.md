# Delivery signal study (Nov 2025 – Nov 2026)

**Question:** does delivery data, i.e. heavy buying and selling that ends in delivery, say anything about the price moves that follow?

**Data:**

- 256 trading days, 2025-11-03 to 2026-11-13, taken from the generated `daily/*.json` files.
- Liquid EQ **stocks** only: `lowLiquidity`, T2T and **ETF** (flag 512) rows are excluded. That leaves 389,573 stock-days. ETFs are also out of every benchmark median.
- *Re-run on 2026-11-14 with ETFs excluded.* The first version of this study included about 357 ETFs and funds; every table below is the stocks-only re-run on the same store.

**Method:**

- **Forward return** = close(t+k) / close(t) − 1, for k = 5 and k = 20 trading days.
- **Excess return** = the stock's forward return minus the **median** forward return of its benchmark group on the same day. The group is all liquid stocks, or the same cap bucket, or Nifty 200, depending on the test.
- Any window that crosses a price adjustment (a split or bonus, detected when prevClose(t) differs from close(t−1) by more than 3%) is dropped.
- Results are reported as the **median** excess return and the **hit rate**, the share of cases with excess > 0. Means are pulled upward by a few large small-cap gainers, so the medians describe the typical case.
- A 52-week-high breakout on day T means high(T) > the adjusted 52-week high in NSE's file for T. That file covers highs through T−1.
- Scripts: [scripts/signal_fwd.py](scripts/signal_fwd.py) for the overall table and [scripts/signal_fwd2.py](scripts/signal_fwd2.py) for the variants. Both are read-only over the generated data. `stats/signal_perf.json` (the pipeline) is checked against their output by `pipeline/tests/test_signal_perf.py`.
- Two script fixes made in the re-run, both for consistency with the pipeline: `signal_fwd2.py` now reads forward prices from every stored row (it used to drop a stock's price on days it was flagged low-liquidity, which silently removed some forward windows), and it maps pre-rename symbols in the 52-week file through the universe aliases.

## 3-year update (2026-11-14): 744 trading days, 2023-11-15 to 2026-11-13

The 1-year tables above are kept unchanged. This section re-runs `signal_fwd.py`, `signal_fwd2.py` (entry lag 0 and 1), `signal_fwd3.py`, `signal_fwd4.py` and `run_footprints.py` on the merged 3-year store. The pipeline's `stats/signal_perf.json` replicates the scripts on this data (the slow pytest passes).

**What is different about the data and the method**

- 1,055,714 liquid EQ stock-days (stocks only, ETFs, T2T and low-liquidity rows out), over 744 days. Today's index, cap and sector membership is applied to all 3 years, so survivorship bias is larger than in the 1-year study.
- **Splits.** NSE's `PREV_CLOSE` is the raw previous close on an ex-date, so the old "prevClose vs close(t-1) above 3%" rule found only 14 events in 3 years. The scripts and the pipeline now also drop forward windows that cross a one-day close ratio of at most 0.78 or at least 1.8. The 1-year tables above were produced before this fix (the median columns are robust to it; the 1-year hit rates may move by a point).
- **52-week highs.** S13 exists only from 2025-11-03. Earlier days use our own split-adjusted 250-day high (from the 251st market day), so breakout events cover 492 days, not 744. Streak events use the published `streak` column; deal and F&O studies below cover only the period their data covers (F&O: from 2024-07-08 and 276 stocks after aliasing (275 before); deals: the same 1 year as before, 19,047 rows).
- Run-footprint and bucket numbers use today's market-cap buckets.

### Signals, all liquid stocks (benchmark = all liquid stocks that day)

| Signal | n | +5d median (hit) | +20d median (hit) |
|--------|---|------------------|-------------------|
| ACC | 17,532 | +0.04% (50%) | +0.23% (51%) |
| DIS | 22,410 | +0.36% (54%) | +0.62% (53%) |
| ABS | 9,076 | +0.41% (55%) | +0.81% (54%) |
| SPU | 23,141 | -0.65% (45%) | -0.76% (47%) |
| SPD | 3,836 | -0.76% (44%) | -0.67% (46%) |
| Delivery 2x or more and price up 1% or more | 56,951 | -0.33% (47%) | -0.28% (49%) |
| Delivery 2x or more and price down 1% or more | 25,384 | +0.12% (51%) | +0.42% (52%) |

### By cap bucket (benchmark = the same bucket), +20d median (hit), entry at close(t) and, in brackets, at close(t+1)

| Signal | Large | Mid | Small | Micro |
|--------|-------|-----|-------|-------|
| ACC | -0.52% (46%) [-0.50%] | +0.00% (50%) [+0.00%] | -0.02% (50%) [+0.05%] | +0.21% (51%) [-0.02%] |
| ABS | -0.04% (49%) [+0.02%] | +0.05% (51%) [+0.00%] | +0.53% (53%) [+0.24%] | +0.66% (54%) [+0.56%] |
| DIS | **+0.73% (55%)** [+0.34% (53%)] | +0.46% (53%) [+0.17%] | +0.51% (53%) [+0.42%] | +0.61% (53%) [+0.37%] |
| SPU | +0.31% (52%) [+0.48%] | +0.37% (52%) [+0.01%] | -0.52% (47%) [-0.30%] | **-0.91% (46%)** [-0.82% (46%)] |

Nifty 200 only: ACC -0.33% (48%), DIS +0.63% (54%), ABS +0.00% (50%), SPU +0.20% (51%).

### Sustained delivery, +20d median (hit)

| Test | n | +20d |
|------|---|------|
| Streak reaches 5, any price | 37,483 | -0.11% (49%) |
| Streak reaches 5, price up over 5 days | 12,484 | +0.01% (50%) |
| Streak reaches 10, any price | 13,122 | -0.36% (48%) |
| Streak reaches 10, price up 5 days, Nifty 200 | 367 | +0.35% (52%) |

### 52-week-high breakouts, +20d median (hit)

| Test | n | All stocks | Nifty 200 |
|------|---|------------|-----------|
| All breakouts | 16,787 | +1.38% (56%) | |
| Breakout on **low** delivery (spike < 1) | 3,587 | **+2.21% (60%)** | +1.32% (58%) |
| Breakout on **heavy** delivery (spike >= 2) | 6,396 | +0.87% (53%) | +0.44% (53%) |

### Delivery x F&O build-up (276 F&O stocks, 121,354 stock-days), +20d median (hit)

**Re-run after the S17 aliasing (2026-11-15).** The first version of this table (below, under "before aliasing") read raw symbol names, so six renamed stocks (GMRINFRA, GUJGASLTD, ICICIPRULI, LTIM, TATAMOTORS, ZOMATO; 14,763 F&O rows) split at the rename. `signal_fwd3.py` now reads the F&O extract through the build's loader and alias (DEVIATIONS #128), and this table is its output: 744 days, 276 stocks, 121,354 stock-days, 109,546 with a valid OI change. The counts now match the shipped `stats/signal_perf.json` (DEVIATIONS #128; long build-up 10,643). Median excess over the F&O-stock median, entry at close(t).

| Test | n | days | +5d | +20d |
|------|---|------|-----|------|
| Long build-up alone | 10,643 | 525 | −0.01% (50%) | +0.05% (50%) |
| Short build-up alone | 13,986 | 528 | −0.04% (49%) | +0.00% (50%) |
| Short covering alone | 9,183 | 524 | −0.03% (49%) | −0.18% (49%) |
| Long unwinding alone | 6,379 | 512 | +0.03% (50%) | −0.06% (49%) |
| ACC (up on heavy delivery) | 2,351 | 489 | −0.02% (49%) | −0.25% (48%) |
| ACC + long build-up | 561 | 279 | −0.05% (49%) | −0.27% (48%) |
| ACC + short covering | 599 | 286 | −0.06% (48%) | **−0.63% (46%)** |
| DIS (down on heavy delivery) | 2,501 | 500 | +0.32% (54%) | +0.55% (53%) |
| DIS + short build-up | 1,082 | 385 | +0.17% (52%) | +0.97% (55%) |
| DIS + long unwinding | 257 | 143 | −0.32% (47%) | −0.34% (48%) |
| Delivery ≥ 2× & up ≥ 1% + long build-up | 1,469 | 429 | +0.05% (51%) | +0.04% (51%) |
| Delivery ≥ 2× & up ≥ 1% + short covering | 1,075 | 401 | +0.09% (51%) | −0.29% (48%) |
| SPU (up on low delivery) + long build-up | 554 | 317 | −0.00% (50%) | +0.32% (53%) |
| SPU (up on low delivery) + short covering | 346 | 238 | +0.21% (51%) | +0.19% (51%) |

**What changed with the aliasing.** Every F&O count rises (long build-up +133 stock-days, from the six renamed stocks). The +20d medians move by 0.00 to 0.10 pp, and the hit rates by at most one point. The largest move is ACC + short covering (−0.53% to −0.63%, still the weakest F&O combination) and ACC + long build-up (−0.22% to −0.27%). No conclusion changes.

**Before aliasing (raw symbol names, 275 stocks, 119,692 stock-days; superseded by the table above).** Kept for comparison:

| Test | n | +20d |
|------|---|------|
| Long build-up alone | 10,510 | +0.06% (50%) |
| Short build-up alone | 13,776 | +0.00% (50%) |
| Short covering alone | 9,058 | -0.17% (49%) |
| Long unwinding alone | 6,278 | -0.07% (49%) |
| ACC | 2,322 | -0.23% (49%) |
| ACC + long build-up | 556 | -0.22% (48%) |
| ACC + short covering | 593 | **-0.53% (46%)** |
| DIS | 2,465 | +0.55% (53%) |
| DIS + short build-up | 1,064 | +0.94% (55%) |
| DIS + long unwinding | 256 | -0.43% (48%) |
| SPU + short covering | 340 | +0.27% (52%) |

### Named FII/DII deals

Unchanged data (1 year, 19,047 rows, truncated bulk-deal days as before). Only the price-window rule changed, so the numbers moved by under 0.2 pp: FII sell of Rs 25 Cr or more +2.76% (62%) at t+1, "FII sells, DII buys" +4.69% (71%, n = 35), non-institutional net buy only -1.28% (45%, n = 765).

### Run footprints (3 years)

The footprint study already carried a 3-year update (section "Update 2026-11-14: 3 years" in `2026-11-run-footprints-study.md`); re-running it on the merged store reproduces those tables exactly (3,095 up-runs, 2,377 down-runs, base rates 9.1% and 4.5%).

### What held and what changed

**Held**

1. A heavy-delivery up day is not a signal of further outperformance. ACC is about flat in every bucket (+0.23% overall, -0.52% in large caps, 46% hit rate).
2. In large caps the heavy-delivery move reverses: DIS beats the bucket median 55% of the time (+0.73%), ACC trails. With next-day entry the DIS edge halves (+0.34%), as in the 1-year study.
3. A rise on low delivery fades in small and micro caps (micro SPU -0.91%, 46%) and does not in large caps.
4. A breakout to a new 52-week high on low delivery beats one on heavy delivery (+2.21% against +0.87%), and it survives next-day entry (+2.22%, 61%).
5. Delivery streaks have no edge; F&O build-up alone has none; ACC + short covering is the weakest F&O combination (-0.63%, 46%).

**Changed or weakened**

1. **DIS is positive everywhere, not only in large caps.** Over 3 years DIS beat its bucket in all four buckets (+0.46% to +0.73%). The large-cap-only story was a feature of the first year.
2. **ACC is not negative outside large caps.** Mid, small and micro ACC are flat to slightly positive over 3 years (it was flat to negative).
3. **ABS helps in small and micro caps only, but more clearly** (+0.53% and +0.66%), and it is flat in large caps.
4. **The breakout edge is smaller and ACC + long build-up no longer looks like the textbook trap** (-0.27%, 48%, was -1.03%, 46% in one year): the F&O effects are within noise. DIS + long unwinding was -2.04% (40%) in one year and is -0.34% (48%) in three: it did not hold.
5. The all-breakouts edge fell from +1.66% to +1.38%. The heavy-delivery breakout is still weaker (+0.87%).
6. The deals results use the same single year; the 3-year history does not touch them. They are still the least reliable.

Caveats from the 1-year study still apply: effects are about 1 to 2% over 20 days before costs; events and 20-day windows overlap; caps and index membership are current values. The 3-year sample includes the 2024-25 correction, so the tests now cover both a rising and a falling market.

---

# Original 1-year study (kept as it was)

## Results: 20-day median excess return (hit rate)

### Signals, all liquid stocks

| Signal | n | +5d | +20d |
|--------|---|-----|------|
| ACC: price up on heavy delivery, strong close | 6,375 | −0.03% (50%) | −0.07% (50%) |
| Delivery ≥ 2× and price up ≥ 1% | 19,130 | −0.32% (47%) | −0.43% (48%) |
| ABS: heavy delivery, flat price | 3,080 | +0.29% (53%) | +0.74% (54%) |
| DIS: price down on heavy delivery, weak close | 8,076 | +0.25% (52%) | +0.49% (53%) |
| SPU: price up on low delivery | 8,001 | −0.58% (45%) | −0.78% (47%) |
| SPD: price down on low delivery | 1,479 | −0.69% (44%) | −0.66% (47%) |

### By cap bucket (benchmark = the same bucket's median), +20d

| Signal | Large (1–100) | Mid (101–250) | Small (251–500) | Micro (501+) |
|--------|---------------|---------------|-----------------|--------------|
| ACC | −0.98% (44%) | +0.03% (50%) | −0.30% (48%) | −0.14% (50%) |
| ABS | −0.09% (47%) | −0.18% (47%) | +0.34% (52%) | +0.84% (55%) |
| DIS | **+0.96% (58%)** | +0.00% (50%) | +0.48% (53%) | +0.50% (53%) |
| SPU | +0.41% (52%) | +0.08% (51%) | −0.41% (48%) | **−0.91% (46%)** |

Nifty 200 only (benchmark = the Nifty 200 median): ACC −0.87% (45%), DIS +0.50% (53%), ABS −0.33% (46%), SPU +0.23% (51%).

### Sustained delivery (the first day delivery % has been above its 20-day average for N days), +20d

| Test | n | +20d |
|------|---|------|
| Streak reaches 5, any price | 13,252 | −0.08% (50%) |
| Streak reaches 5, price up over the last 5 days | 4,201 | +0.04% (50%) |
| Streak reaches 10, any price | 5,004 | −0.18% (49%) |
| Streak reaches 10, price up 5 days, Nifty 200 | 106 | −0.57% (47%) |

### 52-week-high breakouts, +20d

| Test | n | All stocks | Nifty 200 |
|------|---|------------|-----------|
| All breakouts | 11,592 | **+1.66% (56%)** | |
| Breakout on **low** delivery (spike < 1) | 2,329 | **+2.50% (61%)** | **+1.53% (59%)** |
| Breakout on **heavy** delivery (spike ≥ 2) | 4,170 | +0.87% (53%) | +0.06% (50%) |

### Delivery × F&O build-up (F&O stocks only), +20d

*Before aliasing:* this one-year table was computed on raw symbol names (DEVIATIONS #128) and was not re-run; the 3-year table in the update section is the current F&O result.

- **Universe:** 235 stocks with stock futures, 53,364 stock-days. The benchmark is the F&O-stock median that day.
- **futOi** = STF OI summed over all expiries. OI change is skipped when an expiry falls in [t−1, t].
- **Build-up classes:**
  - Long build-up (LB): price up, OI change ≥ +2%;
  - Short build-up (SB): price down, OI ≥ +2%;
  - Short covering (SC): price up, OI ≤ −2%;
  - Long unwinding (LU): price down, OI ≤ −2%.
- Script: [scripts/signal_fwd3.py](scripts/signal_fwd3.py).

| Test | n | days | +5d | +20d |
|------|---|------|-----|------|
| Long build-up alone | 4,096 | 228 | −0.11% (48%) | −0.04% (50%) |
| Short build-up alone | 5,788 | 231 | −0.09% (49%) | −0.01% (50%) |
| Short covering alone | 3,645 | 229 | −0.04% (49%) | −0.36% (47%) |
| Long unwinding alone | 2,538 | 221 | +0.02% (50%) | −0.20% (48%) |
| ACC (up on heavy delivery) | 962 | 200 | −0.02% (49%) | −0.84% (46%) |
| ACC + long build-up | 220 | 118 | −0.43% (46%) | −1.03% (46%) |
| ACC + short covering | 243 | 117 | +0.00% (50%) | **−1.17% (42%)** |
| DIS (down on heavy delivery) | 1,026 | 202 | +0.42% (55%) | +0.59% (53%) |
| DIS + short build-up | 416 | 142 | +0.04% (51%) | +0.95% (55%) |
| DIS + long unwinding | 103 | 57 | −0.30% (48%) | **−2.04% (40%)** |
| Delivery ≥ 2× & up ≥ 1% + long build-up | 557 | 176 | −0.26% (48%) | −0.08% (49%) |
| Delivery ≥ 2× & up ≥ 1% + short covering | 520 | 180 | +0.52% (55%) | −0.59% (47%) |
| SPU (up on low delivery) + short covering | 144 | 99 | +0.61% (56%) | +1.07% (54%) |

### Robustness: entry at close(t+1)

Delivery data is published after the close, so the realistic entry is the next day. Rerun of the key rows with `signal_fwd2.py <root> 1`, +20d:

| Test | Entry at close(t) | Entry at close(t+1) |
|------|-------------------|---------------------|
| Breakout on low delivery | +2.50% (61%) | +2.48% (62%) |
| Breakout on heavy delivery | +0.87% (53%) | +0.91% (53%) |
| Breakout on low delivery, Nifty 200 | +1.53% (59%) | +1.33% (58%) |
| Large cap ACC | −0.98% (44%) | −1.13% (45%) |
| Large cap DIS | +0.96% (58%) | **+0.43% (53%)**: much of the rebound happens on day t+1 |
| Micro cap SPU | −0.91% (46%) | −0.67% (47%) |

### Named FII/DII bulk/block deals

Script: [scripts/signal_fwd4.py](scripts/signal_fwd4.py).

- **Data:** 19,047 deal rows, 2025-11-03 → 2026-11-13.
- **Clients:** classified with the 04 §5.3 keyword heuristic (no `entities.json` yet). MF, insurance, pension and banks count as DII; names that look like FPIs count as FII.
- **Round trips:** same-day round trips were dropped: 5,010 of 11,958 client-stock-days, which are mostly proprietary/arbitrage traders. Of the rest, 901 client-stock-days are FII, 495 DII and 5,552 Other.
- **Caveat:** the historical endpoint returns at most 70 records per request, so **218 of 256 bulk-deal days are truncated**. Only days collected from the daily file are complete.
- **Event:** a liquid EQ stock-day where the category's net value via deals is > 0 (buy) or < 0 (sell). The benchmark is the all-stock median.

| Event | n | days | +20d at close(t) | +5d at t+1 | +20d at t+1 |
|-------|---|------|------------------|------------|-------------|
| FII net buy | 124 | 95 | +0.61% (52%) | +0.32% (51%) | −0.01% (50%) |
| FII net sell | 163 | 107 | +1.47% (57%) | +0.75% (56%) | +1.37% (55%) |
| DII net buy | 131 | 94 | +2.13% (59%) | +0.32% (53%) | +1.05% (56%) |
| FII buy ≥ ₹25 Cr | 80 | 65 | +1.52% (58%) | +0.90% (58%) | +1.10% (57%) |
| DII buy ≥ ₹25 Cr | 114 | 85 | +2.07% (60%) | +0.69% (55%) | +1.20% (58%) |
| FII sell ≥ ₹25 Cr | 101 | 66 | +3.53% (64%) | +1.00% (61%) | **+2.84% (62%)** |
| FII and DII both net buy | 44 | 38 | +2.25% (62%) | +1.37% (63%) | +1.02% (57%) |
| **FII sells, DII buys** | 35 | 32 | +5.43% (71%) | +0.97% (59%) | **+4.85% (71%)** |
| FII+DII net buy + delivery ≥ 2× | 107 | 79 | +0.04% (50%) | −0.03% (49%) | −0.54% (49%) |
| **Other/unclassified net buy only** | 776 | 246 | −1.38% (45%) | −1.16% (42%) | **−1.36% (45%)** |

DII net sell and "FII buys, DII sells" had n < 30.

### Named FII/DII deals, re-run with entity categories (Phase 4, 2026-11-14)

The tables above used a keyword heuristic for the client categories. The re-run uses the entity seeds and the category rules of the product (`config/entities.json` through `pipeline/entities.py`) and the same flows as `deals/flows.json` (`pipeline/deals.py`). Script: [scripts/signal_fwd4.py](scripts/signal_fwd4.py), run as `python -I scripts/signal_fwd4.py <project root>`. The old tables above are kept.

- **Data:** 16,315 deal rows for stocks in the daily data, 2025-11-03 to 2026-11-13 (16,599 in the build, which also keeps names outside the daily data). Round trips dropped: 9,879 rows (same entity, same stock, same day, buy and sell within 10%).
- **Categories:** 21.8% of gross deal value is FII, 9.0% DII and 69.2% Other (mostly domestic brokers and proprietary desks, which name rules cannot place). Stock-days with a net: FII 419, DII 140, Other 2,199.
- **History gap (read first):** the historical bulk-deal endpoint returns at most 70 records per request, so **218 of the 256 bulk-deal days before 2026-11-14 are truncated** (`store/deals/_backfill.json`). Only daily collection from 2026-11-14 is complete. The history below is therefore a lower bound on deal activity on busy days, and the 1-year sample is small. Read every number here as a description of one sample period, not a forecast.
- **Event:** a liquid EQ stock-day with a category's net value via deals above zero (net bought) or below zero (net sold). Benchmark: the same-day median of all liquid stocks. Forward returns exclude windows that cross a price adjustment.

| Event | n | days | +20d at close(t) | +5d at t+1 | +20d at t+1 |
|-------|---|------|------------------|------------|-------------|
| FII net buy | 137 | 100 | −0.06% (49%) | −0.06% (49%) | +0.72% (52%) |
| FII net sell | 180 | 113 | +1.16% (57%) | +0.86% (58%) | +0.82% (55%) |
| DII net buy | 122 | 89 | +2.05% (59%) | +0.33% (53%) | +0.85% (55%) |
| FII buy ≥ ₹25 Cr | 90 | 70 | +1.01% (51%) | +0.47% (52%) | +1.11% (56%) |
| DII buy ≥ ₹25 Cr | 109 | 82 | +2.05% (60%) | +0.69% (55%) | +1.02% (58%) |
| FII sell ≤ −₹25 Cr | 116 | 77 | +2.37% (65%) | +1.21% (64%) | +1.97% (61%) |
| FII and DII both net buy | 37 | 31 | +2.23% (58%) | +1.25% (61%) | +0.85% (56%) |
| **FII sells, DII buys** | 41 | 37 | **+3.86% (72%)** | +1.00% (62%) | **+3.18% (69%)** |
| Institutional net buy + delivery ≥ 2× | 117 | 87 | −0.73% (46%) | −0.81% (45%) | −0.34% (49%) |
| **Other/unclassified net buy only** | 732 | 246 | −1.33% (44%) | −1.19% (42%) | **−1.49% (45%)** |

DII net sell (n 17), "FII buys, DII sells" (n 5), institutional net buy with price up (n 17) and the ≥ ₹25 Cr sell for DII (n 11) have n < 30 and are not read.

**What changed against the heuristic tables.** The direction of the main findings holds: "FII sells, DII buys" is still the strongest group, and "Other net buy only" is still negative. The sizes moved. The handover group is now +3.18% at +20 days from t+1 (n 41), against +4.85% (n 35) before, and the "Other" group is −1.49% (n 732), against −1.36% (n 776). One difference is that the keyword rule put the Goldman Sachs Bank Europe accounts in DII (the word BANK), while the ODI rule now places them in FII. Other names moved for the same kind of reason. The FII-sell-at-least-₹25-Cr group had +2.84% (n 101) and is now +1.97% (n 116), still positive. None of the rows says the deals predict anything: the same caveats as above apply, and the history gap means the 1-year sample is incomplete on busy days.

## Conclusions

1. **A heavy-delivery up day is not a buy signal by itself.** Its follow-through was flat to negative in every cap bucket, and worst in large caps.
2. **In large caps, the heavy-delivery day's move tended to reverse.** DIS beat the bucket median 58% of the time, while ACC trailed. Heavy delivery in big stocks is often institutional rebalancing, and the price impact fades.
3. **A rise on low delivery faded, but only in small and micro caps.** In large caps it didn't.
4. **Heavy delivery with a flat price helped only in small and micro caps.**
5. **Breakouts to a new 52-week high were the strongest pattern, and heavy delivery weakened them.** A breakout on heavy delivery looks like holders selling into the high. With ETFs out, the gap widened: +2.50% on low delivery against +0.87% on heavy delivery (it was +1.70% against +0.67%).
6. Delivery streaks showed no edge.
7. **F&O build-up on its own showed no edge, and long build-up did not rescue a heavy-delivery up day.** ACC + long build-up came out at −1.0%, beating the median 46% of the time. That is the textbook "confirmation", and it didn't work here. ACC + short covering was the weakest at 42%: up-moves driven by shorts covering faded.
8. **Heavy-delivery down days in F&O stocks rebounded slightly** (DIS +0.6%, and +1.0% with short build-up). The exception was long unwinding: DIS + LU continued lower (−2.0%, 40%). That sample is small (103 events on 57 days), so treat it as a hypothesis to track, not a finding.
9. **The named-deal results are the most striking, but they rest on the thinnest data.** Large FII sales via deals (often a fund exiting through a block) were followed by outperformance (+2.8%, 62%). The "FII sells, DII buys" handover did best of all (+4.9%, 71%), but that is only 35 events. Bulk buying by *non-institutional* names alone was followed by underperformance (−1.4%, 45%, n = 776), a little weaker than the +1.7% / 44% seen with ETFs included. That is the most robust deals result: it fits operator-style activity in small stocks.
10. **The breakout findings survive next-day entry.** The large-cap DIS rebound mostly does not; it halves.

## Caveats

- One year, in a period when momentum worked well.
- Effects are about 1–1.5% over 20 days, before costs.
- Cap buckets and Nifty 200 membership are *current* values, applied to the whole year.
- Events overlap (the same stock on consecutive days), and 20-day windows overlap.
- Thresholds are the spec defaults (`config/signals.json`) and were not tuned. They must not be tuned on this same sample.

## Still to test

- Re-run the deals study after Phase 4 builds `entities.json`, which will classify clients properly, and again as complete daily deal files accumulate.
- *(Done 2026-11-14: delivery + F&O build-up, and named deals, above. The S3 extract history was loaded into `store/fo_extract/` by a standalone loader in the spec's format.)*

## What the ETF re-run changed (2026-11-14)

- No conclusion changed direction. ETFs have no cap bucket, so the cap-bucket cells did not move because of the ETF exclusion; the small shifts there (for example micro-cap SPU −1.04% to −0.91%, micro-cap ACC −0.37% to −0.14%) come from the `signal_fwd2.py` price fix described under Method, which keeps forward windows that end on a day the stock was flagged low-liquidity. Only the all-stock rows and the breakout rows moved because of the ETF exclusion.
- Strength changed in two places. The breakout edge on low delivery grew (+1.70% to +2.50%), and the deals table moved by up to 1 pp in its 20-day cells with the same signs (FII sell ≥ ₹25 Cr: +2.53% to +2.84%; non-institutional buying only: −1.69% to −1.36%).
- The F&O build-up table is unchanged: no ETF has stock futures.
- The replication reference for `stats/signal_perf.json` is now the scripts' output (see the test), not a table typed into this document.

## How this changed the specs (2026-11-14)

- Signal labels describe what happened, not what will happen (04 §4).
- Signal performance by cap bucket moved from Phase 5 to Phase 3. It is shown next to every signal badge.
- New Screener presets: breakout on low delivery, breakout on heavy delivery, and "Large cap: down on heavy delivery".
- Fixed the S13 52-week-high flag rule (file T covers highs through T−1).
