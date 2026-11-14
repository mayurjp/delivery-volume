import type { DataClient } from './dataClient';
import { fmtDate, fmtDateShort } from './format';
import { computeRange, type RangeRow } from './metrics';
import type { Bucket, CumRow, SignalCode, SplitBonusRow, UniverseRow } from '../types/data';

/** Range mode (05 section 3, 04 section 3): range and baseline resolution, loading, signals and the corporate-action marker. */

export type RangePreset = '1W' | '2W' | '1M' | '3M' | '6M' | '1Y' | 'MTD' | 'YTD' | 'C';
export type BaselineMode = 'p' | '20' | '50' | 'c';

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: '1W', label: '1W' },
  { id: '2W', label: '2W' },
  { id: '1M', label: '1M' },
  { id: '3M', label: '3M' },
  { id: '6M', label: '6M' },
  { id: '1Y', label: '1Y' },
  { id: 'MTD', label: 'MTD' },
  { id: 'YTD', label: 'YTD' },
  { id: 'C', label: 'Custom' },
];

export const BASELINES: { id: BaselineMode; label: string }[] = [
  { id: 'p', label: 'Previous equal period' },
  { id: '20', label: 'Prior 20 days' },
  { id: '50', label: 'Prior 50 days' },
  { id: 'c', label: 'Custom' },
];

const SIZE: Partial<Record<RangePreset, number>> = {
  '1W': 5,
  '2W': 10,
  '1M': 21,
  '3M': 63,
  '6M': 126,
  '1Y': 252,
};

export interface RangeSpec {
  preset: RangePreset;
  /** Custom range (preset 'C'); the end of every other preset is `end`. */
  a: string | null;
  b: string | null;
  baseline: BaselineMode;
  ba: string | null;
  bb: string | null;
}

export const DEFAULT_RANGE: RangeSpec = { preset: '1M', a: null, b: null, baseline: 'p', ba: null, bb: null };

export interface Span {
  a: string;
  b: string;
  /** Trading days in [a, b]. */
  days: number;
  /** The trading day before a (null when a is the first stored day). */
  prevA: string | null;
}

export interface ResolvedRange {
  range: Span;
  baseline: Span | null;
  /** The range, in words (05 section 3). */
  text: string;
}

/** First index whose date >= d, and last index whose date <= d, on a sorted date list. */
function lowerIdx(days: readonly string[], d: string): number {
  let i = 0;
  while (i < days.length && days[i]! < d) i++;
  return Math.min(i, days.length - 1);
}
function upperIdx(days: readonly string[], d: string): number {
  let i = days.length - 1;
  while (i > 0 && days[i]! > d) i--;
  return Math.max(i, 0);
}

function span(days: readonly string[], s: number, e: number): Span {
  return { a: days[s]!, b: days[e]!, days: e - s + 1, prevA: s > 0 ? days[s - 1]! : null };
}

function fmtSpan(s: Span, withYear: boolean): string {
  const end = withYear ? fmtDate(s.b) : fmtDateShort(s.b);
  return `${fmtDateShort(s.a)}–${end}`;
}

/** Resolves a RangeSpec ending at `end` into the range and its baseline, on the stored trading days. */
export function resolveRange(spec: RangeSpec, end: string, tradingDays: readonly string[]): ResolvedRange {
  let s: number;
  let e: number;
  if (spec.preset === 'C' && spec.a && spec.b) {
    s = lowerIdx(tradingDays, spec.a);
    e = upperIdx(tradingDays, spec.b);
    if (s > e) [s, e] = [e, s];
  } else {
    e = upperIdx(tradingDays, end);
    const n = SIZE[spec.preset] ?? (spec.preset === 'C' ? 21 : undefined);
    if (n) s = Math.max(0, e - n + 1);
    else {
      const prefix = end.slice(0, spec.preset === 'MTD' ? 7 : 4);
      s = tradingDays.findIndex((d) => d.startsWith(prefix));
      if (s < 0 || s > e) s = e;
    }
  }
  const range = span(tradingDays, s, e);
  const len = e - s + 1;
  let baseline: Span | null = null;
  if (spec.baseline === 'c' && spec.ba && spec.bb) {
    let bs = lowerIdx(tradingDays, spec.ba);
    let be = upperIdx(tradingDays, spec.bb);
    if (bs > be) [bs, be] = [be, bs];
    baseline = span(tradingDays, bs, be);
  } else if (spec.baseline !== 'c' && s > 0) {
    const be = s - 1;
    const want = spec.baseline === 'p' ? len : Number(spec.baseline);
    baseline = span(tradingDays, Math.max(0, be - want + 1), be);
  }
  const text = baseline
    ? `Range ${fmtSpan(range, true)} (${range.days} days) vs baseline ${fmtSpan(baseline, true)} (${baseline.days} days)`
    : `Range ${fmtSpan(range, true)} (${range.days} days); no earlier data for a baseline`;
  return { range, baseline, text };
}

export interface RangeCums {
  a0: CumRow[] | null;
  a1: CumRow[];
  b0: CumRow[] | null;
  b1: CumRow[];
}

/** Fetches at most four cum files: cum/prev(a), cum/b, cum/prev(a'), cum/b' (04 section 3). */
export async function fetchRangeCums(client: DataClient, r: ResolvedRange): Promise<RangeCums> {
  const base = r.baseline;
  const [a0, a1, b0, b1] = await Promise.all([
    r.range.prevA ? client.cum(r.range.prevA) : Promise.resolve(null),
    client.cum(r.range.b),
    base?.prevA ? client.cum(base.prevA) : Promise.resolve(null),
    base ? client.cum(base.b) : Promise.resolve([] as CumRow[]),
  ]);
  return { a0, a1, b0, b1 };
}

export interface RangeScreenRow extends RangeRow {
  name: string;
  sector: string;
  bucket: Bucket | null;
  mcapCr: number | null;
  etf: boolean;
  /** Range signal (04 section 4.2); null for ETFs and excluded rows. */
  signal: SignalCode | null;
  /** A split or bonus ex-date falls inside [prev(a), b]: the price return is not adjusted. */
  caWarn: boolean;
}

/** Range signal thresholds (config/signals.json -> range). */
export function rangeSignal(r: RangeRow, etf: boolean): SignalCode | null {
  if (etf || r.excluded || r.ret === null || r.delivValChgPct === null || r.delivPctChgPp === null)
    return null;
  const heavy = r.delivValChgPct >= 30 && r.delivPctChgPp >= 3;
  if (r.ret >= 3 && heavy) return 'ACC';
  if (r.ret <= -3 && heavy) return 'DIS';
  if (r.ret >= 5 && r.delivPctChgPp <= -5) return 'SPU';
  if (r.ret <= -5 && r.delivPctChgPp <= -5) return 'SPD';
  return null;
}

/** Symbols with a split or bonus ex-date in [from, to] (ISO strings compare correctly). */
export function corpActionSyms(rows: readonly SplitBonusRow[], from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (r.exDate >= from && r.exDate <= to) out.add(r.sym);
  return out;
}

export function buildRangeRows(
  cums: RangeCums,
  r: ResolvedRange,
  universe: ReadonlyMap<string, UniverseRow>,
  settings: { minBaseDelivValCr: number; minTurnoverAvg20Cr: number },
  splitBonus: readonly SplitBonusRow[],
): RangeScreenRow[] {
  const rows = computeRange(cums.a0, cums.a1, cums.b0, cums.b1, {
    tradingDaysR: r.range.days,
    tradingDaysB: r.baseline?.days ?? 0,
    ...settings,
  });
  const ca = corpActionSyms(splitBonus, r.range.prevA ?? r.range.a, r.range.b);
  const out: RangeScreenRow[] = [];
  for (const row of rows) {
    const u = universe.get(row.sym);
    if (!u) continue;
    out.push({
      ...row,
      name: u.name,
      sector: u.sector,
      bucket: u.bucket,
      mcapCr: u.mcapCr,
      etf: u.etf,
      signal: rangeSignal(row, u.etf),
      caWarn: ca.has(row.sym),
    });
  }
  return out;
}

// ---- URL state ------------------------------------------------------------------------------------------------------

export const RANGE_KEYS = ['r', 'ra', 'rb', 'bl', 'ba', 'bb'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: string | null) => (v && ISO.test(v) ? v : null);

export function parseRange(p: URLSearchParams): RangeSpec {
  const r = p.get('r');
  const bl = p.get('bl');
  return {
    preset: RANGE_PRESETS.some((x) => x.id === r) ? (r as RangePreset) : DEFAULT_RANGE.preset,
    a: iso(p.get('ra')),
    b: iso(p.get('rb')),
    baseline: BASELINES.some((x) => x.id === bl) ? (bl as BaselineMode) : DEFAULT_RANGE.baseline,
    ba: iso(p.get('ba')),
    bb: iso(p.get('bb')),
  };
}

export function writeRange(p: URLSearchParams, s: RangeSpec): URLSearchParams {
  for (const k of RANGE_KEYS) p.delete(k);
  if (s.preset !== DEFAULT_RANGE.preset) p.set('r', s.preset);
  if (s.preset === 'C') {
    if (s.a) p.set('ra', s.a);
    if (s.b) p.set('rb', s.b);
  }
  if (s.baseline !== DEFAULT_RANGE.baseline) p.set('bl', s.baseline);
  if (s.baseline === 'c') {
    if (s.ba) p.set('ba', s.ba);
    if (s.bb) p.set('bb', s.bb);
  }
  return p;
}
