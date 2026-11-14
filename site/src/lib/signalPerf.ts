import type { Bucket, SignalCode, SignalPerfRow } from '../types/data';
import { fmtPctChg } from './format';

/** Historical follow-through lines (04 section 6), built from stats/signal_perf.json. */

export type Entry = 't1' | 't0';

export const GROUP_LABEL: Record<string, string> = {
  ALL: 'All stocks',
  L: 'Large caps',
  M: 'Mid caps',
  S: 'Small caps',
  U: 'Micro caps',
  'IDX:NIFTY200': 'Nifty 200',
};

export const ENTRY_LABEL: Record<Entry, string> = {
  t1: 'next-day close entry',
  t0: 'same-day close entry',
};

export const PERF_DISCLAIMER =
  'Historical, one sample period, current index/cap membership, before costs. Not a prediction.';

export const MIN_N = 30;

export type PerfIndex = Map<string, SignalPerfRow>;

const key = (event: string, group: string, entry: Entry, horizon: number) =>
  `${event}|${group}|${entry}|${horizon}`;

export function indexPerf(rows: readonly SignalPerfRow[]): PerfIndex {
  return new Map(rows.map((r) => [key(r.event, r.group, r.entry, r.horizon), r]));
}

export function perfCell(
  idx: PerfIndex,
  event: string,
  group: string,
  entry: Entry,
  horizon: number,
): SignalPerfRow | undefined {
  return idx.get(key(event, group, entry, horizon));
}

/** Cells with fewer than 30 observations are hidden (04 section 6). */
export function usable(
  r: SignalPerfRow | undefined,
  minN = MIN_N,
): r is SignalPerfRow & {
  medianExcess: number;
  hitRate: number;
} {
  return !!r && r.n >= minN && r.medianExcess !== null && r.hitRate !== null;
}

/** Group key of a cap bucket (ETFs have none: they never carry a signal). */
export const bucketGroup = (b: Bucket | null): string => b ?? 'ALL';

/**
 * "Historically (Large caps, 1 yr): 20-day median vs peers -1.0%, beat peers 44% of the time (n=414)."
 * Returns undefined when the cell is missing or has fewer than 30 observations.
 */
export function historyLine(
  idx: PerfIndex | null,
  event: string,
  group: string,
  entry: Entry = 't1',
): string | undefined {
  if (!idx) return undefined;
  const r = perfCell(idx, event, group, entry, 20);
  if (!usable(r)) return undefined;
  return `Historically (${GROUP_LABEL[group] ?? group}, 1 yr, ${ENTRY_LABEL[entry]}): 20-day median vs peers ${fmtPctChg(r.medianExcess, 1)}, beat peers ${Math.round(r.hitRate)}% of the time (n=${r.n.toLocaleString('en-IN')}).`;
}

/** Signal code history for a stock's cap bucket. */
export function signalHistory(
  idx: PerfIndex | null,
  signal: SignalCode | null,
  bucket: Bucket | null,
): string | undefined {
  return signal ? historyLine(idx, signal, bucketGroup(bucket)) : undefined;
}
