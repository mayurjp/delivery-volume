import { FLAG, type DailyRow, type UniverseRow } from '../types/data';

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
];

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

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
