import type { Market } from '../types/data';
import { marketSeries } from './marketBars';
import { periodLabel, type TfKind, type TimeframeState } from './timeframe';

/** Pure helpers for heat maps, quadrant scatter and statistics (05 sections P3, P4, P8). */

export type ColorMetric = 'spike' | 'diff' | 'ret';
export type SizeMetric = 'turnover' | 'mcap' | 'delivVal';

export const COLOR_METRICS: { id: ColorMetric; label: string; legend: string; ticks: string[] }[] = [
  {
    id: 'spike',
    label: 'Delivery spike',
    legend: 'Delivery value vs its average (log scale)',
    ticks: ['0.25×', '0.5×', '1×', '2×', '4×'],
  },
  {
    id: 'diff',
    label: 'Delivery % vs average',
    legend: 'Delivery % minus its average, pp',
    ticks: ['−25', '−12.5', '0', '+12.5', '+25'],
  },
  {
    id: 'ret',
    label: 'Price change',
    legend: 'Price change, %',
    ticks: ['−5%', '−2.5%', '0', '+2.5%', '+5%'],
  },
];

export const SIZE_METRICS: { id: SizeMetric; label: string }[] = [
  { id: 'turnover', label: 'Turnover' },
  { id: 'mcap', label: 'Market cap' },
  { id: 'delivVal', label: 'Delivery value' },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Position on the diverging scale in [-1, 1] (null when the value is missing).
 * spike: log2, diverging at 1x, clamped to [0.25x, 4x]; diff: +-25 pp; ret: +-5 %.
 */
export function colorT(metric: ColorMetric, v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  if (metric === 'spike') return v <= 0 ? -1 : Math.log2(clamp(v, 0.25, 4)) / 2;
  if (metric === 'diff') return clamp(v / 25, -1, 1);
  return clamp(v / 5, -1, 1);
}

export interface HeatItem {
  sym: string;
  name: string;
  sector: string;
  /** Tile area (> 0). */
  size: number;
  /** Colour value in the unit of the chosen metric. */
  value: number | null;
  /** Tooltip fields. */
  dp: number | null;
  dpAvg: number | null;
  spike: number | null;
  ret: number | null;
}

export interface TreeNode {
  name: string;
  value: number;
  sym?: string;
  /** Position on the diverging scale. */
  t: number | null;
  children?: TreeNode[];
  item?: HeatItem;
}

/** Sector -> stock tree. Sector tiles take the size-weighted mean colour of their stocks. */
export function buildTree(items: readonly HeatItem[], metric: ColorMetric): TreeNode[] {
  const by = new Map<string, TreeNode>();
  for (const it of items) {
    if (!(it.size > 0)) continue;
    let sec = by.get(it.sector);
    if (!sec) {
      sec = { name: it.sector, value: 0, t: null, children: [] };
      by.set(it.sector, sec);
    }
    sec.children!.push({ name: it.sym, sym: it.sym, value: it.size, t: colorT(metric, it.value), item: it });
    sec.value += it.size;
  }
  const out = [...by.values()];
  for (const sec of out) {
    let w = 0;
    let s = 0;
    for (const c of sec.children!) {
      if (c.t !== null) {
        w += c.value;
        s += c.value * c.t;
      }
    }
    sec.t = w > 0 ? s / w : null;
    sec.children!.sort((a, b) => b.value - a.value);
  }
  return out.sort((a, b) => b.value - a.value);
}

/** Percentile (0-100) of a sorted-or-not array by linear interpolation. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const k = ((s.length - 1) * p) / 100;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return s[lo]! + (s[hi]! - s[lo]!) * (k - lo);
}

export interface Clamped {
  value: number;
  /** True when the real value lies outside the axis and was pinned to its edge. */
  pinned: boolean;
}

/** Axis range at the 2nd and 98th percentiles (04 section 4.3), widened to include 0 and padded by 5%. */
export function axisRange(values: readonly number[]): [number, number] {
  const lo = percentile(values, 2) ?? -1;
  const hi = percentile(values, 98) ?? 1;
  const a = Math.min(lo, 0);
  const b = Math.max(hi, 0);
  const pad = (b - a) * 0.05 || 1;
  return [a - pad, b + pad];
}

export function pin(v: number, [lo, hi]: [number, number]): Clamped {
  return v < lo
    ? { value: lo, pinned: true }
    : v > hi
      ? { value: hi, pinned: true }
      : { value: v, pinned: false };
}

export function quadrantLabel(x: number, y: number): string {
  return `Price ${x >= 0 ? '↑' : '↓'} on ${y >= 0 ? 'rising' : 'falling'} delivery`;
}

export interface Bin {
  lo: number;
  hi: number;
  count: number;
}

/** Histogram with fixed-width bins (default 5 pp over 0-100). */
export function histogram(values: readonly number[], width = 5, max = 100): Bin[] {
  const bins: Bin[] = [];
  for (let lo = 0; lo < max; lo += width) bins.push({ lo, hi: lo + width, count: 0 });
  for (const v of values) {
    if (!Number.isFinite(v) || v < 0) continue;
    const i = Math.min(bins.length - 1, Math.floor(v / width));
    bins[i]!.count++;
  }
  return bins;
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 50);
}

/** Simple moving average over the previous `window` non-null values including the current one. */
export function movingAvg(values: readonly (number | null)[], window = 20): (number | null)[] {
  const out: (number | null)[] = [];
  const buf: number[] = [];
  for (const v of values) {
    if (v !== null) {
      buf.push(v);
      if (buf.length > window) buf.shift();
    }
    out.push(buf.length >= Math.ceil(window / 2) ? buf.reduce((s, x) => s + x, 0) / buf.length : null);
  }
  return out;
}

/** Group x day grid values: group's value minus its own mean over the last `base` days (pp). */
export function gridDeviation(
  series: readonly (number | null)[],
  from: number,
  base = 60,
): (number | null)[] {
  const lo = Math.max(0, series.length - base);
  const win = series.slice(lo).filter((v): v is number => v !== null);
  const m = win.length ? win.reduce((s, x) => s + x, 0) / win.length : null;
  return series.slice(from).map((v) => (v === null || m === null ? null : v - m));
}

// ---- group x period grid (08 section 5) ------------------------------------------------------------------------------

/** How many columns the group grid shows: 20 weeks, 12 months, 8 quarters, 20 N-day bars; 20 or 60 days for d and r. */
export function gridColumnCount(tf: TfKind, win: 20 | 60 = 20): number {
  switch (tf) {
    case 'w':
      return 20;
    case 'm':
      return 12;
    case 'q':
      return 8;
    case 'c':
      return 20;
    default:
      return win;
  }
}

/** Number of trailing periods whose mean is the colour reference of a group (its own normal). */
export function gridBase(tf: TfKind): number {
  switch (tf) {
    case 'w':
      return 40;
    case 'm':
      return 24;
    case 'q':
      return 12;
    case 'c':
      return 40;
    default:
      return 60;
  }
}

/** Word for the column unit, plural. */
export const GRID_UNIT: Record<TfKind, string> = {
  d: 'days',
  w: 'weeks',
  m: 'months',
  q: 'quarters',
  c: 'bars',
  r: 'days',
};

/** Axis label of one column; a period still in progress carries a star. */
export function gridColumnLabel(tf: TfKind, key: string, end: string, partial: boolean): string {
  const base = tf === 'w' || tf === 'm' || tf === 'q' ? periodLabel(tf, { key, end }) : end;
  return partial ? `${base}*` : base;
}

export interface GroupGrid {
  rows: string[];
  dates: string[];
  /** Column labels for periods (absent for daily columns, which use the date). */
  labels?: string[];
  cells: [number, number, number | null][];
  /** True when the last column is a period still in progress. */
  lastPartial: boolean;
}

/**
 * The group x period grid: groups whose key starts with `prefix`, the last gridColumnCount columns of
 * marketSeries(market, group, tf), coloured by delivPctW minus the group's own mean over the trailing gridBase periods (pp).
 */
export function buildGroupGrid(
  market: Market,
  prefix: string,
  tf: TimeframeState,
  win: 20 | 60 = 20,
): GroupGrid {
  const keys = Object.keys(market.groups).filter((k) => k.startsWith(prefix));
  const count = gridColumnCount(tf.tf, win);
  const base = gridBase(tf.tf);
  const rows: string[] = [];
  let dates: string[] = [];
  let labels: string[] | undefined;
  let lastPartial = false;
  const cells: GroupGrid['cells'] = [];
  for (const k of keys) {
    const s = marketSeries(market, k, tf);
    if (!s) continue;
    const from = Math.max(0, s.ends.length - count);
    if (rows.length === 0) {
      dates = s.ends.slice(from);
      if (tf.tf !== 'd' && tf.tf !== 'r') {
        labels = dates.map((e, i) =>
          gridColumnLabel(tf.tf, s.keys[from + i]!, e, s.partial[from + i] ?? false),
        );
      }
      lastPartial = s.partial[s.partial.length - 1] ?? false;
    }
    const yi = rows.length;
    rows.push(k.slice(prefix.length));
    gridDeviation(s.group.delivPctW, from, base).forEach((v, xi) => cells.push([xi, yi, v]));
  }
  return { rows, dates, labels, cells, lastPartial };
}
