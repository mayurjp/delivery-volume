/**
 * Learn page case studies (07 sections 7 and 9): three runs picked from runs/library.json by rule, never by name. The
 * rule and the text come from the data, so nothing about a stock is written into the source.
 *
 *  1. the largest UP run and 2. the largest DOWN run, among the top TOP_N stocks by market cap, whose run ended in the
 *     last year of the store (end date on or after the day one year before the latest trading day);
 *  3. the largest UP run of the same set whose pre-run delivery value was at least HEAVY_PRE times normal (the spike
 *     rule of 07 section 2 uses the same 2x), excluding the runs already picked.
 *
 * "Largest" means the largest absolute move. Ties go to the later start, then the symbol, so the picks are stable.
 */

import type { RunLibRow } from '../types/data';
import { fmtDate, fmtPctChg } from './format';

export const TOP_N = 200;
export const HEAVY_PRE = 2;

export type CaseRole = 'largestUp' | 'largestDown' | 'heavyPreUp';

export interface CaseStudy {
  role: CaseRole;
  sym: string;
  dir: 'UP' | 'DOWN';
  start: string;
  end: string;
  movePct: number;
  days: number;
  preDelivValRatio: number | null;
  /** The sentence shown above the card, built from the run's own numbers. */
  text: string;
}

/** The ISO date one calendar year before `latest` (the start of "the last year of the store"). */
export function oneYearBefore(latest: string): string {
  const d = new Date(`${latest}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

const byMagnitude = (a: RunLibRow, b: RunLibRow): number => {
  const m = Math.abs(b.movePct) - Math.abs(a.movePct);
  if (m !== 0) return m;
  if (a.start !== b.start) return a.start < b.start ? 1 : -1;
  return a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0;
};

function sentence(role: CaseRole, r: RunLibRow): string {
  const move = fmtPctChg(r.movePct, 1);
  const span = `${fmtDate(r.start)} to ${fmtDate(r.end)}, ${r.days} trading days`;
  if (role === 'largestUp')
    return `The largest up run among the top ${TOP_N} by market cap in the last year: ${move}, ${span}.`;
  if (role === 'largestDown')
    return `The largest down run among the top ${TOP_N} by market cap in the last year: ${move}, ${span}.`;
  return `The largest up run after heavy pre-run delivery (at least ${HEAVY_PRE}x normal in the 20 days before the start): ${move}, ${span}.`;
}

/**
 * The three case studies. `rankBySym` maps a symbol to its market-cap rank (1 = largest; null when unranked). Returns
 * fewer than three picks when the rule finds no run (the page then says so).
 */
export function pickCaseStudies(
  rows: readonly RunLibRow[],
  rankBySym: ReadonlyMap<string, number | null | undefined>,
  latest: string,
  topN: number = TOP_N,
): CaseStudy[] {
  const cutoff = oneYearBefore(latest);
  const pool = rows.filter((r) => {
    const rank = rankBySym.get(r.sym);
    return rank !== null && rank !== undefined && rank <= topN && r.end >= cutoff;
  });
  const out: CaseStudy[] = [];
  const take = (role: CaseRole, r: RunLibRow | undefined) => {
    if (!r) return;
    out.push({
      role,
      sym: r.sym,
      dir: r.dir,
      start: r.start,
      end: r.end,
      movePct: r.movePct,
      days: r.days,
      preDelivValRatio: r.preDelivValRatio,
      text: sentence(role, r),
    });
  };
  const picked = (r: RunLibRow) => out.some((o) => o.sym === r.sym && o.start === r.start && o.dir === r.dir);

  take('largestUp', pool.filter((r) => r.dir === 'UP').sort(byMagnitude)[0]);
  take('largestDown', pool.filter((r) => r.dir === 'DOWN').sort(byMagnitude)[0]);
  take(
    'heavyPreUp',
    pool
      .filter(
        (r) => r.dir === 'UP' && r.preDelivValRatio !== null && r.preDelivValRatio >= HEAVY_PRE && !picked(r),
      )
      .sort(byMagnitude)[0],
  );
  return out;
}
