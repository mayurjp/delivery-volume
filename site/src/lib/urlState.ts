import type { Bucket } from '../types/data';
import { defaultFilters, type Filters } from './filters';

/**
 * Filter and date state <-> URL query params (05 section 1), e.g. ?u=NIFTY200&b=L,M&sec=Financial%20Services&d=2026-11-13.
 * Only values that differ from the defaults are written, so URLs stay short and stable.
 */

export const FILTER_KEYS = ['u', 'b', 'cmin', 'cmax', 'sec', 'mt', 'mp', 'he'] as const;
const BUCKETS: readonly string[] = ['L', 'M', 'S', 'U'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function num(v: string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function list(v: string | null): string[] {
  return v ? v.split(',').filter(Boolean) : [];
}

export function hasFilterParams(p: URLSearchParams): boolean {
  return FILTER_KEYS.some((k) => p.has(k));
}

export function parseFilters(
  p: URLSearchParams,
  minTurnoverAvg20Cr: number,
  indices: readonly string[],
): Filters {
  const d = defaultFilters(minTurnoverAvg20Cr);
  const u = p.get('u');
  return {
    u: u && (u === 'ALL' || u === 'WATCHLIST' || indices.includes(u)) ? u : d.u,
    b: list(p.get('b')).filter((x): x is Bucket => BUCKETS.includes(x)),
    capMin: num(p.get('cmin')),
    capMax: num(p.get('cmax')),
    sec: list(p.get('sec')),
    minTurn: num(p.get('mt')) ?? d.minTurn,
    minPrice: num(p.get('mp')) ?? d.minPrice,
    hideEvents: p.get('he') === '1',
  };
}

/** Writes `f` into `p` (mutating): defaults are removed, everything else set. */
export function writeFilters(p: URLSearchParams, f: Filters, minTurnoverAvg20Cr: number): URLSearchParams {
  const d = defaultFilters(minTurnoverAvg20Cr);
  for (const k of FILTER_KEYS) p.delete(k);
  if (f.u !== d.u) p.set('u', f.u);
  if (f.b.length) p.set('b', f.b.join(','));
  if (f.capMin !== null) p.set('cmin', String(f.capMin));
  if (f.capMax !== null) p.set('cmax', String(f.capMax));
  if (f.sec.length) p.set('sec', f.sec.join(','));
  if (f.minTurn !== d.minTurn) p.set('mt', String(f.minTurn));
  if (f.minPrice !== d.minPrice) p.set('mp', String(f.minPrice));
  if (f.hideEvents) p.set('he', '1');
  return p;
}

/** A valid trading date from `?d=`, else the latest. */
export function parseDate(p: URLSearchParams, tradingDays: readonly string[], latest: string): string {
  const d = p.get('d');
  return d && ISO.test(d) && tradingDays.includes(d) ? d : latest;
}

/** Query string carried between pages: the filter params and the date. */
export function carryParams(p: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const k of [...FILTER_KEYS, 'd']) {
    const v = p.get(k);
    if (v !== null) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
