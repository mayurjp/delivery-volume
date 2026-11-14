/**
 * The run library page (07 section 7, "New page #/runs"): the URL query, the filter over runs/library.json rows, the
 * CSV rows, and the series the two charts read from stats/run_footprints.json. Pure functions; the page only renders.
 *
 * The statistics read here are the published cells, unchanged: the odds chart's values equal its lift cells.
 * Wording: descriptive (05 section 8). Never an instruction.
 */

import type { Bucket, RunFootprintsDoc, RunLibRow, UniverseRow } from '../types/data';
import type { CsvCell } from './csv';
import { universeBit } from './filters';
import { FEATURE_IDS, type FeatureId, type MediansDoc, type RunDir, type WindowId } from './runs';
import { parseFilters } from './urlState';

export type DirChoice = 'ALL' | RunDir;
export const DIR_CHOICES: readonly DirChoice[] = ['ALL', 'UP', 'DOWN'];
/** Minimum move choices (percent). The library holds runs of at least 20% (config/settings.json runs.minMovePct). */
export const MIN_MOVE_CHOICES = [20, 30, 40, 50] as const;
export const DEFAULT_MIN_MOVE = 20;
/** Runs shown before "Show all" (the CSV always holds every filtered row). */
export const LIB_PAGE = 200;

export interface LibQuery {
  dir: DirChoice;
  minMove: number;
  /** Universe key, 'ALL', or 'WATCHLIST' (as the global filters). */
  u: string;
  /** Cap buckets; empty = all. */
  b: Bucket[];
  /** Sectors; empty = all. */
  sec: string[];
  /** Run start dates, inclusive; null = open. */
  from: string | null;
  to: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parseLibQuery(
  p: URLSearchParams,
  minTurnoverAvg20Cr: number,
  indices: readonly string[],
): LibQuery {
  const g = parseFilters(p, minTurnoverAvg20Cr, indices);
  const dir = p.get('dir');
  const mm = Number(p.get('mm'));
  const from = p.get('from');
  const to = p.get('to');
  return {
    dir: dir === 'UP' || dir === 'DOWN' ? dir : 'ALL',
    minMove: (MIN_MOVE_CHOICES as readonly number[]).includes(mm) ? mm : DEFAULT_MIN_MOVE,
    u: g.u,
    b: g.b,
    sec: g.sec,
    from: from && ISO.test(from) ? from : null,
    to: to && ISO.test(to) ? to : null,
  };
}

/**
 * Writes the query into the URL (mutating `p`). Defaults are removed; the timeframe, the date and the other global
 * filter keys are left as they are.
 */
export function writeLibQuery(p: URLSearchParams, q: LibQuery): URLSearchParams {
  const set = (k: string, v: string | null) => (v === null || v === '' ? p.delete(k) : p.set(k, v));
  set('dir', q.dir === 'ALL' ? null : q.dir);
  set('mm', q.minMove === DEFAULT_MIN_MOVE ? null : String(q.minMove));
  set('from', q.from);
  set('to', q.to);
  set('u', q.u === 'ALL' ? null : q.u);
  set('b', q.b.length ? q.b.join(',') : null);
  set('sec', q.sec.length ? q.sec.join(',') : null);
  return p;
}

export interface LibContext {
  indices: readonly string[];
  universe: ReadonlyMap<string, UniverseRow>;
  watchlist: ReadonlySet<string>;
}

/** The runs that pass the query, newest start first (ties by symbol). */
export function filterLibrary(rows: readonly RunLibRow[], q: LibQuery, ctx: LibContext): RunLibRow[] {
  const bit = universeBit(q.u, ctx.indices);
  return rows
    .filter((r) => {
      if (q.dir !== 'ALL' && r.dir !== q.dir) return false;
      if (Math.abs(r.movePct) < q.minMove) return false;
      if (q.u === 'WATCHLIST') {
        if (!ctx.watchlist.has(r.sym)) return false;
      } else if (bit !== null) {
        const u = ctx.universe.get(r.sym);
        if (!u || (u.idx & bit) === 0) return false;
      }
      if (q.b.length && (!r.bucket || !q.b.includes(r.bucket))) return false;
      if (q.sec.length && !q.sec.includes(r.sector ?? 'Unclassified')) return false;
      if (q.from && r.start < q.from) return false;
      if (q.to && r.start > q.to) return false;
      return true;
    })
    .sort((a, b) => (a.start === b.start ? a.sym.localeCompare(b.sym) : a.start < b.start ? 1 : -1));
}

export const LIB_CSV_HEADERS = [
  'Symbol',
  'Direction',
  'Start',
  'End',
  'Move %',
  'Days',
  'Cap bucket',
  'Sector',
  'Pre delivery value vs normal',
  'Pre delivery % change pp',
  'Pre turnover vs normal',
  'Pre trade size vs normal',
  'Pre delivery balance',
  'Pre spike days',
  'Pre price change %',
  'Early delivery value vs normal',
  'Early delivery balance',
];

export function libCsvRows(rows: readonly RunLibRow[]): CsvCell[][] {
  return rows.map((r) => [
    r.sym,
    r.dir,
    r.start,
    r.end,
    r.movePct,
    r.days,
    r.bucket,
    r.sector,
    r.preDelivValRatio,
    r.preDelivPctChgPp,
    r.preTurnoverRatio,
    r.preTradeSizeRatio,
    r.preDelivBalance,
    r.preSpikeDays,
    r.prePriceChgPct,
    r.earlyDelivValRatio,
    r.earlyDelivBalance,
  ]);
}

// ---- stats/run_footprints.json: medians and lift cells -----------------------------------------------------------------

export const BUCKET_CHOICES = ['ALL', 'L', 'M', 'S', 'U'] as const;
export type BucketChoice = (typeof BUCKET_CHOICES)[number];
export const WINDOW_CHOICES: readonly WindowId[] = ['pre', 'early', 'full', 'post'];
export const BUCKET_LABEL: Record<BucketChoice, string> = {
  ALL: 'All stocks',
  L: 'Large cap',
  M: 'Mid cap',
  S: 'Small cap',
  U: 'Micro / unclassified',
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One median cell: [window, dir, bucket, feature, median, n]. */
export function medianCell(
  doc: MediansDoc | null,
  window: WindowId,
  dir: RunDir | 'ORDINARY',
  bucket: BucketChoice,
  feature: FeatureId,
): number | null {
  if (!doc) return null;
  const row = doc.medians.rows.find(
    (r) => r[0] === window && r[1] === dir && r[2] === bucket && r[3] === feature,
  );
  return row ? num(row[4]) : null;
}

export interface MediansSeries {
  features: readonly FeatureId[];
  up: (number | null)[];
  down: (number | null)[];
  /** Ordinary days: the statistics hold them for the pre window only (null elsewhere). */
  ordinary: (number | null)[];
}

export function mediansSeries(doc: MediansDoc | null, window: WindowId, bucket: BucketChoice): MediansSeries {
  return {
    features: FEATURE_IDS,
    up: FEATURE_IDS.map((f) => medianCell(doc, window, 'UP', bucket, f)),
    down: FEATURE_IDS.map((f) => medianCell(doc, window, 'DOWN', bucket, f)),
    ordinary: FEATURE_IDS.map((f) => medianCell(doc, window, 'ORDINARY', bucket, f)),
  };
}

export type OddsHorizon = 20 | 60;
export const ODDS_LABEL: Record<OddsHorizon, string> = {
  20: '20-day features, odds over the next 20 days',
  60: '60-day features, odds over the next 60 days',
};

export interface OddsCell {
  quintile: number;
  n: number;
  bigUpPct: number | null;
  bigDownPct: number | null;
}

export interface OddsSeries {
  feature: FeatureId;
  cells: OddsCell[];
  /** The base rate of every stock-day (the dashed lines). */
  base: { bigUpPct: number | null; bigDownPct: number | null; n: number | null } | null;
  /** 'needs more history' when the long-horizon table is not yet computed. */
  status: 'computed' | 'needs more history';
}

interface LiftBlock {
  rows: unknown[][];
  base: Record<string, unknown>;
}

/**
 * The lift cells of one feature at one horizon, as the statistics hold them (07 section 5, Part B). The 20-day table is
 * `lift`. The 60-day version is `longHorizon` at horizon 60; its base is keyed by horizon.
 */
export function oddsSeries(
  doc: RunFootprintsDoc | null,
  horizon: OddsHorizon,
  feature: FeatureId,
): OddsSeries {
  const empty: OddsSeries = { feature, cells: [], base: null, status: 'computed' };
  if (!doc) return empty;
  const block = (horizon === 20 ? doc.lift : doc.longHorizon) as LiftBlock | undefined;
  if (!block || !Array.isArray(block.rows)) return empty;
  const longStatus = (doc.longHorizon as { status?: string } | undefined)?.status;
  const baseRaw = horizon === 20 ? block.base : (block.base?.['60'] as Record<string, unknown> | undefined);
  const cells = block.rows
    .filter((r) => r[0] === horizon && r[1] === feature)
    .map((r) => ({ quintile: Number(r[2]), n: Number(r[3]), bigUpPct: num(r[4]), bigDownPct: num(r[5]) }))
    .sort((a, b) => a.quintile - b.quintile);
  return {
    feature,
    cells,
    base: baseRaw
      ? { bigUpPct: num(baseRaw.bigUpPct), bigDownPct: num(baseRaw.bigDownPct), n: num(baseRaw.n) }
      : null,
    status: horizon === 60 && longStatus !== 'computed' ? 'needs more history' : 'computed',
  };
}

/** The caveats the page shows (07 section 7; the study's caveats, docs/research/2026-11-run-footprints-study.md). */
export const LIB_CAVEATS: readonly string[] = [
  'Survivorship: the statistics use today’s top 750 stocks by market cap, so stocks that fell out of that list, or were delisted, are not counted.',
  'One sample period: the statistics cover one 3-year window of NSE data and say nothing about other market conditions.',
  'Before costs: no brokerage, taxes, impact cost or slippage are deducted from any figure.',
  'Correlated features: delivery value, turnover and trade size move together, so one feature can stand in for another.',
  'Footprints, not identities: NSE does not publish who took delivery of a stock, so these are footprints, not named buyers.',
  'Historical, not a prediction. Evidence, not advice.',
];
