import type { CumRow, SymbolRow } from '../types/data';

/** Range comparison maths (04 section 3), computed from four cum/ files. Pure; shared test vectors live in vectors.json. */

export interface RangeOptions {
  /** Trading days inside R and inside the baseline B (calendar of meta.tradingDays). */
  tradingDaysR: number;
  tradingDaysB: number;
  minBaseDelivValCr: number;
  minTurnoverAvg20Cr: number;
}

export interface RangeRow {
  sym: string;
  nR: number;
  nB: number;
  avgDelivValR: number | null;
  avgDelivValB: number | null;
  delivPctWR: number | null;
  delivPctWB: number | null;
  delivValChgPct: number | null;
  delivPctChgPp: number | null;
  turnoverChgPct: number | null;
  ret: number | null;
  /** Delivery value on up days / on down days (08 section 5A), range and baseline; null when there is no down day. */
  delivBalanceR: number | null;
  delivBalanceB: number | null;
  /** Average trade size in rupees (turnover / trades) and the range's size relative to the baseline's. */
  avgTradeSizeR: number | null;
  avgTradeSizeB: number | null;
  tradeSizeRatio: number | null;
  /** Last close in the range and average daily turnover (₹ Cr) of the range: used by the global filters. */
  lastClose: number | null;
  avgTurnoverR: number | null;
  coverage: number;
  listedDuringRange: boolean;
  excluded: boolean;
  excludedReasons: string[];
}

interface Span {
  n: number;
  dv: number;
  tv: number;
  up: number;
  dn: number;
  trades: number;
  lastClose: number | null;
  priorClose: number | null;
  listed: boolean;
}

function span(a0: CumRow | undefined, a1: CumRow | undefined): Span | null {
  if (!a1) return null;
  const listed = !a0;
  return {
    n: a1.cDays - (a0?.cDays ?? 0),
    dv: a1.cDelivValCr - (a0?.cDelivValCr ?? 0),
    tv: a1.cTurnoverCr - (a0?.cTurnoverCr ?? 0),
    up: (a1.cDelivValUpCr ?? 0) - (a0?.cDelivValUpCr ?? 0),
    dn: (a1.cDelivValDnCr ?? 0) - (a0?.cDelivValDnCr ?? 0),
    trades: (a1.cTrades ?? 0) - (a0?.cTrades ?? 0),
    lastClose: a1.lastClose,
    priorClose: a0?.lastClose ?? null,
    listed,
  };
}

function index(rows: readonly CumRow[] | null): Map<string, CumRow> {
  return new Map((rows ?? []).map((r) => [r.sym, r]));
}

/**
 * computeRange(cum[prev(a)], cum[b], cum[prev(a')], cum[b']). Pass null for cum[prev(a)] (or prev(a')) when the range
 * starts at the first stored date: the prior sum is then 0 and rows are flagged listedDuringRange.
 */
export function computeRange(
  cumA0: readonly CumRow[] | null,
  cumA1: readonly CumRow[],
  cumB0: readonly CumRow[] | null,
  cumB1: readonly CumRow[],
  opt: RangeOptions,
): RangeRow[] {
  const a0 = index(cumA0);
  const b0 = index(cumB0);
  const b1 = index(cumB1);
  const out: RangeRow[] = [];
  for (const r1 of cumA1) {
    const R = span(cumA0 ? a0.get(r1.sym) : undefined, r1);
    if (!R) continue;
    const B = span(cumB0 ? b0.get(r1.sym) : undefined, b1.get(r1.sym));
    const avgR = R.n > 0 ? R.dv / R.n : null;
    const avgB = B && B.n > 0 ? B.dv / B.n : null;
    const pctR = R.tv > 0 ? (R.dv / R.tv) * 100 : null;
    const pctB = B && B.tv > 0 ? (B.dv / B.tv) * 100 : null;
    const turnR = R.n > 0 ? R.tv / R.n : null;
    const turnB = B && B.n > 0 ? B.tv / B.n : null;
    const balR = R.dn > 0 ? R.up / R.dn : null;
    const balB = B && B.dn > 0 ? B.up / B.dn : null;
    const atsR = R.trades > 0 ? (R.tv * 1e7) / R.trades : null;
    const atsB = B && B.trades > 0 ? (B.tv * 1e7) / B.trades : null;
    const coverage = opt.tradingDaysR > 0 ? R.n / opt.tradingDaysR : 0;
    const reasons: string[] = [];
    if (coverage < 0.6) reasons.push('traded on fewer than 60% of the range days');
    if (!B || B.n < 0.6 * opt.tradingDaysB) reasons.push('traded on fewer than 60% of the baseline days');
    if (avgB === null || avgB < opt.minBaseDelivValCr) reasons.push('baseline delivery value too small');
    if (turnB === null || turnB < opt.minTurnoverAvg20Cr) reasons.push('baseline turnover too small');
    out.push({
      sym: r1.sym,
      nR: R.n,
      nB: B?.n ?? 0,
      avgDelivValR: avgR,
      avgDelivValB: avgB,
      delivPctWR: pctR,
      delivPctWB: pctB,
      delivValChgPct: avgR !== null && avgB !== null && avgB > 0 ? (avgR / avgB - 1) * 100 : null,
      delivPctChgPp: pctR !== null && pctB !== null ? pctR - pctB : null,
      turnoverChgPct: turnR !== null && turnB !== null && turnB > 0 ? (turnR / turnB - 1) * 100 : null,
      ret:
        R.lastClose !== null && R.priorClose !== null && R.priorClose > 0
          ? (R.lastClose / R.priorClose - 1) * 100
          : null,
      delivBalanceR: balR,
      delivBalanceB: balB,
      avgTradeSizeR: atsR,
      avgTradeSizeB: atsB,
      tradeSizeRatio: atsR !== null && atsB ? atsR / atsB : null,
      lastClose: R.lastClose,
      avgTurnoverR: turnR,
      coverage,
      listedDuringRange: R.listed,
      excluded: reasons.length > 0,
      excludedReasons: reasons,
    });
  }
  return out;
}

// ---- stock-level statistics (04 section 6) ----------------------------------------------------------------------

export interface StockStats {
  n: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  std: number | null;
  daysAbove60: number;
  avgTurnoverCr: number | null;
  avgDelivValCr: number | null;
  /** Share of window days (today included) with delivery % at or below today's. */
  todayPercentile: number | null;
  longestAboveAvgStreak: number;
  /** Correlation of delivery % with the next day's return; null with fewer than 10 pairs. */
  corrNextDayRet: number | null;
}

function mean(a: number[]): number | null {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 2) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Stats over the last `window` trading rows of a symbol file (valid delivery days only; BE/BZ rows have null). */
export function stockStats(rows: readonly SymbolRow[], window: number): StockStats {
  const win = rows.slice(-window);
  const valid = win.filter((r) => r.delivPct !== null);
  const dp = valid.map((r) => r.delivPct as number);
  const m = mean(dp);
  const std =
    m !== null && dp.length > 1
      ? Math.sqrt(dp.reduce((s, x) => s + (x - m) ** 2, 0) / (dp.length - 1))
      : null;
  const last = dp.length ? dp[dp.length - 1]! : null;
  let streak = 0;
  let best = 0;
  for (const r of win) {
    if (r.delivPct !== null && r.delivPctAvg20 !== null && r.delivPct > r.delivPctAvg20)
      best = Math.max(best, ++streak);
    else streak = 0;
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < win.length - 1; i++) {
    const a = win[i]!;
    const b = win[i + 1]!;
    if (a.delivPct !== null && a.close && b.close) {
      xs.push(a.delivPct);
      ys.push((b.close / a.close - 1) * 100);
    }
  }
  return {
    n: valid.length,
    mean: m,
    median: median(dp),
    min: dp.length ? Math.min(...dp) : null,
    max: dp.length ? Math.max(...dp) : null,
    std,
    daysAbove60: dp.filter((x) => x > 60).length,
    avgTurnoverCr: mean(valid.map((r) => r.turnoverCr).filter((x): x is number => x !== null)),
    avgDelivValCr: mean(valid.map((r) => r.delivValCr).filter((x): x is number => x !== null)),
    todayPercentile: last !== null ? (dp.filter((x) => x <= last).length / dp.length) * 100 : null,
    longestAboveAvgStreak: best,
    corrNextDayRet: xs.length >= 10 ? pearson(xs, ys) : null,
  };
}

/** Rolling mean and sample std of delivery % over the prior `window` valid days (for the +-1 sigma band). */
export function rollingBand(values: readonly (number | null)[], window: number, minPeriods: number) {
  const mean: (number | null)[] = [];
  const std: (number | null)[] = [];
  const buf: number[] = [];
  for (const v of values) {
    if (buf.length >= minPeriods) {
      const m = buf.reduce((s, x) => s + x, 0) / buf.length;
      const sd = buf.length > 1 ? Math.sqrt(buf.reduce((s, x) => s + (x - m) ** 2, 0) / (buf.length - 1)) : 0;
      mean.push(m);
      std.push(sd);
    } else {
      mean.push(null);
      std.push(null);
    }
    if (v !== null) {
      buf.push(v);
      if (buf.length > window) buf.shift();
    }
  }
  return { mean, std };
}
