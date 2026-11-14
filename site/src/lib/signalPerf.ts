import type { Bucket, SignalCode, SignalPerfPeriodRow, SignalPerfRow } from '../types/data';
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

// ---- weekly and monthly signals (stats/signal_perf_periods.json, 08 section 5) --------------------------------------

/** Forward horizons in trading days and their labels, per timeframe (the file's timeframes block). */
export const PERIOD_HORIZONS: Record<'w' | 'm', { horizon: number; label: string }[]> = {
  w: [
    { horizon: 20, label: '4 weeks' },
    { horizon: 60, label: '12 weeks' },
  ],
  m: [
    { horizon: 63, label: '3 months' },
    { horizon: 126, label: '6 months' },
  ],
};

const TF_NOUN: Record<'w' | 'm', string> = { w: 'weekly', m: 'monthly' };

/** True when the cell has enough events to show (n at or above minN, with a median and a hit rate). */
export function periodCellUsable(r: SignalPerfPeriodRow | undefined, minN = MIN_N): r is SignalPerfPeriodRow {
  return !!r && r.n >= minN && r.medianExcess !== null && r.hitRate !== null;
}

/**
 * "Historically (Large caps, weekly signals): 4 weeks ahead, median vs peers +0.3%, beat peers 51% of the time (n=2,847);
 * 12 weeks ahead, too few events." Cells with n below minN are replaced by "too few events". Undefined while the file loads.
 */
export function periodHistoryLine(
  rows: readonly SignalPerfPeriodRow[] | null,
  tf: 'w' | 'm',
  event: string,
  group: string,
  minN = MIN_N,
): string | undefined {
  if (!rows) return undefined;
  const parts = PERIOD_HORIZONS[tf].map(({ horizon, label }) => {
    const r = rows.find(
      (x) => x.tf === tf && x.event === event && x.group === group && x.horizon === horizon,
    );
    return periodCellUsable(r, minN)
      ? `${label} ahead, median vs peers ${fmtPctChg(r.medianExcess, 1)}, beat peers ${Math.round(r.hitRate as number)}% of the time (n=${r.n.toLocaleString('en-IN')})`
      : `${label} ahead, too few events`;
  });
  return `Historically (${GROUP_LABEL[group] ?? group}, ${TF_NOUN[tf]} signals, next-day close entry after the period): ${parts.join('; ')}.`;
}

/** Period signal history for a stock's cap bucket. */
export function periodSignalHistory(
  rows: readonly SignalPerfPeriodRow[] | null,
  tf: 'w' | 'm',
  signal: SignalCode | null,
  bucket: Bucket | null,
): string | undefined {
  return signal ? periodHistoryLine(rows, tf, signal, bucketGroup(bucket)) : undefined;
}

// ---- the weekly / monthly signal-performance table (08 section 5) ----------------------------------------------------

export interface PeriodTableCell {
  group: string;
  /** False when the cell is missing or has fewer than minN events: the table shows "too few events". */
  shown: boolean;
  medianExcess: number | null;
  hitRate: number | null;
  n: number;
  periods: number;
}

export interface PeriodTableRow {
  event: string;
  cells: PeriodTableCell[];
}

/** Rows = events, columns = groups, for one timeframe and one forward horizon (in trading days). Cells with n < minN are hidden. */
export function buildPeriodTable(
  rows: readonly SignalPerfPeriodRow[],
  tf: 'w' | 'm',
  horizon: number,
  events: readonly string[],
  groups: readonly string[],
  minN = MIN_N,
): PeriodTableRow[] {
  const find = new Map(
    rows.filter((r) => r.tf === tf && r.horizon === horizon).map((r) => [`${r.event}|${r.group}`, r]),
  );
  return events.map((event) => ({
    event,
    cells: groups.map((group) => {
      const r = find.get(`${event}|${group}`);
      const shown = periodCellUsable(r, minN);
      return {
        group,
        shown,
        medianExcess: shown ? r!.medianExcess : null,
        hitRate: shown ? r!.hitRate : null,
        n: r?.n ?? 0,
        periods: r?.periods ?? 0,
      };
    }),
  }));
}

/** Note under the period table; monthly cells are thin because a month gives few events. */
export const PERIOD_THIN_NOTE = 'Monthly cells are often thin: fewer than 30 events are hidden.';
