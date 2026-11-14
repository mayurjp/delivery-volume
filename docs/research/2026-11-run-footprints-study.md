# What came before and during big price runs

## Update 2026-11-14: 3 years (744 trading days, 2023-11-15 → 2026-11-13)

This rerun covers the full store plus `.history_staging`, with the same method and universe (the top 750 by *current* market cap, so there is more survivorship bias over 3 years). It found **3,095 up-runs and 2,377 down-runs**, starting from 2024-03-07. Command: `python -I scripts/run_footprints.py <root> <root>/.history_staging`.

### Footprints around runs (median)

| Feature | Before UP runs | Before DOWN runs | Ordinary |
|---------|---------------|------------------|----------|
| Price change over the 20 days | −11.5% | +11.9% | −0.1% |
| Delivery value vs before | 0.89× | **1.14×** | 0.93× |
| Turnover vs before | **0.82×** | **1.16×** | 0.90× |
| Delivery % change | **+2.8 pp** | −1.2 pp | +1.3 pp |
| Average trade size vs before | 0.92× | **1.08×** | 0.99× |
| Delivery on up days ÷ down days | 0.62× | **2.16×** | 1.10× |
| *First 5 days:* delivery value vs before | 0.88× | 1.02× | 0.93× |
| *First 5 days:* delivery % change | −0.2 pp | +0.9 pp | +1.3 pp |

### Odds of a big move in the next 20 days, by feature quintile (no hindsight; n = 406,595 stock-days)

- **Base rates:** big UP (≥ +15%) **9.1%**, big DOWN (≤ −15%) **4.5%**. The 2024–25 correction is in the sample, so the base rates are more balanced than in the 1-year run.

| Feature | Big UP, Q1 → Q5 | Big DOWN, Q1 → Q5 |
|---------|-----------------|-------------------|
| Delivery value vs before | 8.3 → **11.0%** | 4.7 → 4.7% |
| Turnover vs before | 8.9 → **10.8%** | 4.7 → 4.9% |
| Delivery-spike days | 8.4 → **10.8%** | 4.4 → 4.8% |
| Average trade size vs before | 9.1 → 10.2% | 4.8 → 4.6% |
| Delivery % change | 9.5 → 9.5% | 4.9 → 4.4% |
| Delivery on up days ÷ down days | 8.5 → 9.3% | 4.2 → **5.0%** |
| Price change over 20 days | 11.3 → 10.9% (U-shaped) | 5.0 → 5.4% (U-shaped) |

### Biggest up-runs among the top 200

| Stock | Run | Move | Footprint before the run |
|-------|-----|------|--------------------------|
| WELCORP | 2026-01-27 → 2026-09-10 | +285% | Quiet: delivery 0.92×, mostly on down days (0.52×). Light delivery in the first 5 days. |
| PAYTM | 2024-05-08 → 2024-12-30 | +222% | After a collapse: delivery 0.28× normal, trade size 0.49×. Exhaustion, not accumulation. |
| NATIONALUM | 2025-04-11 → 2026-01-29 | +199% | **Heavy delivery (1.60×), concentrated on down days (0.24×)**: holders absorbing a decline. It stayed heavy in the first 5 days (1.72×). |

### What held up over 3 years, and what changed

1. **Held up:** big up-runs began after **quiet declines**, with lower turnover and a *rising* delivery share. Big down-runs began after **loud rallies**, with higher turnover, delivery value and trade size, and delivery concentrated on up days.
2. **Held up:** rising delivery value, turnover and spike days raise the chance of a big up move by about **+20–30%** relative to the base rate (8.3% → 11.0%), and do *not* raise the chance of a big fall.
3. **Weakened:** "delivery concentrated on up days" as a crash warning. In the 1-year sample it went from 2.2% to 4.9%; over 3 years it is only **4.2% → 5.0%**. It is a mild warning, not a strong one.
4. **Did not hold:** "holders exit at the start of down-runs". The first-5-day delivery % change (+0.9 pp) is below ordinary.
5. **Big runs start in different ways:** quiet bases (WELCORP), exhaustion after a collapse (PAYTM), or visible absorption on down days (NATIONALUM). The per-stock Runs tab (07) exists so each case can be read individually.

The 1-year study below is kept for reference.

---

## Original study (Nov 2025 – Nov 2026, 1 year)

**Question (from the user):** which parameters, especially volume and delivery volume by big players, influenced a stock's big runs up or down? Can these footprints tell us that long-term buying or selling is under way?

**Data:**

- Raw S1 delivery files for 256 trading days (`store/cm_delivery`).
- Universe: the 750 largest stocks by current market cap. ETFs are excluded, because they are not in the market-cap file.
- Prices are back-adjusted for splits and bonuses.

Script: [scripts/run_footprints.py](scripts/run_footprints.py).

**Method:**

- **Run detection:** a zig-zag on adjusted close with a 12% reversal. A *run* is a leg of ≥ 20% lasting ≥ 5 days. This found **905 up-runs and 570 down-runs** starting between 2026-02-25 and 2026-11. The first 80 days are used as history.
- **Windows:**
  - *pre* = the 20 trading days up to the run's start (the pivot);
  - *base* = the 60 days before that;
  - *early* = the first 5 days of the run.
- **Features**, all value-based so splits don't distort them:
  - delivery value and turnover vs base;
  - delivery % change;
  - average trade size (turnover ÷ trades) vs base;
  - **delivery on up days ÷ delivery on down days**;
  - the number of delivery-spike days;
  - the price change.
- **"Ordinary"** = the same features for every eligible stock-day.

## A. Footprints around runs (median; hindsight-defined runs)

| Feature | Before UP runs | Before DOWN runs | Ordinary |
|---------|---------------|------------------|----------|
| Price change over the 20 days | **−13.1%** | **+13.2%** | +0.1% |
| Delivery value vs before | 0.94× | **1.21×** | 0.98× |
| Turnover vs before | **0.87×** | **1.20×** | 0.93× |
| Delivery % change | **+3.2 pp** | −0.4 pp | +1.6 pp |
| Average trade size vs before | 0.93× | **1.10×** | 1.00× |
| Delivery on up days ÷ down days | 0.61× | **2.36×** | 1.13× |
| Delivery-spike days (of 20) | 1 | **3** | 2 |

| First 5 days of the run | UP runs | DOWN runs | Ordinary |
|-------------------------|---------|-----------|----------|
| Delivery value vs before | 0.95× | 1.09× | 0.98× |
| Delivery % change | **−0.2 pp** | **+2.8 pp** | +1.6 pp |
| Average trade size vs before | 0.96× | 1.06× | 1.00× |

How to read this:

- **Big up-runs began after quiet declines.** Price fell about 13% on *lower* turnover and delivery value, while the share of volume taken as delivery *rose*. Sellers were drying up, and what did trade went to holders.
- **Big down-runs began after loud rallies.** Price rose about 13% on higher turnover, higher delivery value and larger trades. Delivery was concentrated on up days (2.4×), with more spike days. That is consistent with large holders selling into strength.
- **Up-runs did not start on heavy delivery.** In their first 5 days, delivery value was normal and delivery % slightly *lower*, so trader volume led. Down-runs started with delivery % rising, consistent with holders exiting.
- **The three biggest up-runs among the top 200 all started quietly.** LAURUSLABS (+160% from 19 Mar), GLAND (+109%) and OFSS (+99%) had delivery at 0.56–0.84× normal, mostly on down days, with no visible accumulation footprint at the start.

## B. Does a footprint raise the odds of a big move? (no hindsight)

For every stock-day: features over the last 20 days vs the 60 before; outcome = the return from the next close over 20 days.

- **Base rates:** a big UP (≥ +15%) followed **11.2%** of the time and a big DOWN (≤ −15%) **3.3%** of the time, over 109,205 stock-days. This was a rising year.
- The table shows the chance by feature quintile: Q1 = lowest 20% of values, Q5 = highest.

| Feature | Big UP Q1 → Q5 | Big DOWN Q1 → Q5 |
|---------|----------------|------------------|
| Delivery value vs before | 9.3 → **13.9%** | 3.2 → 3.7% |
| Turnover vs before | 10.8 → 13.3% | 3.3 → 3.6% |
| Average trade size vs before | 10.8 → 13.0% | 3.5 → 3.5% |
| Delivery % change | 11.6 → 12.6% | 3.3 → 3.3% |
| Delivery on up days ÷ down days | 11.8 → 10.2% | **2.2 → 4.9%** |
| Delivery-spike days | 10.2 → 11.5% | 3.2 → 4.2% |
| Price change over 20 days | **16.2** → 11.6% | 2.3 → 4.9% |

- Rising delivery value and turnover modestly raise the chance of a big up move, by about +25% relative to the base rate.
- **Delivery concentrated on up days more than doubles the chance of a big fall** (2.2% → 4.9%). It does not raise the chance of a further rise. This is the strongest single warning sign in the data, but it is entangled with the prior 20-day rally.

## Caveats

- One rising year. Only about 9 months of runs, after the 80-day history window.
- The features are correlated with each other and with recent price change and volatility. There is no multivariate control yet.
- Part A uses hindsight to define runs. Part B does not.
- None of this shows *who* took delivery. Named footprints (deals, quarterly holdings) and F&O positioning are not in this study yet.
- **Long-term "smart money" shifts (3–12 months) can't be tested on one year.** That needs a longer history and quarterly holdings.

## What this means for the app

1. Show every stock's runs with these footprints, so the user can learn the pattern stock by stock. Spec: [07-run-forensics.md](../specs/07-run-forensics.md).
2. Treat a **loud, delivery-heavy rally** as the warning it was here, not as confirmation.
3. Long-term accumulation or distribution needs the **quarterly holdings** (Phase 4B), **named deals** (Phase 4) and **longer delivery history**.
