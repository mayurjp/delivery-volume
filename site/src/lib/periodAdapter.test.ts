import { describe, expect, it } from 'vitest';
import type { Market, PeriodSnapshotRow } from '../types/data';
import { aggregateGroupBars, barEdges, marketSeries } from './marketBars';
import { periodRowToDaily } from './periodAdapter';
import { DEFAULT_TF } from './timeframe';

const row: PeriodSnapshotRow = {
  sym: 'AAA',
  days: 5,
  open: 100,
  high: 112,
  low: 98,
  close: 110,
  prevClose: 100,
  vwap: 105,
  vol: 1000,
  turnoverCr: 12,
  trades: 50,
  delivQty: 500,
  delivPct: 55,
  delivValCr: 6.6,
  ret: 10,
  clv: 0.5,
  avgTradeSize: 2400,
  delivBalance: 1.4,
  delivValAvgN: 3,
  delivPctAvgN: 45,
  turnoverAvgCr: 2,
  spike: 2.2,
  delivPctDiff: 10,
  relTurnover: 1.5,
  tradeSizeRatio: 1.1,
  delivPctZ: 1.2,
  delivPctPctile: 80,
  streak: 2,
  signal: 'ACC',
  flags: 64,
  adjusted: 0,
};

describe('periodRowToDaily', () => {
  it('maps the period names onto the daily names the Screener reads', () => {
    const d = periodRowToDaily(row);
    expect(d.ret1).toBe(10);
    expect(d.delivPctAvg20).toBe(45);
    expect(d.delivValAvg20).toBe(3);
    expect(d.turnoverAvg20Cr).toBe(2);
    expect(d.relVol).toBe(1.5);
    expect(d.delivPctZ60).toBe(1.2);
    expect(d.series).toBe('EQ');
    expect(d.delivValAvg5).toBeNull();
    expect(d.delivBalance).toBe(1.4);
  });
});

const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
const market: Market = {
  schemaVersion: 1,
  dates,
  groups: {
    ALL: {
      turnoverCr: [10, 10, 20, 20, 40],
      delivValCr: [5, 6, 10, 8, 20],
      delivPctW: [50, 60, 50, 40, 50],
      medianDelivPct: [40, 42, 44, 46, 48],
      adv: [1, 2, 3, 4, 5],
      dec: [5, 4, 3, 2, 1],
      unch: [0, 0, 0, 0, 0],
      spikeCount2x: [1, 1, 1, 1, 1],
    },
  },
  indexClose: { 'Nifty 50': [1, 2, 3, 4, 5] },
  weekly: { keys: ['2026-W45'], ends: ['2026-11-06'], partial: [false], groups: {}, indexClose: {} },
  monthly: { keys: [], ends: [], partial: [], groups: {}, indexClose: {} },
  quarterly: { keys: [], ends: [], partial: [], groups: {}, indexClose: {} },
};

describe('market series per timeframe', () => {
  it('aligns N-day bars to end at the latest date and weights delivery % by value', () => {
    expect(barEdges(5, 2)).toEqual([
      [0, 1],
      [1, 3],
      [3, 5],
    ]);
    const s = aggregateGroupBars(dates, market.groups.ALL!, market.indexClose, 2);
    expect(s.ends).toEqual(['2026-11-02', '2026-11-04', '2026-11-06']);
    expect(s.partial).toEqual([true, false, false]);
    expect(s.group.turnoverCr).toEqual([10, 30, 60]);
    expect(s.group.delivValCr).toEqual([5, 16, 28]);
    expect(s.group.delivPctW[2]).toBeCloseTo((28 / 60) * 100);
    expect(s.group.adv).toEqual([1, 5, 9]);
    expect(s.indexClose['Nifty 50']).toEqual([1, 3, 5]);
  });
  it('reads the weekly block, and cuts a custom range out of the daily arrays', () => {
    expect(marketSeries(market, 'ALL', { ...DEFAULT_TF, tf: 'w' })).toBeNull(); // the fixture block has no ALL group
    const r = marketSeries(market, 'ALL', { ...DEFAULT_TF, tf: 'r', from: '2026-11-03', to: '2026-11-05' })!;
    expect(r.ends).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
    expect(r.group.delivValCr).toEqual([6, 10, 8]);
    expect(marketSeries(market, 'ALL', DEFAULT_TF)!.ends).toBe(dates);
    expect(marketSeries(market, 'NOPE', DEFAULT_TF)).toBeNull();
  });
});
