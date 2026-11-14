/**
 * Period aggregation (08-timeframes.md): `aggregatePeriods(rows, tf, tradingDays, cfg)` and `aggregateRange(rows, a, b)`.
 * Pure functions, the TypeScript twins of `aggregate_periods` / `aggregate_range` in pipeline/metrics.py; both are tested
 * on the same shared vectors (periodVectors.json). Dates are ISO strings handled by parts, never parsed as UTC dates.
 *
 * Rows are one stock's daily rows (symbols/{f}.json, sorted by date, with prevClose). Prices of a period are expressed in
 * the basis of its LAST day, so ret = close / prevClose - 1 holds across a split (`adjusted` = 1 marks those periods).
 * NSE's PREV_CLOSE is raw on a split ex-date, so splits are found from close-to-close ratios (see adjustmentEvents).
 */

export type PeriodTf = 'w' | 'm' | 'q';
export type BarSpec = PeriodTf | { kind: 'n'; n: number };

export interface PeriodCfg {
  base: number;
  long: number;
  minHistory: number;
  daysPerPeriod: number;
  ACC?: { retMin: number; spikeMin: number; delivPctDiffMin: number; clvMin: number };
  DIS?: { retMax: number; spikeMin: number; delivPctDiffMin: number; clvMax: number };
  ABS?: { absRetMax: number; spikeMin: number; delivPctDiffMin: number };
  SPU?: { retMin: number; relTurnoverMin: number; delivPctDiffMax: number };
  SPD?: { retMax: number; relTurnoverMin: number; delivPctDiffMax: number };
}

/** The `config` block of periods.json. */
export interface PeriodsConfig {
  minPeriodsFraction: number;
  liquidity: { minTurnoverAvg20Cr: number; minBaseDelivValCr: number };
  periods: Record<PeriodTf, PeriodCfg>;
}

/** The daily-row fields the aggregation reads (a subset of SymbolRow). */
export interface AggInput {
  date: string;
  series: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  prevClose: number | null;
  vwap: number | null;
  vol: number | null;
  turnoverCr: number | null;
  trades: number | null;
  delivQty: number | null;
  flags: number;
}

export interface Period {
  key: string;
  /** First and last TRADING day inside the period. */
  start: string;
  end: string;
  tradingDays: number;
  daysIn: number;
  daysExpected: number;
  partial: boolean;
  dates: string[];
}

export interface PeriodRow {
  key: string;
  start: string;
  end: string;
  daysIn: number;
  daysExpected: number;
  partial: boolean;
  /** Valid delivery days of this stock in the period. */
  days: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  prevClose: number | null;
  vwap: number | null;
  vol: number | null;
  turnoverCr: number | null;
  trades: number | null;
  delivQty: number | null;
  delivValCr: number | null;
  delivPct: number | null;
  ret: number | null;
  clv: number | null;
  avgTradeSize: number | null;
  delivBalance: number | null;
  delivValAvgN: number | null;
  delivPctAvgN: number | null;
  turnoverAvgCr: number | null;
  spike: number | null;
  delivPctDiff: number | null;
  relTurnover: number | null;
  tradeSizeRatio: number | null;
  delivPctZ: number | null;
  delivPctPctile: number | null;
  streak: number | null;
  signal: string | null;
  flags: number;
  adjusted: number;
}

const DAY_MS = 86_400_000;
const FLAG_LOWLIQ = 256;
const FLAG_ETF = 512;
const FLAG_NEWLISTING = 1024;

// ---- calendar -----------------------------------------------------------------------------------------------------

function dayNum(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;
}

function isoOf(n: number): string {
  const d = new Date(n * DAY_MS);
  const p = (x: number, w: number) => String(x).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1, 2)}-${p(d.getUTCDate(), 2)}`;
}

/** Monday = 0 ... Sunday = 6. */
function weekday(n: number): number {
  return (((n + 3) % 7) + 7) % 7; // day 0 (1970-01-01) was a Thursday
}

/** ISO year and week of a day number. */
function isoWeek(n: number): [number, number] {
  const thursday = n - weekday(n) + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1) / DAY_MS;
  return [year, Math.floor((thursday - jan1) / 7) + 1];
}

/** Key of the calendar period holding `iso`: ISO week 2026-W46 (Mon-Sun, a Sunday session stays in its week), month 2026-11, quarter 2026-Q4. */
export function periodKey(iso: string, tf: PeriodTf): string {
  if (tf === 'm') return iso.slice(0, 7);
  if (tf === 'q') return `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
  const [y, w] = isoWeek(dayNum(iso));
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** Calendar start and end (inclusive) of a period key, as day numbers. */
function periodBounds(key: string, tf: PeriodTf): [number, number] {
  const y = Number(key.slice(0, 4));
  if (tf === 'w') {
    const jan4 = Date.UTC(y, 0, 4) / DAY_MS;
    const mon = jan4 - weekday(jan4) + (Number(key.slice(6)) - 1) * 7;
    return [mon, mon + 6];
  }
  if (tf === 'm') {
    const m = Number(key.slice(5, 7));
    return [Date.UTC(y, m - 1, 1) / DAY_MS, Date.UTC(y, m, 0) / DAY_MS];
  }
  const q = Number(key.slice(6));
  return [Date.UTC(y, (q - 1) * 3, 1) / DAY_MS, Date.UTC(y, q * 3, 0) / DAY_MS];
}

/**
 * The periods of the market calendar. A calendar period is partial while a Monday-Friday date in it is neither a trading
 * day nor a known holiday: a date after the latest trading day (not yet traded) or before the first stored day. A weekday
 * between the first and the latest day that is not a trading day is a holiday. A Sunday session counts in daysIn.
 * `{kind:'n', n}`: N-trading-day bars aligned to END at the latest date (the first bar may be short and partial).
 */
export function periodsFor(tradingDays: readonly string[], tf: BarSpec): Period[] {
  const days = [...tradingDays];
  const out: Period[] = [];
  if (days.length === 0) return out;
  if (typeof tf === 'object') {
    for (let e = days.length; e > 0; e -= tf.n) {
      const chunk = days.slice(Math.max(0, e - tf.n), e);
      out.push({
        key: chunk[chunk.length - 1]!,
        start: chunk[0]!,
        end: chunk[chunk.length - 1]!,
        tradingDays: chunk.length,
        daysIn: chunk.length,
        daysExpected: tf.n,
        partial: chunk.length < tf.n,
        dates: chunk,
      });
    }
    return out.reverse();
  }
  const latest = days[days.length - 1]!;
  const first = days[0]!;
  const have = new Set(days);
  const by = new Map<string, string[]>();
  for (const d of days) {
    const k = periodKey(d, tf);
    const list = by.get(k);
    if (list) list.push(d);
    else by.set(k, [d]);
  }
  for (const [key, ds] of by) {
    const [c0, c1] = periodBounds(key, tf);
    let missing = 0;
    for (let o = c0; o <= c1; o++) {
      const iso = isoOf(o);
      if (have.has(iso) || weekday(o) >= 5) continue;
      if (iso > latest || iso < first) missing++;
    }
    out.push({
      key,
      start: ds[0]!,
      end: ds[ds.length - 1]!,
      tradingDays: ds.length,
      daysIn: ds.length,
      daysExpected: ds.length + missing,
      partial: missing > 0,
      dates: ds,
    });
  }
  return out;
}

// ---- price adjustments -----------------------------------------------------------------------------------------------

const RATIOS_DOWN = [
  1 / 2,
  1 / 3,
  1 / 4,
  1 / 5,
  1 / 6,
  1 / 8,
  1 / 10,
  1 / 20,
  1 / 25,
  1 / 50,
  1 / 100,
  2 / 3,
  3 / 4,
  2 / 5,
  3 / 5,
];
const RATIOS_UP = [2, 3, 4, 5, 10, 20, 50, 100];
const CANDIDATES = [...new Set([...RATIOS_DOWN, ...RATIOS_UP])].sort((a, b) => a - b);
const SPLIT_MAX_DOWN = 0.78;
const SPLIT_MIN_UP = 1.8;
const SPLIT_TOL = 0.1;

/**
 * Factor of the corporate-action event of each row (1 = none): the day's close(t) / close(t-1) is at most 0.78 or at least
 * 1.8 AND within 10% of a corporate-action ratio (1:2, 1:3, 1:5, 1:10, bonus 1:1 = 1/2, 1:2 = 2/3, consolidations 2..100).
 * The factor is that exact ratio (the observed ratio also contains the day's own move). Mirrors adjustment_events in Python.
 */
export function adjustmentFactors(closes: readonly (number | null)[]): number[] {
  const f: number[] = new Array<number>(closes.length).fill(1);
  for (let i = 1; i < closes.length; i++) {
    const c = closes[i];
    const p = closes[i - 1];
    if (c == null || p == null || !(p > 0)) continue;
    const obs = c / p;
    if (!(obs <= SPLIT_MAX_DOWN || obs >= SPLIT_MIN_UP)) continue;
    let best = CANDIDATES[0]!;
    let bestD = Infinity;
    for (const cand of CANDIDATES) {
      const d = Math.abs(Math.log(obs / cand));
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    }
    if (Math.abs(obs / best - 1) <= SPLIT_TOL && best < 1 === obs < 1) f[i] = best;
  }
  return f;
}

/** A(t): factor turning day-t prices into the prices of the latest day's basis (product of the event factors after t). */
export function priceAdjustment(closes: readonly (number | null)[]): number[] {
  const f = adjustmentFactors(closes);
  const A: number[] = new Array<number>(closes.length).fill(1);
  for (let i = closes.length - 2; i >= 0; i--) A[i] = Math.round(A[i + 1]! * f[i + 1]! * 1e12) / 1e12;
  return A;
}

// ---- the aggregation ------------------------------------------------------------------------------------------------

const num = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const orNull = (v: number): number | null => (Number.isFinite(v) ? v : null);
const zero = (v: number): number => (Number.isFinite(v) ? v : 0);

interface Agg {
  pi: number;
  days: number;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  vwap: number;
  vol: number;
  turnoverCr: number;
  trades: number;
  delivQty: number;
  delivValCr: number;
  delivPct: number;
  ret: number;
  clv: number;
  avgTradeSize: number;
  delivBalance: number;
  adjusted: number;
  flags: number;
}

/** Segment reductions over one stock's rows: one Agg per period that holds a valid delivery day. */
function groups(rows: readonly AggInput[], periods: readonly Period[]): Agg[] {
  const pidx = new Map<string, number>();
  periods.forEach((p, i) => p.dates.forEach((d) => pidx.set(d, i)));
  const closes = rows.map((r) => r.close);
  const A = priceAdjustment(closes);
  const out: Agg[] = [];
  let i = 0;
  while (i < rows.length) {
    const pi = pidx.get(rows[i]!.date);
    if (pi === undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < rows.length && pidx.get(rows[j + 1]!.date) === pi) j++;
    const aLast = A[j]!;
    let days = 0;
    let turn = 0;
    let dval = 0;
    let trades = 0;
    let dq = 0;
    let volSum = 0;
    let volBasis = 0;
    let upV = 0;
    let dnV = 0;
    let hi = -Infinity;
    let lo = Infinity;
    let flags = 0;
    let aMax = -Infinity;
    let aMin = Infinity;
    for (let k = i; k <= j; k++) {
      const r = rows[k]!;
      const B = A[k]! / aLast;
      aMax = Math.max(aMax, A[k]!);
      aMin = Math.min(aMin, A[k]!);
      hi = Math.max(hi, num(r.high) * B);
      lo = Math.min(lo, num(r.low) * B);
      flags |= r.flags;
      const valid = r.series === 'EQ' && r.delivQty != null && (r.vol ?? 0) > 0;
      if (!valid) continue;
      days++;
      const tv = zero(num(r.turnoverCr));
      const dv = zero((num(r.delivQty) * num(r.vwap)) / 1e7);
      const vol = zero(num(r.vol));
      turn += tv;
      dval += dv;
      trades += zero(num(r.trades));
      dq += zero(num(r.delivQty));
      volSum += vol;
      volBasis += vol / B;
      const c = num(r.close);
      const pc = num(r.prevClose);
      if (c > pc) upV += dv;
      if (c < pc) dnV += dv;
    }
    const close = num(rows[j]!.close);
    const open = num(rows[i]!.open) * (A[i]! / aLast);
    const prior = i > 0 ? i - 1 : -1;
    const priorClose = prior >= 0 ? num(rows[prior]!.close) : NaN;
    const hasPrior = Number.isFinite(priorClose);
    const pc = hasPrior ? (priorClose * A[prior]!) / aLast : (num(rows[i]!.prevClose) * A[i]!) / aLast;
    const rng = hi - lo;
    const within = Math.abs(Math.log(aMax / aMin)) > 1e-9;
    const atStart = hasPrior && Math.abs(A[prior]! / A[i]! - 1) > 1e-9;
    out.push({
      pi,
      days,
      open,
      high: hi,
      low: lo,
      close,
      prevClose: pc,
      vwap: volBasis > 0 ? (turn * 1e7) / volBasis : NaN,
      vol: volSum,
      turnoverCr: turn,
      trades,
      delivQty: dq,
      delivValCr: dval,
      delivPct: turn > 0 ? (dval / turn) * 100 : NaN,
      ret: (close / (pc > 0 ? pc : NaN) - 1) * 100,
      clv: rng > 0 ? (close - lo - (hi - close)) / rng : 0,
      avgTradeSize: trades > 0 ? (turn * 1e7) / trades : NaN,
      delivBalance: dnV > 0 ? upV / dnV : NaN,
      adjusted: within || atStart ? 1 : 0,
      flags,
    });
    i = j + 1;
  }
  return out.filter((g) => g.days > 0);
}

const minPeriods = (window: number, fraction: number): number => Math.max(1, Math.ceil(window * fraction));

/** Rolling statistic over the `window` rows BEFORE row i (position window; NaN cells are skipped). */
function priorRoll(x: readonly number[], window: number, how: 'mean' | 'sum' | 'std', mp: number): number[] {
  const out: number[] = new Array<number>(x.length).fill(NaN);
  for (let i = 0; i < x.length; i++) {
    let n = 0;
    let s = 0;
    for (let k = Math.max(0, i - window); k < i; k++) {
      const v = x[k]!;
      if (Number.isNaN(v)) continue;
      n++;
      s += v;
    }
    if (n < mp) continue;
    if (how === 'sum') out[i] = s;
    else if (how === 'mean') out[i] = s / n;
    else if (n >= 2) {
      const m = s / n;
      let ss = 0;
      for (let k = Math.max(0, i - window); k < i; k++) {
        const v = x[k]!;
        if (!Number.isNaN(v)) ss += (v - m) * (v - m);
      }
      out[i] = Math.sqrt(ss / (n - 1));
    }
  }
  return out;
}

/** Share (0-100) of the last `window` values, itself included, that are <= the value. */
function pctileRank(x: readonly number[], window: number, mp: number): number[] {
  const out: number[] = new Array<number>(x.length).fill(NaN);
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    if (Number.isNaN(v)) continue;
    let cnt = 0;
    let le = 0;
    for (let k = Math.max(0, i - window + 1); k <= i; k++) {
      const w = x[k]!;
      if (Number.isNaN(w)) continue;
      cnt++;
      if (w <= v) le++;
    }
    if (cnt >= mp) out[i] = (le / cnt) * 100;
  }
  return out;
}

function classify(
  cfg: PeriodCfg,
  r: { ret: number; spike: number; delivPctDiff: number; clv: number; relTurnover: number },
): string | null {
  const { ACC, DIS, ABS, SPU, SPD } = cfg;
  if (!ACC || !DIS || !ABS || !SPU || !SPD) return null;
  if (
    r.ret >= ACC.retMin &&
    r.spike >= ACC.spikeMin &&
    r.delivPctDiff >= ACC.delivPctDiffMin &&
    r.clv >= ACC.clvMin
  )
    return 'ACC';
  if (
    r.ret <= DIS.retMax &&
    r.spike >= DIS.spikeMin &&
    r.delivPctDiff >= DIS.delivPctDiffMin &&
    r.clv <= DIS.clvMax
  )
    return 'DIS';
  if (Math.abs(r.ret) < ABS.absRetMax && r.spike >= ABS.spikeMin && r.delivPctDiff >= ABS.delivPctDiffMin)
    return 'ABS';
  if (r.ret >= SPU.retMin && r.relTurnover >= SPU.relTurnoverMin && r.delivPctDiff <= SPU.delivPctDiffMax)
    return 'SPU';
  if (r.ret <= SPD.retMax && r.relTurnover >= SPD.relTurnoverMin && r.delivPctDiff <= SPD.delivPctDiffMax)
    return 'SPD';
  return null;
}

function toRow(g: Agg, p: Period): PeriodRow {
  const int = (v: number): number | null => (Number.isFinite(v) ? Math.round(v) : null);
  return {
    key: p.key,
    start: p.start,
    end: p.end,
    daysIn: p.daysIn,
    daysExpected: p.daysExpected,
    partial: p.partial,
    days: g.days,
    open: orNull(g.open),
    high: orNull(g.high),
    low: orNull(g.low),
    close: orNull(g.close),
    prevClose: orNull(g.prevClose),
    vwap: orNull(g.vwap),
    vol: int(g.vol),
    turnoverCr: orNull(g.turnoverCr),
    trades: int(g.trades),
    delivQty: int(g.delivQty),
    delivValCr: orNull(g.delivValCr),
    delivPct: orNull(g.delivPct),
    ret: orNull(g.ret),
    clv: orNull(g.clv),
    avgTradeSize: orNull(g.avgTradeSize),
    delivBalance: orNull(g.delivBalance),
    delivValAvgN: null,
    delivPctAvgN: null,
    turnoverAvgCr: null,
    spike: null,
    delivPctDiff: null,
    relTurnover: null,
    tradeSizeRatio: null,
    delivPctZ: null,
    delivPctPctile: null,
    streak: null,
    signal: null,
    flags: g.flags,
    adjusted: g.adjusted,
  };
}

function baselines(aggs: Agg[], out: PeriodRow[], tf: BarSpec, cfg: PeriodsConfig, etf: boolean): void {
  const kind: PeriodTf = typeof tf === 'object' ? 'w' : tf;
  const pc = cfg.periods[kind];
  const N = pc.base;
  const L = pc.long;
  const frac = cfg.minPeriodsFraction;
  const liq = cfg.liquidity;
  const n = aggs.length;
  const comp = out.map((r) => !r.partial); // a partial period never enters a baseline
  const mask = (f: (g: Agg) => number): number[] => aggs.map((g, i) => (comp[i] ? f(g) : NaN));
  const dvM = mask((g) => g.delivValCr);
  const tvM = mask((g) => g.turnoverCr);
  const dpM = mask((g) => g.delivPct);
  const dvAvg = priorRoll(dvM, N, 'mean', minPeriods(N, frac));
  const dvSum = priorRoll(dvM, N, 'sum', minPeriods(N, frac));
  const tvSum = priorRoll(tvM, N, 'sum', minPeriods(N, frac));
  const tvMean = priorRoll(tvM, N, 'mean', minPeriods(N, frac));
  const perDay = priorRoll(
    mask((g) => g.turnoverCr / g.days),
    N,
    'mean',
    minPeriods(N, frac),
  );
  const tsMean = priorRoll(
    mask((g) => g.avgTradeSize),
    N,
    'mean',
    minPeriods(N, frac),
  );
  const zMean = priorRoll(dpM, L, 'mean', minPeriods(L, frac));
  const zStd = priorRoll(dpM, L, 'std', minPeriods(L, frac));
  const pct = pctileRank(dpM, L, minPeriods(L, frac));
  let prevSign = NaN;
  let run = 0;
  let priorComplete = 0;
  for (let i = 0; i < n; i++) {
    const g = aggs[i]!;
    const r = out[i]!;
    const delivPctAvgN = tvSum[i]! > 0 ? (dvSum[i]! / tvSum[i]!) * 100 : NaN;
    const spike =
      Number.isFinite(dvAvg[i]!) && dvAvg[i]! >= liq.minBaseDelivValCr * pc.daysPerPeriod
        ? g.delivValCr / dvAvg[i]!
        : NaN;
    const diff = g.delivPct - delivPctAvgN;
    const relTurnover = g.turnoverCr / tvMean[i]!;
    const tradeSizeRatio = g.avgTradeSize / tsMean[i]!;
    const z = zStd[i]! > 0 ? (g.delivPct - zMean[i]!) / zStd[i]! : NaN;
    const sign = Number.isNaN(diff) ? NaN : Math.sign(diff);
    if (Number.isNaN(sign)) run = 0;
    else if (sign === prevSign) run++;
    else run = 1;
    prevSign = sign;
    const lowLiq = Number.isFinite(perDay[i]!) && perDay[i]! < liq.minTurnoverAvg20Cr;
    const newListing = priorComplete < pc.minHistory;
    const sigOk = !lowLiq && !newListing && !etf;
    r.delivValAvgN = orNull(dvAvg[i]!);
    r.delivPctAvgN = orNull(delivPctAvgN);
    r.turnoverAvgCr = orNull(perDay[i]!);
    r.spike = orNull(spike);
    r.delivPctDiff = orNull(diff);
    r.relTurnover = orNull(relTurnover);
    r.tradeSizeRatio = orNull(tradeSizeRatio);
    r.delivPctZ = orNull(z);
    r.delivPctPctile = orNull(pct[i]!);
    r.streak = Number.isNaN(sign) ? null : Math.round(sign * run);
    r.signal =
      typeof tf === 'object' || !sigOk
        ? null
        : classify(pc, { ret: g.ret, spike, delivPctDiff: diff, clv: g.clv, relTurnover });
    r.flags =
      (r.flags & ~(FLAG_LOWLIQ | FLAG_NEWLISTING | FLAG_ETF)) |
      (lowLiq ? FLAG_LOWLIQ : 0) |
      (newListing ? FLAG_NEWLISTING : 0) |
      (etf ? FLAG_ETF : 0);
    if (comp[i]) priorComplete++;
  }
}

/** ONE stock's period rows (08 section 2) for weeks, months, quarters or N-trading-day bars; `tradingDays` is the market calendar. */
export function aggregatePeriods(
  rows: readonly AggInput[],
  tf: BarSpec,
  tradingDays: readonly string[],
  cfg: PeriodsConfig,
  opts: { etf?: boolean } = {},
): PeriodRow[] {
  const periods = periodsFor(tradingDays, tf);
  const aggs = groups(rows, periods);
  const out = aggs.map((g) => toRow(g, periods[g.pi]!));
  baselines(aggs, out, tf, cfg, opts.etf ?? false);
  return out;
}

/** ONE aggregate over the dates a..b (inclusive) of one stock's rows (custom single bar and footprint card). Null if the stock has no valid delivery day there. */
export function aggregateRange(rows: readonly AggInput[], a: string, b: string): PeriodRow | null {
  const dates = rows.map((r) => r.date).filter((d) => d >= a && d <= b);
  if (dates.length === 0) return null;
  const period: Period = {
    key: `${a}..${b}`,
    start: a,
    end: b,
    tradingDays: dates.length,
    daysIn: dates.length,
    daysExpected: dates.length,
    partial: false,
    dates,
  };
  const aggs = groups(rows, [period]);
  return aggs.length ? toRow(aggs[0]!, period) : null;
}

/** "in progress (3 of 5 days)" text for a partial period. */
export function partialText(p: { partial: boolean; daysIn: number; daysExpected: number }): string | null {
  return p.partial ? `in progress (${p.daysIn} of ${p.daysExpected} days)` : null;
}
