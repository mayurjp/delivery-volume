import { FLAG, type Bucket, type DailyRow, type UniverseRow } from '../types/data';

/** Global filters (05 section 2). SME stocks never exist in the data, so there is no SME option. */
export interface Filters {
  /** 'ALL', an index key from meta.indices, or 'WATCHLIST'. */
  u: string;
  /** Selected cap buckets; empty = all. */
  b: Bucket[];
  /** Custom market cap bounds in Rs Cr (null = unbounded). */
  capMin: number | null;
  capMax: number | null;
  /** Selected sectors (may include 'Unclassified'); empty = all. */
  sec: string[];
  /** Minimum 20-day average turnover, Rs Cr. */
  minTurn: number;
  minPrice: number;
  hideEvents: boolean;
  /** Hide ETFs / index funds (default off: they show, badged "ETF"). */
  hideEtfs: boolean;
}

export const EVENT_FLAGS = FLAG.corpAction | FLAG.bulkDeal | FLAG.blockDeal | FLAG.bandHit;

export function defaultFilters(minTurnoverAvg20Cr: number): Filters {
  return {
    u: 'ALL',
    b: [],
    capMin: null,
    capMax: null,
    sec: [],
    minTurn: minTurnoverAvg20Cr,
    minPrice: 0,
    hideEvents: false,
    hideEtfs: false,
  };
}

/** Fields of a range row that the global filters read (the range view has no daily flags). */
export interface RangeFilterRow {
  sym: string;
  lastClose: number | null;
  avgTurnoverR: number | null;
}

export interface FilterContext {
  /** meta.indices, in bit order. */
  indices: readonly string[];
  watchlist: ReadonlySet<string>;
}

/** Number of filters that differ from their defaults (the badge on the filter button). */
export function activeFilterCount(f: Filters, def: Filters): number {
  let n = 0;
  if (f.u !== def.u) n++;
  if (f.b.length > 0) n++;
  if (f.capMin !== null || f.capMax !== null) n++;
  if (f.sec.length > 0) n++;
  if (f.minTurn !== def.minTurn) n++;
  if (f.minPrice !== def.minPrice) n++;
  if (f.hideEvents !== def.hideEvents) n++;
  if (f.hideEtfs !== def.hideEtfs) n++;
  return n;
}

/** Bit mask of a universe key, or null for 'ALL' / 'WATCHLIST' / unknown keys. */
export function universeBit(u: string, indices: readonly string[]): number | null {
  const i = indices.indexOf(u);
  return i >= 0 ? 2 ** i : null;
}

/**
 * Global filters for range rows. "Hide event-driven rows" needs daily flags and does not apply in range mode;
 * the minimum-turnover filter uses the range's average daily turnover.
 */
export function applyRangeFilters<R extends RangeFilterRow>(
  rows: readonly R[],
  universe: ReadonlyMap<string, UniverseRow>,
  f: Filters,
  ctx: FilterContext,
): R[] {
  const bit = universeBit(f.u, ctx.indices);
  const buckets = new Set<Bucket>(f.b);
  const sectors = new Set(f.sec);
  return rows.filter((r) => {
    const u = universe.get(r.sym);
    if (!u) return false;
    if (f.u === 'WATCHLIST') {
      if (!ctx.watchlist.has(r.sym)) return false;
    } else if (bit !== null && (u.idx & bit) === 0) return false;
    if (buckets.size > 0 && (u.bucket === null || !buckets.has(u.bucket))) return false;
    if (f.capMin !== null && (u.mcapCr === null || u.mcapCr < f.capMin)) return false;
    if (f.capMax !== null && (u.mcapCr === null || u.mcapCr > f.capMax)) return false;
    if (sectors.size > 0 && !sectors.has(u.sector)) return false;
    if (f.minTurn > 0 && r.avgTurnoverR !== null && r.avgTurnoverR < f.minTurn) return false;
    if (f.minPrice > 0 && (r.lastClose === null || r.lastClose < f.minPrice)) return false;
    if (f.hideEtfs && u.etf) return false;
    return true;
  });
}

/**
 * Pure filter over daily rows. `universe` maps symbol -> universe row (index membership, sector, cap bucket).
 * Rows whose symbol is missing from the universe are dropped. A null 20-day turnover (new listings) passes the
 * turnover floor; the newListing flag stays visible instead.
 */
export function applyFilters(
  rows: readonly DailyRow[],
  universe: ReadonlyMap<string, UniverseRow>,
  f: Filters,
  ctx: FilterContext,
): DailyRow[] {
  const bit = universeBit(f.u, ctx.indices);
  const buckets = new Set<Bucket>(f.b);
  const sectors = new Set(f.sec);
  const out: DailyRow[] = [];
  for (const r of rows) {
    const u = universe.get(r.sym);
    if (!u) continue;
    if (f.u === 'WATCHLIST') {
      if (!ctx.watchlist.has(r.sym)) continue;
    } else if (bit !== null && (u.idx & bit) === 0) continue;
    if (buckets.size > 0 && (u.bucket === null || !buckets.has(u.bucket))) continue;
    if (f.capMin !== null && (u.mcapCr === null || u.mcapCr < f.capMin)) continue;
    if (f.capMax !== null && (u.mcapCr === null || u.mcapCr > f.capMax)) continue;
    if (sectors.size > 0 && !sectors.has(u.sector)) continue;
    if (f.minTurn > 0 && r.turnoverAvg20Cr !== null && r.turnoverAvg20Cr < f.minTurn) continue;
    if (f.minPrice > 0 && (r.close === null || r.close < f.minPrice)) continue;
    if (f.hideEvents && (r.flags & EVENT_FLAGS) !== 0) continue;
    if (f.hideEtfs && (u.etf || (r.flags & FLAG.etf) !== 0)) continue;
    out.push(r);
  }
  return out;
}
