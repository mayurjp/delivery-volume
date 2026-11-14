/**
 * Institutional series for P6 (docs/specs/04 section 5.1, 5.2): the FII/DII cash streaks and sums, the index-futures
 * long share and its own percentile band, and the share of index-futures volume. Pure functions over the published
 * tables; no value is interpolated across a missing day (03 section 5.7).
 */

import type { CashRow, ParticipantRow } from '../types/data';

/** FII index futures long share, in percent (long over long plus short). Null when the position is empty. */
export function participantLongPct(r: Pick<ParticipantRow, 'futIdxLong' | 'futIdxShort'>): number | null {
  const t = r.futIdxLong + r.futIdxShort;
  return t > 0 ? Math.round((r.futIdxLong / t) * 10000) / 100 : null;
}

/** The lo-th and hi-th percentiles of the non-null values (nearest-rank), and the median. Null with no values. */
export function percentileBand(
  values: readonly (number | null)[],
  lo: number,
  hi: number,
): { lo: number; hi: number; median: number } | null {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((q / 100) * xs.length) - 1))]!;
  return { lo: at(lo), hi: at(hi), median: at(50) };
}

/**
 * The current streak of one sign in a cash series: +n for n consecutive days of net buying, -n for net selling, 0 when
 * the latest recorded day is missing or zero. A missing day breaks the streak (it is never bridged).
 */
export function cashStreakOf(rows: readonly CashRow[], key: 'fiiNet' | 'diiNet'): number {
  let n = 0;
  let sign = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i]![key];
    if (v === null || v === 0) break;
    const s = v > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    if (s !== sign) break;
    n += s;
  }
  return n;
}

/** Sum of one cash column over the last `days` rows that have a value (days with no record are not counted). */
export function cashSum(
  rows: readonly CashRow[],
  key: 'fiiNet' | 'diiNet',
  days: number,
): { sum: number; n: number } {
  let sum = 0;
  let n = 0;
  for (const r of rows.slice(-days)) {
    const v = r[key];
    if (v !== null) {
      sum += v;
      n++;
    }
  }
  return { sum: Math.round(sum * 100) / 100, n };
}

/** Month-by-month totals of the cash series (bought, sold and net per investor group; days without a record count as 0 days). */
export function monthlyCash(rows: readonly CashRow[]): {
  month: string;
  fiiNet: number;
  diiNet: number;
  days: number;
}[] {
  const by = new Map<string, { fiiNet: number; diiNet: number; days: number }>();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    const g = by.get(m) ?? { fiiNet: 0, diiNet: 0, days: 0 };
    if (r.fiiNet !== null && r.diiNet !== null) {
      g.fiiNet += r.fiiNet;
      g.diiNet += r.diiNet;
      g.days++;
    }
    by.set(m, g);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, g]) => ({
      month,
      fiiNet: Math.round(g.fiiNet * 100) / 100,
      diiNet: Math.round(g.diiNet * 100) / 100,
      days: g.days,
    }));
}
