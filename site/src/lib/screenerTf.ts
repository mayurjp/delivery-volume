import type { DailyRow, Meta, SignalCode } from '../types/data';
import { COLUMNS, PERIOD_ONLY_COLUMNS, type ColumnSpec } from './columns';
import { fmtDate } from './format';
import { PERIOD_MISSING } from './periodAdapter';
import { dailyWatchParams } from './presets';
import { DEFAULT_TF, writeTimeframe, type TfKind } from './timeframe';

/** Pure helpers of the Screener timeframe views (08 sections 5 and 5A, 07 section 8). */

export type ScreenerView = 'day' | 'period' | 'range' | 'rangeTf';

/**
 * Which table the Screener shows. tf=d is the day snapshot (or the legacy Range mode with rng=1), tf=w / m read a period
 * snapshot, tf=q / c / r compute a range from cum/ files. The watchlist always stays a daily view.
 */
export function screenerView(tf: TfKind, rng: boolean, watchlist: boolean): ScreenerView {
  if (watchlist) return 'day';
  if (tf === 'w' || tf === 'm') return 'period';
  if (tf === 'q' || tf === 'c' || tf === 'r') return 'rangeTf';
  return rng ? 'range' : 'day';
}

// ---- slim days (07 section 8) ---------------------------------------------------------------------------------------

/** Columns that come from the universe or are derived from slim columns, never from the daily file itself. */
// columns not in the daily file: joined from universe.json, holdings/latest.json or fo/{date}.json (Phase 5)
const NOT_FROM_FILE = new Set([
  'name',
  'sector',
  'mcapCr',
  'bucket',
  'chg',
  'futOi',
  'futOiChgPct',
  'buildup',
  'pcr',
]);

type Publish = Meta['publish'];

/** A day before dailyFullFrom carries only the slim column set. */
export function isSlimDay(date: string, publish: Pick<Publish, 'dailyFullFrom'>): boolean {
  return date < publish.dailyFullFrom;
}

/** Screener column keys that a slim day does not carry. */
export function slimMissingKeys(publish: Pick<Publish, 'dailySlimColumns'>): Set<string> {
  const slim = new Set(publish.dailySlimColumns);
  return new Set(COLUMNS.map((c) => c.key as string).filter((k) => !NOT_FROM_FILE.has(k) && !slim.has(k)));
}

export const slimReason = (from: string): string =>
  `Not published for days before ${fmtDate(from)}: only the slim column set is kept for older days`;

export const PERIOD_MISSING_REASON =
  'Not available in weekly and monthly snapshots: only the slim column set is kept for periods';

/** A copy of a column that shows a dash with a reason (header tip and cell tooltip). */
export function unavailable<R>(spec: ColumnSpec<R>, reason: string): ColumnSpec<R> {
  return { ...spec, tip: `${spec.tip}. ${reason}.`, fmt: () => '—', tone: undefined, cellTip: () => reason };
}

/** Day columns, with those a slim day lacks turned into dashes. */
export function dayColumnList(missing: ReadonlySet<string>, reason: string): ColumnSpec[] {
  return COLUMNS.map((c) => (missing.has(c.key as string) ? unavailable(c, reason) : c));
}

// ---- presets ---------------------------------------------------------------------------------------------------------

/** Daily-row fields each preset reads (presets.ts). */
export const PRESET_NEEDS: Record<string, (keyof DailyRow)[]> = {
  spikes: ['spike', 'delivValCr'],
  drops: ['spike', 'delivValAvg20'],
  highpct: ['delivPct', 'turnoverCr'],
  jump: ['delivPctDiff'],
  fall: ['delivPctDiff'],
  value: ['delivValCr'],
  streak: ['streak'],
  unusual: ['delivPctZ60'],
  acc: ['signal'],
  dis: ['signal'],
  high52low: ['flags', 'spike'],
  high52heavy: ['flags', 'spike'],
  largedis: ['signal'],
  accLB: ['signal', 'buildup'],
  buLB: ['buildup', 'futOiChgPct'],
  buSB: ['buildup', 'futOiChgPct'],
  buSC: ['buildup', 'futOiChgPct'],
  buLU: ['buildup', 'futOiChgPct'],
};

/** Column keys a preset needs but the data does not carry. */
export function presetBlockedBy(id: string, missing: ReadonlySet<string>): string[] {
  return (PRESET_NEEDS[id] ?? []).filter((k) => missing.has(k));
}

/** The visible reason a preset is disabled, or null when it can run. */
export function presetReason(
  id: string,
  missing: ReadonlySet<string>,
  labelOf: (key: string) => string,
  why: string,
): string | null {
  const keys = presetBlockedBy(id, missing);
  return keys.length ? `Needs ${keys.map(labelOf).join(', ')}. ${why}` : null;
}

/** Presets whose "Historically" line reads period signal events (only the five signal codes exist as period events). */
export const PERIOD_PRESET_EVENT: Record<string, { event: SignalCode; group?: string }> = {
  acc: { event: 'ACC' },
  dis: { event: 'DIS' },
  largedis: { event: 'DIS', group: 'L' },
};

// ---- weekly and monthly columns -------------------------------------------------------------------------------------

const UNIT: Record<'w' | 'm', { short: string; word: string; plural: string }> = {
  w: { short: 'W', word: 'week', plural: 'weeks' },
  m: { short: 'M', word: 'month', plural: 'months' },
};

export interface PeriodWindows {
  base: number;
  long: number;
}

/** Column label and tip overrides: the daily wording mentions 20 and 60 days, a period view has its own baselines. */
function periodized(spec: ColumnSpec, tf: 'w' | 'm', w: PeriodWindows): ColumnSpec {
  const u = UNIT[tf];
  const b = `${w.base}${u.short}`;
  const prior = `the prior ${w.base} ${u.plural}`;
  const over = (label: string, tip: string): ColumnSpec => ({ ...spec, label, tip });
  switch (spec.key) {
    case 'prevClose':
      return over('Prev close', `Close of the last trading day before the ${u.word}, ₹`);
    case 'close':
      return over('Close', `Close of the last trading day of the ${u.word}, ₹`);
    case 'chg':
      return over('Change (₹)', `Close minus the close before the ${u.word}, ₹ (split-adjusted if marked)`);
    case 'ret1':
      return over('Return', `Close vs the close before the ${u.word}, %`);
    case 'open':
      return over('Open', `Open of the first trading day of the ${u.word}, ₹`);
    case 'high':
      return over('High', `Highest price in the ${u.word}, ₹`);
    case 'low':
      return over('Low', `Lowest price in the ${u.word}, ₹`);
    case 'vol':
      return over('Volume', `Traded quantity summed over the ${u.word} (shares)`);
    case 'turnoverCr':
      return over('Turnover', `Traded value summed over the ${u.word}, ₹ Cr`);
    case 'delivPct':
      return over('Deliv %', `Delivered value / traded value over the ${u.word} (value-weighted)`);
    case 'delivValCr':
      return over('Deliv value', `Delivery value summed over the ${u.word}, ₹ Cr`);
    case 'delivValAvg20':
      return over(`Dv avg ${b}`, `Delivery value of ${prior}, average per ${u.word}, ₹ Cr`);
    case 'delivPctAvg20':
      return over(`Deliv % ${b}`, `Value-weighted delivery % over ${prior}`);
    case 'turnoverAvg20Cr':
      return over(
        `Turn avg ${b}`,
        `Turnover of ${prior}, average per ${u.word}, ₹ Cr (the minimum-turnover filter reads this)`,
      );
    case 'tradeSizeRatio':
      return over('Trade size', `Average trade size vs ${prior}`);
    case 'spike':
      return over('Spike', `Delivery value / its average over ${prior}`);
    case 'delivPctDiff':
      return over(
        'Deliv % diff',
        `Delivery % minus its value-weighted level over ${prior}, in percentage points`,
      );
    case 'relVol':
      return over('Rel turnover', `Turnover / its average over ${prior}`);
    case 'clv':
      return over('CLV', `Close location in the ${u.word}'s range: +1 closed at the high, -1 at the low`);
    case 'delivPctZ60':
      return over(`Z ${w.long}${u.short}`, `Delivery % z-score vs the prior ${w.long} ${u.plural}`);
    case 'delivPctPctile':
      return over(
        'Pctile',
        `Percentile of this ${u.word}'s delivery % among the prior ${w.long} ${u.plural}`,
      );
    case 'streak':
      return over(
        'Streak',
        `Consecutive ${u.plural} above (+) or below (-) the ${w.base}-${u.word} baseline delivery %`,
      );
    case 'signal':
      return { ...spec, tip: `Describes what happened over the ${u.word}; it does not predict anything.` };
    default:
      return spec;
  }
}

/** The weekly or monthly column list: daily columns with period wording, the period-only columns after Trades. */
export function periodColumnList(tf: 'w' | 'm', w: PeriodWindows): ColumnSpec[] {
  const missing = new Set<string>(PERIOD_MISSING as readonly string[]);
  const out: ColumnSpec[] = [];
  for (const c of COLUMNS) {
    out.push(missing.has(c.key as string) ? unavailable(c, PERIOD_MISSING_REASON) : periodized(c, tf, w));
    if (c.key === 'trades') out.push(...PERIOD_ONLY_COLUMNS);
  }
  return out;
}

export const PERIOD_DEFAULT_COLUMNS: string[] = [
  'sym',
  'prevClose',
  'close',
  'ret1',
  'adjusted',
  'days',
  'turnoverCr',
  'delivPct',
  'delivPctAvg20',
  'delivPctDiff',
  'delivValCr',
  'spike',
  'delivBalance',
  'avgTradeSize',
  'signal',
  'flags',
];

export const registryOf = <R>(list: readonly ColumnSpec<R>[]): Map<string, ColumnSpec<R>> =>
  new Map(list.map((c) => [c.key as string, c]));

/** Column label by key, for preset reasons. */
export const labelIn = (list: readonly ColumnSpec[]) => {
  const m = registryOf(list);
  return (k: string) => m.get(k)?.label ?? k;
};

// ---- watch buttons ---------------------------------------------------------------------------------------------------

export type WatchTf = 'd' | 'w' | 'm';

export const WATCH_NOTE: Record<WatchTf, string> = {
  d: 'Unusual delivery in liquid Nifty 500 stocks, excluding record dates, deal days and circuits.',
  w: 'Unusual weekly delivery in liquid Nifty 500 stocks, excluding record dates, deal days and circuits.',
  m: 'Unusual monthly delivery in liquid Nifty 500 stocks, excluding record dates, deal days and circuits.',
};

/** The daily watch filters plus the timeframe (u=NIFTY500&mt=5&he=1&hetf=1&p=spikes, and tf=w or tf=m). */
export function watchParams(
  current: URLSearchParams,
  minTurnoverDefault: number,
  tf: WatchTf,
): URLSearchParams {
  const next = dailyWatchParams(current, minTurnoverDefault);
  return writeTimeframe(next, { ...DEFAULT_TF, tf });
}

export const PERIOD_VIEW_WORD: Record<'w' | 'm', string> = { w: 'Weekly', m: 'Monthly' };
