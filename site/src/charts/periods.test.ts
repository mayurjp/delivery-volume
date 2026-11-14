import { describe, expect, it } from 'vitest';
import type { PeriodRow, PeriodsConfig } from '../lib/aggregate';
import { LIGHT } from './theme';
import {
  BALANCE_CAP,
  axisLabel,
  barHolding,
  barSpecOf,
  baselineLabel,
  defaultBars,
  defaultZoom,
  periodChartOption,
  periodSeries,
  periodTitle,
  periodTooltipLines,
  splitMarkers,
} from './periods';

const CFG = {
  minPeriodsFraction: 0.5,
  liquidity: { minTurnoverAvg20Cr: 1, minBaseDelivValCr: 0.5 },
  periods: {
    w: { base: 10, long: 52, minHistory: 6, daysPerPeriod: 5 },
    m: { base: 6, long: 24, minHistory: 4, daysPerPeriod: 21 },
    q: { base: 4, long: 8, minHistory: 3, daysPerPeriod: 63 },
  },
} as PeriodsConfig;

const row = (o: Partial<PeriodRow> = {}): PeriodRow => ({
  key: '2026-W46',
  start: '2026-11-09',
  end: '2026-11-13',
  daysIn: 5,
  daysExpected: 5,
  partial: false,
  days: 5,
  open: 100,
  high: 110,
  low: 95,
  close: 105,
  prevClose: 99,
  vwap: 102,
  vol: 1000,
  turnoverCr: 10,
  trades: 500,
  delivQty: 600,
  delivValCr: 6,
  delivPct: 60,
  ret: 6.06,
  clv: 0.5,
  avgTradeSize: 20000,
  delivBalance: 2,
  delivValAvgN: 4,
  delivPctAvgN: 50,
  turnoverAvgCr: 8,
  spike: 1.5,
  delivPctDiff: 10,
  relTurnover: 1.2,
  tradeSizeRatio: 1,
  delivPctZ: 1,
  delivPctPctile: 70,
  streak: 1,
  signal: null,
  flags: 0,
  adjusted: 0,
  ...o,
});

describe('period series', () => {
  const rows = [
    row({ key: '2026-W45', end: '2026-11-06', adjusted: 1, delivBalance: 40 }),
    row({ partial: true, daysIn: 3, daysExpected: 5, delivQty: null }),
  ];
  const s = periodSeries(rows, 'w');
  it('maps candles in ECharts order and the stacked quantity', () => {
    expect(s.candles[0]).toEqual([100, 105, 95, 110]);
    expect(s.delivered).toEqual([600, null]);
    expect(s.nonDelivered).toEqual([400, null]);
  });
  it('carries delivery %, baseline, spike and the capped balance', () => {
    expect(s.delivPct).toEqual([60, 60]);
    expect(s.base).toEqual([50, 50]);
    expect(s.spike).toEqual([1.5, 1.5]);
    expect(s.balance).toEqual([BALANCE_CAP, 2]);
  });
  it('flags partial and split-adjusted periods', () => {
    expect(s.partial).toEqual([false, true]);
    expect(s.adjusted).toEqual([true, false]);
    expect(splitMarkers(rows)).toEqual([{ key: '2026-W45', y: 110 }]);
  });
  it('labels the axis and the tooltip title per timeframe', () => {
    expect(axisLabel('w', row())).toBe('13 Nov');
    expect(axisLabel('m', row({ key: '2026-11' }))).toBe('Nov 26');
    expect(axisLabel('q', row({ key: '2026-Q4' }))).toBe('Q4 26');
    expect(periodTitle('w', row())).toBe('w/e 13 Nov 2026');
    expect(periodTitle('m', row({ key: '2026-11' }))).toBe('Nov 2026');
    expect(periodTitle('q', row({ key: '2026-Q4' }))).toBe('Q4 2026');
    expect(periodTitle({ kind: 'n', n: 10 }, row({ start: '2026-10-30' }))).toBe(
      '30 Oct 2026 to 13 Nov 2026',
    );
  });
});

describe('default zoom', () => {
  it('shows 52 weeks, everything for months and quarters, about a year for N-day bars', () => {
    expect(defaultBars('w')).toBe(52);
    expect(defaultZoom('w', 156)).toEqual({ start: (1 - 52 / 156) * 100, end: 100 });
    expect(defaultZoom('w', 40)).toEqual({ start: 0, end: 100 });
    expect(defaultZoom('m', 36)).toEqual({ start: 0, end: 100 });
    expect(defaultZoom('q', 12)).toEqual({ start: 0, end: 100 });
    expect(defaultBars({ kind: 'n', n: 10 })).toBe(26);
    expect(defaultBars({ kind: 'n', n: 120 })).toBe(12);
    const z = defaultZoom({ kind: 'n', n: 10 }, 75);
    expect(z.start).toBeCloseTo((1 - 26 / 75) * 100);
    expect(defaultZoom('w', 0)).toEqual({ start: 0, end: 100 });
  });
});

describe('tooltip', () => {
  it('states in-progress periods and split-adjusted prices, with units', () => {
    const lines = periodTooltipLines(row({ partial: true, daysIn: 3, adjusted: 1 }), 'w', CFG).join('\n');
    expect(lines).toContain('w/e 13 Nov 2026');
    expect(lines).toContain('in progress (3 of 5 days)');
    expect(lines).toContain('split-adjusted');
    expect(lines).toContain('10-week average');
    expect(lines).toContain('Delivery value 6 Cr');
    expect(lines).toContain('spike 1.5×');
  });
  it('has no partial or adjusted text for a complete plain period', () => {
    const lines = periodTooltipLines(row(), 'w', CFG).join('\n');
    expect(lines).not.toContain('in progress');
    expect(lines).not.toContain('split-adjusted');
  });
  it('words the baseline per bar type', () => {
    expect(baselineLabel('m', CFG)).toBe('6-month average');
    expect(baselineLabel('q', CFG)).toBe('4-quarter average');
    expect(baselineLabel({ kind: 'n', n: 5 }, CFG)).toBe('prior 10-bar average');
  });
});

describe('bar helpers', () => {
  it('maps the timeframe state to a bar spec', () => {
    expect(barSpecOf({ tf: 'w', n: 10 })).toBe('w');
    expect(barSpecOf({ tf: 'q', n: 10 })).toBe('q');
    expect(barSpecOf({ tf: 'c', n: 7 })).toEqual({ kind: 'n', n: 7 });
    expect(barSpecOf({ tf: 'r', n: 7 })).toBeNull();
    expect(barSpecOf({ tf: 'd', n: 7 })).toBeNull();
  });
  it('finds the bar that holds the date, else the last one before it, else the newest', () => {
    const rows = [
      row({ key: 'a', start: '2026-11-02', end: '2026-11-06' }),
      row({ key: 'b', start: '2026-11-09', end: '2026-11-13' }),
    ];
    expect(barHolding(rows, '2026-11-10')?.key).toBe('b');
    expect(barHolding(rows, '2026-11-07')?.key).toBe('a');
    expect(barHolding(rows, '2026-01-01')?.key).toBe('b');
    expect(barHolding(rows, null)?.key).toBe('b');
    expect(barHolding([], '2026-11-10')).toBeNull();
  });
});

describe('period chart option', () => {
  const rows = [row({ key: '2026-W45', end: '2026-11-06' }), row({ partial: true, adjusted: 1 })];
  const o = periodChartOption(rows, 'w', LIGHT, { mobile: false, cfg: CFG }) as {
    grid: unknown[];
    yAxis: { name: string }[];
    series: { name: string; type: string; markPoint?: unknown }[];
    dataZoom: { start: number; end: number }[];
  };
  it('has four panes with units on every axis', () => {
    expect(o.grid).toHaveLength(4);
    expect(o.yAxis.map((a) => a.name)).toEqual(['₹', 'Shares', 'Delivery %', 'Ratio (×)']);
  });
  it('has candles, stacked quantity, delivery % with its baseline, spike and balance bars', () => {
    expect(o.series.map((x) => x.type)).toEqual(['candlestick', 'bar', 'bar', 'line', 'line', 'bar', 'bar']);
    expect(o.series[0]!.markPoint).toBeDefined();
    expect(o.series[3]!.name).toBe('Delivery %');
    expect(o.series[4]!.name).toContain('10-week average');
  });
  it('starts with everything shown for a short history', () => {
    expect(o.dataZoom[0]).toMatchObject({ start: 0, end: 100 });
  });
});
