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
