/**
 * Run forensics on one stock (07 sections 2, 4 and 7): parsing of symbols/{f}.json `runs` and `runSummary`, the run's
 * window spans on the stock's rows, the footprint card lines (each value taken from its source field), the pattern card
 * rules and the empty-state rules. Pure functions; the Runs tab only renders them.
 *
 * Wording: descriptive, past tense (05 section 8). Never an instruction.
 */

import type { SymbolFile } from '../types/data';
import { DASH, fmtInt, fmtPctChg, fmtPp, fmtRatio, fmtSigned } from './format';
import type { CsvCell } from './csv';

export type RunDir = 'UP' | 'DOWN';
export type WindowId = 'pre' | 'early' | 'full' | 'post';

/** The seven window features of 07 section 2 that the runs carry, per window. */
export interface WinFeat {
  delivValRatio: number | null;
  delivPctChgPp: number | null;
  turnoverRatio: number | null;
  tradeSizeRatio: number | null;
  delivBalance: number | null;
  spikeDays: number | null;
  priceChgPct: number | null;
}

export interface Split3 {
  FII: number | null;
  DII: number | null;
  Other: number | null;
}

export interface RunRec {
  dir: RunDir;
  start: string;
  end: string;
  movePct: number;
  days: number;
  pre: WinFeat;
  early: WinFeat;
  full: WinFeat;
  post: WinFeat;
  /** Results dates inside the run's window (a count). */
  results: number | null;
  holdFiiPp: number | null;
  holdDiiPp: number | null;
  holdMfPp: number | null;
  holdPromoterPp: number | null;
  futOiChgPct: number | null;
  buildLB: number | null;
  buildSB: number | null;
  buildSC: number | null;
  buildLU: number | null;
  dealsPre: Split3;
  dealsFull: Split3;
}

export interface SummaryRow {
  group: 'UP' | 'DOWN' | 'ORDINARY';
  runs: number;
  enough: boolean;
  preDelivValRatio: number | null;
  preDelivPctChgPp: number | null;
  preTurnoverRatio: number | null;
  preTradeSizeRatio: number | null;
  preDelivBalance: number | null;
  preSpikeDays: number | null;
  prePriceChgPct: number | null;
}

export type Summary = Record<'UP' | 'DOWN' | 'ORDINARY', SummaryRow | null>;

/** Fewest runs in one direction before the pattern card gives numbers (07 section 4). */
export const MIN_RUNS_PATTERN = 3;
/** Fewest trading days before run detection can say anything (the pre window plus its 60-day base). */
export const MIN_HISTORY_DAYS = 80;

interface Block {
  columns: string[];
  rows: unknown[][];
}

/** Each row of a column-named block as an object (missing cells read as null). */
function named(block: Block | undefined): Record<string, unknown>[] {
  if (!block) return [];
  return block.rows.map((r) => Object.fromEntries(block.columns.map((c, i) => [c, r[i] ?? null])));
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function feat(o: Record<string, unknown>, w: string): WinFeat {
  return {
    delivValRatio: num(o[`${w}DelivValRatio`]),
    delivPctChgPp: num(o[`${w}DelivPctChgPp`]),
    turnoverRatio: num(o[`${w}TurnoverRatio`]),
    tradeSizeRatio: num(o[`${w}TradeSizeRatio`]),
    delivBalance: num(o[`${w}DelivBalance`]),
    spikeDays: num(o[`${w}SpikeDays`]),
    priceChgPct: num(o[`${w}PriceChgPct`]),
  };
}

function split(o: Record<string, unknown>, w: 'Pre' | 'Full'): Split3 {
  return { FII: num(o[`deals${w}FII`]), DII: num(o[`deals${w}DII`]), Other: num(o[`deals${w}Other`]) };
}

/** The runs of one stock, in date order, as stored in symbols/{f}.json (07 section 4). */
export function parseRuns(block: SymbolFile['runs'] | undefined): RunRec[] {
  return named(block).map((o) => ({
    dir: o.dir === 'DOWN' ? 'DOWN' : 'UP',
    start: String(o.start),
    end: String(o.end),
    movePct: num(o.movePct) ?? 0,
    days: num(o.days) ?? 0,
    pre: feat(o, 'pre'),
    early: feat(o, 'early'),
    full: feat(o, 'full'),
    post: feat(o, 'post'),
    results: num(o.results),
    holdFiiPp: num(o.holdFiiPp),
    holdDiiPp: num(o.holdDiiPp),
    holdMfPp: num(o.holdMfPp),
    holdPromoterPp: num(o.holdPromoterPp),
    futOiChgPct: num(o.futOiChgPct),
    buildLB: num(o.buildLB),
    buildSB: num(o.buildSB),
    buildSC: num(o.buildSC),
    buildLU: num(o.buildLU),
    dealsPre: split(o, 'Pre'),
    dealsFull: split(o, 'Full'),
  }));
}

/** This stock's ordinary days and its up-run and down-run pre windows (07 section 4). */
export function parseSummary(block: SymbolFile['runSummary'] | undefined): Summary {
  const out: Summary = { UP: null, DOWN: null, ORDINARY: null };
  for (const o of named(block)) {
    const g = o.group;
    if (g !== 'UP' && g !== 'DOWN' && g !== 'ORDINARY') continue;
    out[g] = {
      group: g,
      runs: num(o.runs) ?? 0,
      enough: o.enough === true,
      preDelivValRatio: num(o.preDelivValRatio),
      preDelivPctChgPp: num(o.preDelivPctChgPp),
      preTurnoverRatio: num(o.preTurnoverRatio),
      preTradeSizeRatio: num(o.preTradeSizeRatio),
      preDelivBalance: num(o.preDelivBalance),
      preSpikeDays: num(o.preSpikeDays),
      prePriceChgPct: num(o.prePriceChgPct),
    };
  }
  return out;
}

// ---- windows on the stock's rows ------------------------------------------------------------------------------------

/** Inclusive row-index span [a, b] on the stock's rows. */
export type Span = [number, number];

/**
 * The row-index spans of a run's windows (07 section 2; the pipeline's run_rows): pre [s-19, s], early [s+1, s+5],
 * full [s, e] and post [e+1, e+20], with s and e the start and end pivots. A window that the stored rows cut short is
 * null, as is a window with too few days (no partial windows). The pivots are matched on the stock's own rows.
 */
export function windowSpans(
  run: Pick<RunRec, 'start' | 'end'>,
  dates: readonly string[],
): Record<WindowId, Span | null> {
  const n = dates.length;
  let s = dates.indexOf(run.start);
  if (s < 0) s = dates.findIndex((d) => d >= run.start);
  let e = dates.indexOf(run.end);
  if (e < 0) e = dates.findLastIndex((d) => d <= run.end);
  if (s < 0 || e < 0 || e < s) return { pre: null, early: null, full: null, post: null };
  return {
    pre: s - 19 >= 0 ? [s - 19, s] : null,
    early: s + 5 <= n - 1 ? [s + 1, s + 5] : null,
    full: [s, e],
    post: e + 20 <= n - 1 ? [e + 1, e + 20] : null,
  };
}

/** Whether a row index lies in a span. */
export const inSpan = (span: Span | null, i: number): boolean =>
  span !== null && i >= span[0] && i <= span[1];

// ---- empty states and the pattern card -------------------------------------------------------------------------------

export type RunsState = 'short' | 'none' | 'ok';

/** Which empty state applies (07 section 7). History is checked first: runs cannot exist before the first 80 days. */
export function runsState(runCount: number, dayCount: number): RunsState {
  if (dayCount < MIN_HISTORY_DAYS) return 'short';
  if (runCount === 0) return 'none';
  return 'ok';
}

export const NO_RUNS_TEXT = 'No runs of 20% or more in the stored history.';
export const SHORT_HISTORY_TEXT = `Not enough history yet: run detection needs about ${MIN_HISTORY_DAYS} trading days.`;
export const NOT_ENOUGH_RUNS_TEXT = 'not enough runs yet';

/** Whether a direction's pattern gives numbers: at least MIN_RUNS_PATTERN runs in it, and the source says enough. */
export function patternEnough(row: SummaryRow | null): boolean {
  return row !== null && row.enough && row.runs >= MIN_RUNS_PATTERN;
}

// ---- footprint card -------------------------------------------------------------------------------------------------

export type FeatureId = keyof WinFeat;
export const FEATURE_LABEL: Record<FeatureId, string> = {
  delivValRatio: 'Delivery value vs normal (x)',
  delivPctChgPp: 'Delivery % change (pp)',
  turnoverRatio: 'Turnover vs normal (x)',
  tradeSizeRatio: 'Average trade size vs normal (x)',
  delivBalance: 'Delivery balance, up vs down days (x)',
  spikeDays: 'Spike days (count)',
  priceChgPct: 'Price change (%)',
};
export const FEATURE_IDS: readonly FeatureId[] = [
  'delivValRatio',
  'delivPctChgPp',
  'turnoverRatio',
  'tradeSizeRatio',
  'delivBalance',
  'spikeDays',
  'priceChgPct',
];

/** stats/run_footprints.json: the market-wide medians are read from `medians` (07 section 5). */
export interface MediansDoc {
  medians: { columns: string[]; rows: unknown[][] };
}

/** The market-wide median for (window, direction, bucket, feature); the ALL bucket when the stock's bucket has none. */
export function marketMedian(
  doc: MediansDoc | null,
  window: WindowId,
  dir: RunDir,
  bucket: string | null,
  feature: FeatureId,
): number | null {
  if (!doc) return null;
  const find = (b: string) =>
    doc.medians.rows.find((r) => r[0] === window && r[1] === dir && r[2] === b && r[3] === feature);
  const row = (bucket ? find(bucket) : undefined) ?? find('ALL');
  return row ? num(row[4]) : null;
}

export interface CardLine {
  feature: FeatureId;
  label: string;
  /** This run's value, from the run's own field. */
  run: number | null;
  /** This stock's ordinary days (runSummary). Stored for the pre window only. */
  ordinary: number | null;
  /** The market-wide median of runs in this direction, for the stock's bucket (or ALL). */
  market: number | null;
}

const ordinaryPre = (row: SummaryRow, f: FeatureId): number | null =>
  ({
    delivValRatio: row.preDelivValRatio,
    delivPctChgPp: row.preDelivPctChgPp,
    turnoverRatio: row.preTurnoverRatio,
    tradeSizeRatio: row.preTradeSizeRatio,
    delivBalance: row.preDelivBalance,
    spikeDays: row.preSpikeDays,
    priceChgPct: row.prePriceChgPct,
  })[f];

/** The footprint card's lines for one window of one run (07 section 7). */
export function footprintCardLines(
  run: RunRec,
  window: WindowId,
  summary: Summary,
  medians: MediansDoc | null,
  bucket: string | null,
): CardLine[] {
  const ord = summary.ORDINARY;
  return FEATURE_IDS.map((f) => ({
    feature: f,
    label: FEATURE_LABEL[f],
    run: run[window][f],
    ordinary: window === 'pre' && ord ? ordinaryPre(ord, f) : null,
    market: marketMedian(medians, window, run.dir, bucket, f),
  }));
}

export interface BigPlayerLines {
  deals: { pre: Split3; full: Split3 };
  holdings: { label: string; value: number | null }[];
  fo: { label: string; value: number | null }[];
  results: number | null;
}

/** The named-player fields of a run (07 section 2). Null where the source did not cover the window. */
export function bigPlayerLines(run: RunRec): BigPlayerLines {
  return {
    deals: { pre: run.dealsPre, full: run.dealsFull },
    holdings: [
      { label: 'FII holdings change (pp)', value: run.holdFiiPp },
      { label: 'DII holdings change (pp)', value: run.holdDiiPp },
      { label: 'MF holdings change (pp)', value: run.holdMfPp },
      { label: 'Promoter holdings change (pp)', value: run.holdPromoterPp },
    ],
    fo: [
      { label: 'Futures OI change (%)', value: run.futOiChgPct },
      { label: 'Long build-up days', value: run.buildLB },
      { label: 'Short build-up days', value: run.buildSB },
      { label: 'Short covering days', value: run.buildSC },
      { label: 'Long unwinding days', value: run.buildLU },
    ],
    results: run.results,
  };
}

// ---- display formats ------------------------------------------------------------------------------------------------

export function fmtFeature(f: FeatureId, v: number | null): string {
  if (v === null) return DASH;
  if (f === 'delivPctChgPp') return fmtPp(v);
  if (f === 'priceChgPct') return fmtPctChg(v, 1);
  if (f === 'spikeDays') return fmtInt(v);
  return fmtRatio(v, 2);
}

/** Rs Cr with a sign, or a dash when not covered. */
export const fmtCrSigned = (v: number | null): string => (v === null ? DASH : `${fmtSigned(v, 1)} Cr`);
/** Percentage points with a sign, or a dash when not covered. */
export const fmtPpSigned = (v: number | null): string => (v === null ? DASH : fmtPp(v));

// ---- CSV --------------------------------------------------------------------------------------------------------------

export const RUN_CSV_HEADERS = [
  'Direction',
  'Start',
  'End',
  'Move %',
  'Days',
  'Pre delivery value vs normal',
  'Pre delivery % change pp',
  'Pre delivery balance',
  'Pre trade size vs normal',
  'Early delivery value vs normal',
  'Full delivery value vs normal',
  'Results dates',
];

/** Rows of the runs table in CSV order (the table's columns, plus the early and full delivery values). */
export function runCsvRows(runs: readonly RunRec[]): CsvCell[][] {
  return runs.map((r) => [
    r.dir,
    r.start,
    r.end,
    r.movePct,
    r.days,
    r.pre.delivValRatio,
    r.pre.delivPctChgPp,
    r.pre.delivBalance,
    r.pre.tradeSizeRatio,
    r.early.delivValRatio,
    r.full.delivValRatio,
    r.results,
  ]);
}
