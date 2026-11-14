import type { PeriodInfo, PeriodsDoc } from '../types/data';
import { fmtDate, MONTH_NAMES } from './format';
import type { RangeSpec } from './range';

/**
 * The global timeframe (08 sections 1 and 5A), kept in the URL:
 *   tf=d (default) | w | m | q | c&n=10 (N-trading-day bars, 2-120) | r&from=2026-06-01&to=2026-09-30&base=prev
 * The period shown is the one holding the global date `d` (the week or month picker simply sets `d` to the period's last day).
 */

export type TfKind = 'd' | 'w' | 'm' | 'q' | 'c' | 'r';
export type TfBase = 'prev' | '20' | '50' | 'c';

export interface TimeframeState {
  tf: TfKind;
  /** Bar size in trading days for tf=c (2-120). */
  n: number;
  /** Custom date range for tf=r. */
  from: string | null;
  to: string | null;
  base: TfBase;
  /** Custom baseline (base=c). */
  bfrom: string | null;
  bto: string | null;
}

export const TF_KEYS = ['tf', 'n', 'from', 'to', 'base', 'bfrom', 'bto'] as const;
export const DEFAULT_TF: TimeframeState = {
  tf: 'd',
  n: 10,
  from: null,
  to: null,
  base: 'prev',
  bfrom: null,
  bto: null,
};
export const N_MIN = 2;
export const N_MAX = 120;

export const TF_OPTIONS: { id: TfKind; label: string; title: string }[] = [
  { id: 'd', label: 'D', title: 'Daily' },
  { id: 'w', label: 'W', title: 'Weekly (ISO week, Monday to Sunday)' },
  { id: 'm', label: 'M', title: 'Monthly (calendar month)' },
  { id: 'q', label: 'Q', title: 'Quarterly (calendar quarter)' },
  { id: 'c', label: 'Custom', title: 'Custom N-day bars or a custom date range' },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TFS: readonly string[] = ['d', 'w', 'm', 'q', 'c', 'r'];

export function clampN(n: number): number {
  return Math.min(N_MAX, Math.max(N_MIN, Math.round(n)));
}

export function parseTimeframe(p: URLSearchParams): TimeframeState {
  const tf = p.get('tf');
  const n = Number(p.get('n'));
  const base = p.get('base');
  const iso = (k: string): string | null => {
    const v = p.get(k);
    return v && ISO.test(v) ? v : null;
  };
  return {
    tf: tf && TFS.includes(tf) ? (tf as TfKind) : 'd',
    n: Number.isFinite(n) && n > 0 ? clampN(n) : DEFAULT_TF.n,
    from: iso('from'),
    to: iso('to'),
    base: base === '20' || base === '50' || base === 'c' ? base : 'prev',
    bfrom: iso('bfrom'),
    bto: iso('bto'),
  };
}

/** Writes `s` into `p` (mutating): only what differs from the defaults and what the timeframe uses. */
export function writeTimeframe(p: URLSearchParams, s: TimeframeState): URLSearchParams {
  for (const k of TF_KEYS) p.delete(k);
  if (s.tf === 'd') return p;
  p.set('tf', s.tf);
  if (s.tf === 'c') p.set('n', String(clampN(s.n)));
  if (s.tf === 'r') {
    if (s.from) p.set('from', s.from);
    if (s.to) p.set('to', s.to);
    if (s.base !== 'prev') p.set('base', s.base);
    if (s.base === 'c') {
      if (s.bfrom) p.set('bfrom', s.bfrom);
      if (s.bto) p.set('bto', s.bto);
    }
  }
  return p;
}

/** Params carried between pages next to the filters: the timeframe keys. */
export function carryTimeframe(p: URLSearchParams, into: URLSearchParams): void {
  for (const k of TF_KEYS) {
    const v = p.get(k);
    if (v !== null) into.set(k, v);
  }
}

/** The period of `list` that holds `date` (the last one at or before it when the date falls in a gap), or the newest. */
export function periodFor(list: readonly PeriodInfo[], date: string): PeriodInfo | null {
  if (list.length === 0) return null;
  let found: PeriodInfo | null = null;
  for (const p of list) {
    if (p.start <= date) found = p;
    if (p.start <= date && date <= p.end) return p;
  }
  return found ?? list[0]!;
}

export function periodsOf(doc: PeriodsDoc, tf: 'w' | 'm' | 'q'): PeriodInfo[] {
  return tf === 'w' ? doc.weekly : tf === 'm' ? doc.monthly : doc.quarterly;
}

/** "w/e 13 Nov 2026", "Nov 2026", "Q4 2026" (+ "in progress (3 of 5 days)" is added by the caller with partialText). */
export function periodLabel(tf: 'w' | 'm' | 'q', p: Pick<PeriodInfo, 'key' | 'end'>): string {
  if (tf === 'w') return `w/e ${fmtDate(p.end)}`;
  if (tf === 'm') return `${MONTH_NAMES[Number(p.key.slice(5, 7)) - 1] ?? ''} ${p.key.slice(0, 4)}`;
  return `${p.key.slice(5)} ${p.key.slice(0, 4)}`;
}

/** Short word for the period type, singular. */
export const TF_WORD: Record<'w' | 'm' | 'q', string> = { w: 'week', m: 'month', q: 'quarter' };

/**
 * The range and baseline a timeframe stands for, as a RangeSpec for the existing range machinery (cum/ files):
 * q = the quarter holding `date` against the previous quarter; c = the last N trading days against the N before; r = as given.
 * Null for d, w and m (they read daily/ or the weekly/monthly snapshots) and for an unset custom range.
 */
export function tfToRangeSpec(
  s: TimeframeState,
  date: string,
  tradingDays: readonly string[],
  quarters: readonly PeriodInfo[],
): RangeSpec | null {
  if (s.tf === 'q') {
    const q = periodFor(quarters, date);
    if (!q) return null;
    const i = quarters.indexOf(q);
    const prev = i > 0 ? quarters[i - 1]! : null;
    return {
      preset: 'C',
      a: q.start,
      b: q.end,
      baseline: prev ? 'c' : 'p',
      ba: prev?.start ?? null,
      bb: prev?.end ?? null,
    };
  }
  if (s.tf === 'c') {
    const i = tradingDays.indexOf(date);
    const e = i < 0 ? tradingDays.length - 1 : i;
    const a = tradingDays[Math.max(0, e - s.n + 1)]!;
    return { preset: 'C', a, b: tradingDays[e]!, baseline: 'p', ba: null, bb: null };
  }
  if (s.tf === 'r' && s.from && s.to) {
    const lo = s.from <= s.to ? s.from : s.to;
    const hi = s.from <= s.to ? s.to : s.from;
    return {
      preset: 'C',
      a: lo,
      b: hi,
      baseline: s.base === 'prev' ? 'p' : s.base,
      ba: s.base === 'c' ? s.bfrom : null,
      bb: s.base === 'c' ? s.bto : null,
    };
  }
  return null;
}
