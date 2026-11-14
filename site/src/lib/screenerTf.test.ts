import { describe, expect, it } from 'vitest';
import type { PeriodSnapshotRow } from '../types/data';
import { COLUMNS } from './columns';
import { periodRowToDaily } from './periodAdapter';
import { PRESETS } from './presets';
import { RANGE_COLUMN_BY_KEY } from './rangeColumns';
import {
  PERIOD_DEFAULT_COLUMNS,
  PRESET_NEEDS,
  dayColumnList,
  isSlimDay,
  periodColumnList,
  presetBlockedBy,
  presetReason,
  screenerView,
  slimMissingKeys,
  slimReason,
  watchParams,
} from './screenerTf';

const PUBLISH = {
  dailyFullFrom: '2025-10-28',
  dailySlimColumns: [
    'sym',
    'series',
    'open',
    'high',
    'low',
    'close',
    'prevClose',
    'vwap',
    'vol',
    'turnoverCr',
    'trades',
    'delivQty',
    'delivPct',
    'delivValCr',
    'spike',
    'delivPctDiff',
    'ret1',
    'signal',
    'flags',
  ],
};

describe('screener view', () => {
  it('maps the timeframe to a table', () => {
    expect(screenerView('d', false, false)).toBe('day');
    expect(screenerView('d', true, false)).toBe('range');
    expect(screenerView('w', false, false)).toBe('period');
    expect(screenerView('m', true, false)).toBe('period');
    for (const t of ['q', 'c', 'r'] as const) expect(screenerView(t, true, false)).toBe('rangeTf');
    expect(screenerView('w', false, true)).toBe('day');
  });
});

describe('slim days', () => {
  it('detects days before dailyFullFrom', () => {
    expect(isSlimDay('2025-10-27', PUBLISH)).toBe(true);
    expect(isSlimDay('2025-10-28', PUBLISH)).toBe(false);
  });
  it('lists the columns a slim day lacks, not universe-derived ones', () => {
    const miss = slimMissingKeys(PUBLISH);
    for (const k of ['delivValAvg20', 'delivPctAvg20', 'delivPctZ60', 'streak', 'clv', 'tradeSizeRatio'])
      expect(miss.has(k)).toBe(true);
    for (const k of ['spike', 'delivPct', 'close', 'signal', 'name', 'sector', 'mcapCr', 'chg'])
      expect(miss.has(k)).toBe(false);
  });
  it('turns missing columns into dashes with the reason in the tip', () => {
    const reason = slimReason(PUBLISH.dailyFullFrom);
    const list = dayColumnList(slimMissingKeys(PUBLISH), reason);
    const z = list.find((c) => c.key === 'delivPctZ60')!;
    const row = { delivPctZ60: 2.5 } as never;
    expect(z.fmt(row)).toBe('—');
    expect(z.cellTip?.(row)).toContain('Not published for days before 28 Oct 2025');
    expect(z.tip).toContain('slim column set');
    const ok = list.find((c) => c.key === 'delivPct')!;
    expect(ok.cellTip).toBeUndefined();
  });
});

describe('preset availability', () => {
  const miss = slimMissingKeys(PUBLISH);
  it('disables the presets that need non-slim columns, with a reason', () => {
    expect(presetBlockedBy('drops', miss)).toEqual(['delivValAvg20']);
    expect(presetBlockedBy('unusual', miss)).toEqual(['delivPctZ60']);
    expect(presetBlockedBy('streak', miss)).toEqual(['streak']);
    expect(presetReason('unusual', miss, (k) => k, 'x')).toContain('Needs delivPctZ60');
  });
  it('keeps the slim-only presets available', () => {
    for (const id of [
      'spikes',
      'highpct',
      'jump',
      'fall',
      'value',
      'acc',
      'dis',
      'high52low',
      'high52heavy',
      'largedis',
    ])
      expect(presetBlockedBy(id, miss)).toEqual([]);
    expect(presetReason('spikes', miss, (k) => k, 'x')).toBeNull();
  });
  it('every preset is described', () => {
    for (const p of PRESETS) expect(PRESET_NEEDS[p.id]).toBeDefined();
  });
  it('never blocks a preset in a weekly or monthly view', () => {
    const none = new Set<string>(['delivValAvg5', 'delivValAvg50', 'volAvg20', 'vwapGap']);
    for (const p of PRESETS) expect(presetBlockedBy(p.id, none)).toEqual([]);
  });
});

const snap = (o: Partial<PeriodSnapshotRow> = {}): PeriodSnapshotRow =>
  ({
    sym: 'ABC',
    days: 4,
    open: 100,
    high: 110,
    low: 95,
    close: 105,
    prevClose: 98,
    vwap: 102,
    vol: 1000,
    turnoverCr: 12,
    trades: 800,
    delivQty: 500,
    delivPct: 50,
    delivValCr: 6,
    ret: 7.14,
    clv: 0.4,
    avgTradeSize: 15000,
    delivBalance: 1.8,
    delivValAvgN: 4,
    delivPctAvgN: 44,
    turnoverAvgCr: 10,
    spike: 1.5,
    delivPctDiff: 6,
    relTurnover: 1.2,
    tradeSizeRatio: 1.1,
    delivPctZ: 1.0,
    delivPctPctile: 80,
    streak: 2,
    signal: 'ACC',
    flags: 0,
    adjusted: 1,
    ...o,
  }) as PeriodSnapshotRow;

describe('period table mapping', () => {
  const list = periodColumnList('w', { base: 10, long: 52 });
  const by = new Map(list.map((c) => [c.key as string, c]));
  const row = { ...periodRowToDaily(snap()), name: 'ABC', sector: 's', mcapCr: 1, bucket: null, chg: 7 };
  it('adds the period columns after Trades', () => {
    const keys = list.map((c) => c.key as string);
    expect(keys.indexOf('days')).toBe(keys.indexOf('trades') + 1);
    for (const k of ['days', 'delivBalance', 'avgTradeSize', 'adjusted']) expect(keys).toContain(k);
    for (const k of PERIOD_DEFAULT_COLUMNS) expect(keys).toContain(k);
  });
  it('formats days, balance, trade size and the split marker', () => {
    expect(by.get('days')!.fmt(row)).toBe('4');
    expect(by.get('delivBalance')!.fmt(row)).toBe('1.8×');
    expect(by.get('avgTradeSize')!.fmt(row)).toContain('15,000');
    expect(by.get('adjusted')!.fmt(row)).toBe('⚠');
    expect(by.get('adjusted')!.cellTip?.(row)).toContain('split-adjusted');
    expect(by.get('adjusted')!.fmt({ ...row, adjusted: 0 })).toBe('');
  });
  it('uses period wording and baseline windows', () => {
    expect(by.get('delivPctAvg20')!.label).toBe('Deliv % 10W');
    expect(by.get('delivPctZ60')!.label).toBe('Z 52W');
    const m = new Map(periodColumnList('m', { base: 6, long: 24 }).map((c) => [c.key as string, c]));
    expect(m.get('delivValAvg20')!.label).toBe('Dv avg 6M');
  });
  it('shows a dash with a tooltip for fields a period never has', () => {
    const c = by.get('volAvg20')!;
    expect(c.fmt(row)).toBe('—');
    expect(c.cellTip?.(row)).toContain('weekly and monthly snapshots');
  });
  it('keeps the daily column list unchanged', () => {
    expect(COLUMNS.some((c) => c.key === 'days')).toBe(false);
  });
});

describe('watch buttons', () => {
  const base = new URLSearchParams('d=2026-11-06&rng=1&q=abc');
  it('mirrors the daily watch and adds the timeframe', () => {
    const w = watchParams(base, 1, 'w');
    expect(w.get('tf')).toBe('w');
    expect(w.get('u')).toBe('NIFTY500');
    expect(w.get('mt')).toBe('5');
    expect(w.get('he')).toBe('1');
    expect(w.get('hetf')).toBe('1');
    expect(w.get('p')).toBe('spikes');
    expect(w.get('rng')).toBeNull();
    expect(w.get('d')).toBe('2026-11-06');
    expect(watchParams(base, 1, 'm').get('tf')).toBe('m');
  });
  it('the daily watch clears any timeframe', () => {
    const d = watchParams(new URLSearchParams('tf=c&n=10'), 1, 'd');
    expect(d.get('tf')).toBeNull();
    expect(d.get('n')).toBeNull();
    expect(d.get('p')).toBe('spikes');
  });
});

describe('range columns for q, c and r', () => {
  const row = {
    delivBalanceR: 1.5,
    delivBalanceB: 0.9,
    avgTradeSizeR: 12000,
    avgTradeSizeB: 10000,
    tradeSizeRatio: 1.2,
  } as never;
  it('shows balance, trade size and its ratio, with the baseline in the tooltip', () => {
    const bal = RANGE_COLUMN_BY_KEY.get('delivBalanceR')!;
    expect(bal.fmt(row)).toBe('1.5×');
    expect(bal.cellTip?.(row)).toContain('baseline 0.9×');
    expect(RANGE_COLUMN_BY_KEY.get('avgTradeSizeR')!.cellTip?.(row)).toContain('baseline ₹10,000');
    expect(RANGE_COLUMN_BY_KEY.get('tradeSizeRatio')!.fmt(row)).toBe('1.2×');
  });
  it('always shows a dash for high, low and close location', () => {
    for (const k of ['high', 'low', 'clv']) {
      const c = RANGE_COLUMN_BY_KEY.get(k)!;
      expect(c.fmt(row)).toBe('—');
      expect(c.cellTip?.(row)).toBe(
        'High, low and close location are not derivable from cumulative files; open the stock page',
      );
    }
  });
});
