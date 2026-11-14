import { describe, expect, it } from 'vitest';
import type { Market } from '../types/data';
import { DEFAULT_TF, type TimeframeState } from './timeframe';
import {
  NORMAL_PERIODS,
  pointIndexFor,
  pointLabels,
  priorMean,
  selectedPoint,
  sectorTotals,
  splitPartial,
} from './statsSeries';

describe('pointIndexFor', () => {
  const ends = ['2026-11-06', '2026-11-13', '2026-11-20'];
  it('finds the period holding the date', () => {
    expect(pointIndexFor(ends, '2026-11-09')).toBe(1);
    expect(pointIndexFor(ends, '2026-11-13')).toBe(1);
    expect(pointIndexFor(ends, '2026-10-01')).toBe(0);
  });
  it('falls back to the last point and handles an empty series', () => {
    expect(pointIndexFor(ends, '2027-01-01')).toBe(2);
    expect(pointIndexFor([], '2026-11-09')).toBe(-1);
  });
});

describe('pointLabels', () => {
  it('uses period labels for w / m / q and dates for daily and bars', () => {
    const s = { keys: ['2026-11'], ends: ['2026-11-13'] };
    expect(pointLabels('m', s)).toEqual(['Nov 2026']);
    expect(pointLabels('w', s)[0]).toMatch(/^w\/e /);
    expect(pointLabels('c', s)).toEqual(['2026-11-13']);
    expect(pointLabels('d', s)).toEqual(['2026-11-13']);
    expect(pointLabels('q', { keys: ['2026-Q4'], ends: ['2026-12-31'] })).toEqual(['Q4 2026']);
  });
});

describe('priorMean', () => {
  it('averages the previous n points, skipping nulls, and needs half of them', () => {
    expect(priorMean([1, 2, 3, 10], 3, 3)).toBe(2);
    expect(priorMean([1, null, null, 10], 3, 3)).toBeNull();
    expect(priorMean([5, 10], 0, 3)).toBeNull();
  });
  it('normal-period counts follow the spec (10 weeks, 6 months)', () => {
    expect(NORMAL_PERIODS.w).toBe(10);
    expect(NORMAL_PERIODS.m).toBe(6);
  });
});

describe('splitPartial', () => {
  it('removes in-progress points from the solid line and joins them with a dashed segment', () => {
    const s = splitPartial([1, 2, 3, 4], [false, false, false, true]);
    expect(s.full).toEqual([1, 2, 3, null]);
    expect(s.dashed).toEqual([null, null, 3, 4]);
    expect(s.hasPartial).toBe(true);
    expect(splitPartial([1, 2], [false, false]).hasPartial).toBe(false);
  });
  it('handles a short first bar', () => {
    expect(splitPartial([1, 2, 3], [true, false, false]).dashed).toEqual([1, 2, null]);
  });
});

describe('sectorTotals', () => {
  it('sums delivery value per sector, largest first, skipping missing values', () => {
    const t = sectorTotals([
      { sector: 'Bank', delivVal: 10 },
      { sector: 'IT', delivVal: 30 },
      { sector: 'Bank', delivVal: 25 },
      { sector: 'IT', delivVal: null },
      { sector: '', delivVal: 99 },
    ]);
    expect(t).toEqual(
      [
        { name: 'IT', delivVal: 30 },
        { name: 'Bank', delivVal: 35 },
      ].sort((a, b) => b.delivVal - a.delivVal),
    );
  });
});

describe('selectedPoint', () => {
  const g = (v: number[]) => ({
    turnoverCr: v,
    delivValCr: v,
    delivPctW: v,
    medianDelivPct: v,
    adv: v,
    dec: v,
    unch: v,
    spikeCount2x: v,
  });
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
  const market = {
    dates,
    groups: { ALL: g([10, 20, 30, 40]) },
    indexClose: {},
    weekly: {
      keys: ['2026-W44', '2026-W45'],
      ends: ['2026-11-01', '2026-11-08'],
      partial: [false, true],
      groups: { ALL: g([1, 2]) },
      indexClose: {},
    },
  } as unknown as Market;
  const tf = (t: TimeframeState['tf'], extra: Partial<TimeframeState> = {}): TimeframeState => ({
    ...DEFAULT_TF,
    tf: t,
    ...extra,
  });
  it('daily: the point of the date; weekly: the week holding it', () => {
    expect(selectedPoint(market, 'ALL', tf('d'), '2026-11-04')!.i).toBe(2);
    const w = selectedPoint(market, 'ALL', tf('w'), '2026-11-05')!;
    expect(w.i).toBe(1);
    expect(w.series.partial[w.i]).toBe(true);
  });
  it('a custom range collapses into one bar over the range', () => {
    const r = selectedPoint(market, 'ALL', tf('r', { from: '2026-11-03', to: '2026-11-04' }), '2026-11-05')!;
    expect(r.i).toBe(0);
    expect(r.series.ends).toEqual(['2026-11-04']);
    expect(r.series.group.turnoverCr).toEqual([50]);
  });
  it('is null for an unknown group', () => {
    expect(selectedPoint(market, 'NOPE', tf('d'), '2026-11-04')).toBeNull();
  });
});
