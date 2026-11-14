import { FLAG, type DailyRow, type UniverseRow } from '../types/data';
import { defaultFilters } from './filters';
import { writeFilters } from './urlState';

/** Daily top lists (04 section 2). Thresholds mirror config/signals.json -> lists. */

export const LIST_EXCLUDED = FLAG.lowLiquidity | FLAG.t2t | FLAG.newListing;

export interface Preset {
  id: string;
  label: string;
  /** Sort key (a DailyRow field) and direction. */
  sort: keyof DailyRow;
  dir: 'asc' | 'desc';
  test: (r: DailyRow, u: UniverseRow | undefined) => boolean;
}

const has = (v: number | null): v is number => v !== null;

export const PRESETS: Preset[] = [
  {
    id: 'spikes',
    label: 'Delivery spikes',
    sort: 'spike',
    dir: 'desc',
    test: (r) => has(r.spike) && (r.delivValCr ?? 0) >= 1,
  },
  {
    id: 'drops',
    label: 'Delivery drops',
    sort: 'spike',
    dir: 'asc',
    test: (r) => has(r.spike) && (r.delivValAvg20 ?? 0) >= 1,
  },
  {
    id: 'highpct',
    label: 'Highest delivery %',
    sort: 'delivPct',
    dir: 'desc',
    test: (r) => has(r.delivPct) && (r.turnoverCr ?? 0) >= 5,
  },
  {
    id: 'jump',
    label: 'Delivery % jump',
    sort: 'delivPctDiff',
    dir: 'desc',
    test: (r) => has(r.delivPctDiff),
  },
  {
    id: 'fall',
    label: 'Delivery % fall',
    sort: 'delivPctDiff',
    dir: 'asc',
    test: (r) => has(r.delivPctDiff),
  },
  {
    id: 'value',
    label: 'Largest delivery value',
    sort: 'delivValCr',
    dir: 'desc',
    test: (r) => has(r.delivValCr),
  },
  { id: 'streak', label: 'Sustained rise', sort: 'streak', dir: 'desc', test: (r) => (r.streak ?? 0) >= 5 },
  {
    id: 'unusual',
    label: 'Unusual vs own history',
    sort: 'delivPctZ60',
    dir: 'desc',
    test: (r) => (r.delivPctZ60 ?? -Infinity) >= 2,
  },
  { id: 'acc', label: 'Up on heavy delivery', sort: 'spike', dir: 'desc', test: (r) => r.signal === 'ACC' },
  { id: 'dis', label: 'Down on heavy delivery', sort: 'spike', dir: 'desc', test: (r) => r.signal === 'DIS' },
  {
    id: 'high52low',
    label: 'New 52-week high, low delivery',
    sort: 'ret1',
    dir: 'desc',
    test: (r) => (r.flags & FLAG.high52) !== 0 && (r.spike ?? Infinity) < 1,
  },
  {
    id: 'high52heavy',
    label: 'New 52-week high, heavy delivery',
    sort: 'spike',
    dir: 'desc',
    test: (r) => (r.flags & FLAG.high52) !== 0 && (r.spike ?? -Infinity) >= 2,
  },
  {
    id: 'largedis',
    label: 'Large cap: down on heavy delivery',
    sort: 'spike',
    dir: 'desc',
    test: (r, u) => u?.bucket === 'L' && r.signal === 'DIS',
  },
  // F&O build-up (04 section 4.4, Phase 5): F&O stock-days only, so rows without a build-up code never match
  {
    id: 'accLB',
    label: 'Delivery ↑ + Long build-up',
    sort: 'spike',
    dir: 'desc',
    test: (r) => r.signal === 'ACC' && r.buildup === 'LB',
  },
  { id: 'buLB', label: 'Long build-up', sort: 'futOiChgPct', dir: 'desc', test: (r) => r.buildup === 'LB' },
  { id: 'buSB', label: 'Short build-up', sort: 'futOiChgPct', dir: 'desc', test: (r) => r.buildup === 'SB' },
  { id: 'buSC', label: 'Short covering', sort: 'futOiChgPct', dir: 'asc', test: (r) => r.buildup === 'SC' },
  { id: 'buLU', label: 'Long unwinding', sort: 'futOiChgPct', dir: 'asc', test: (r) => r.buildup === 'LU' },
];

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

/** Screener preset chips, grouped (05 section 4, P2). "More" is collapsed by default. */
export interface PresetGroup {
  id: string;
  label: string;
  ids: string[];
  collapsed?: boolean;
}

export const PRESET_GROUPS: PresetGroup[] = [
  { id: 'start', label: 'Start here', ids: ['spikes', 'unusual', 'value'] },
  { id: 'direction', label: 'Direction', ids: ['acc', 'dis', 'accLB'] },
  { id: 'patterns', label: 'Patterns', ids: ['high52low', 'high52heavy'] },
  { id: 'fo', label: 'F&O build-up', ids: ['buLB', 'buSB', 'buSC', 'buLU'] },
  {
    id: 'more',
    label: 'More',
    ids: ['highpct', 'jump', 'fall', 'streak', 'drops', 'largedis'],
    collapsed: true,
  },
];

/** signal_perf event (and optional group) that a preset's history line reads. Presets without one are rankings. */
export const PRESET_EVENT: Record<string, { event: string; group?: string }> = {
  spikes: { event: 'SPIKE2' },
  unusual: { event: 'Z2' },
  acc: { event: 'ACC' },
  dis: { event: 'DIS' },
  high52low: { event: 'BO_LOW' },
  high52heavy: { event: 'BO_HEAVY' },
  largedis: { event: 'DIS', group: 'L' },
  accLB: { event: 'ACC_LB' },
  buLB: { event: 'BU_LB' },
  buSB: { event: 'BU_SB' },
  buSC: { event: 'BU_SC' },
  buLU: { event: 'BU_LU' },
};

/** The one-tap "Daily delivery watch" (Screener): liquid Nifty 500 stocks, no ETFs or event-driven rows, spikes list. */
export const DAILY_WATCH_NOTE =
  'Unusual delivery in liquid Nifty 500 stocks, excluding record dates, deal days and circuits.';

export function dailyWatchParams(current: URLSearchParams, minTurnoverDefault: number): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete('p'); // re-added last, so the URL always reads filters first, then the preset
  writeFilters(
    next,
    { ...defaultFilters(minTurnoverDefault), u: 'NIFTY500', minTurn: 5, hideEtfs: true, hideEvents: true },
    minTurnoverDefault,
  );
  next.set('p', 'spikes');
  next.delete('s');
  next.delete('q');
  for (const k of ['rng', 'r', 'ra', 'rb', 'bl', 'ba', 'bb']) next.delete(k);
  return next;
}

/** Rows of a preset: its filter, minus the default exclusions (low liquidity, T2T, new listings), sorted. */
export function runPreset(
  p: Preset,
  rows: readonly DailyRow[],
  universe: ReadonlyMap<string, UniverseRow>,
): DailyRow[] {
  const key = p.sort;
  const sign = p.dir === 'asc' ? 1 : -1;
  return rows
    .filter((r) => (r.flags & LIST_EXCLUDED) === 0 && p.test(r, universe.get(r.sym)))
    .sort((a, b) => {
      const x = a[key] as number | null;
      const y = b[key] as number | null;
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return sign * (x - y);
    });
}
