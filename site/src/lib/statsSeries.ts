import type { Market } from '../types/data';
import { aggregateGroupBars, marketSeries, type MarketSeries } from './marketBars';
import { periodLabel, type TfKind, type TimeframeState } from './timeframe';

/** Pure helpers for Market Statistics per timeframe (08 sections 5 and 5A). */

/** Trailing periods that make "normal" for a market point, and the fewest needed to show a difference. */
export const NORMAL_PERIODS: Record<TfKind, number> = { d: 20, w: 10, m: 6, q: 4, c: 10, r: 20 };

/** Word for one point of the series, singular. */
export const POINT_WORD: Record<TfKind, string> = {
  d: 'day',
  w: 'week',
  m: 'month',
  q: 'quarter',
  c: 'bar',
  r: 'day',
};

/** Axis label of every point: the date for daily points, the period label for w / m / q, the bar's last date for N-day bars. */
export function pointLabels(tf: TfKind, s: Pick<MarketSeries, 'keys' | 'ends'>): string[] {
  if (tf === 'w' || tf === 'm' || tf === 'q')
    return s.ends.map((e, i) => periodLabel(tf, { key: s.keys[i]!, end: e }));
  return [...s.ends];
}

/**
 * The index of the point that stands for `date`: the first point ending on or after it (the week, month, quarter or bar
 * holding the date), or the last point when the date is later than all of them. -1 for an empty series.
 */
export function pointIndexFor(ends: readonly string[], date: string): number {
  if (ends.length === 0) return -1;
  const i = ends.findIndex((e) => e >= date);
  return i < 0 ? ends.length - 1 : i;
}

/** Mean of the `n` points before index `i` (nulls skipped); null when fewer than half of them hold a value. */
export function priorMean(values: readonly (number | null)[], i: number, n: number): number | null {
  const win = values.slice(Math.max(0, i - n), Math.max(0, i)).filter((v): v is number => v !== null);
  return win.length >= Math.ceil(n / 2) ? win.reduce((s, x) => s + x, 0) / win.length : null;
}

export interface PartialSplit {
  /** The values with in-progress points removed (null there). */
  full: (number | null)[];
  /** Only the in-progress points plus their complete neighbours, so a dashed segment joins the line. */
  dashed: (number | null)[];
  hasPartial: boolean;
}

/** Separates the in-progress points of a line from the complete ones, for the dashed segment. */
export function splitPartial(values: readonly (number | null)[], partial: readonly boolean[]): PartialSplit {
  const full = values.map((v, i) => (partial[i] ? null : v));
  const dashed = values.map((v, i) => (partial[i] || partial[i - 1] || partial[i + 1] ? v : null));
  return { full, dashed, hasPartial: partial.some(Boolean) };
}

export interface SectorTotal {
  name: string;
  delivVal: number;
}

/** Delivery value per sector, summed over the rows, largest first (rows without a value or sector are skipped). */
export function sectorTotals(rows: readonly { sector: string; delivVal: number | null }[]): SectorTotal[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.delivVal === null || !Number.isFinite(r.delivVal) || !r.sector) continue;
    by.set(r.sector, (by.get(r.sector) ?? 0) + r.delivVal);
  }
  return [...by].map(([name, delivVal]) => ({ name, delivVal })).sort((a, b) => b.delivVal - a.delivVal);
}

/** Text under the median column and trend: what a bar's median stock delivery % is (08 section 5A). */
export const MEDIAN_NOTE =
  'The median stock delivery % of a bar covering several days is the mean of its daily medians (a median cannot be summed up).';

/**
 * The one market point a table reads for the selected timeframe: the series of `group` and the index of the point holding
 * `date`. A custom range collapses into one bar over the whole range (sums, delivery % from the sums).
 */
export function selectedPoint(
  market: Market,
  group: string,
  tf: TimeframeState,
  date: string,
): { series: MarketSeries; i: number } | null {
  const s = marketSeries(market, group, tf);
  if (!s || s.ends.length === 0) return null;
  if (tf.tf === 'r') {
    const g = market.groups[group];
    return g ? { series: aggregateGroupBars(s.ends, s.group, s.indexClose, s.ends.length), i: 0 } : null;
  }
  return { series: s, i: pointIndexFor(s.ends, date) };
}
