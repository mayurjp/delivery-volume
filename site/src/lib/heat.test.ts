import { describe, expect, it } from 'vitest';
import type { Market } from '../types/data';
import {
  axisRange,
  buildGroupGrid,
  buildTree,
  colorT,
  GRID_UNIT,
  gridColumnCount,
  gridColumnLabel,
  gridDeviation,
  histogram,
  pin,
  quadrantLabel,
} from './heat';
import { DEFAULT_TF, type TimeframeState } from './timeframe';

describe('colour scales', () => {
  it('spike is log2, diverging at 1x and clamped to 0.25x-4x', () => {
    expect(colorT('spike', 1)).toBe(0);
    expect(colorT('spike', 2)).toBeCloseTo(0.5, 9);
    expect(colorT('spike', 0.5)).toBeCloseTo(-0.5, 9);
    expect(colorT('spike', 100)).toBe(1);
    expect(colorT('spike', 0.01)).toBe(-1);
    expect(colorT('diff', 12.5)).toBe(0.5);
    expect(colorT('diff', -40)).toBe(-1);
    expect(colorT('ret', 2.5)).toBe(0.5);
    expect(colorT('ret', null)).toBeNull();
  });
});

describe('treemap tree', () => {
  it('groups by sector, sums sizes and weights the sector colour by size', () => {
    const mk = (sym: string, sector: string, size: number, value: number) => ({
      sym,
      name: sym,
      sector,
      size,
      value,
      dp: 1,
      dpAvg: 1,
      spike: value,
      ret: 0,
    });
    const t = buildTree(
      [mk('A', 'X', 3, 2), mk('B', 'X', 1, 0.5), mk('C', 'Y', 10, 1), mk('Z', 'Y', 0, 4)],
      'spike',
    );
    expect(t.map((n) => n.name)).toEqual(['Y', 'X']);
    expect(t[1]!.value).toBe(4);
    expect(t[1]!.t).toBeCloseTo((3 * 0.5 + 1 * -0.5) / 4, 9);
    expect(t[0]!.children).toHaveLength(1); // zero-size tiles are dropped
  });
});

describe('quadrant scatter helpers', () => {
  it('clamps axes at the 2nd/98th percentile and pins outliers to the edge', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i - 50);
    xs.push(10_000);
    const r = axisRange(xs);
    expect(r[1]).toBeLessThan(100);
    expect(pin(10_000, r)).toEqual({ value: r[1], pinned: true });
    expect(pin(1, r)).toEqual({ value: 1, pinned: false });
  });
  it('labels quadrants as in 04 section 4.3', () => {
    expect(quadrantLabel(1, 1)).toBe('Price ↑ on rising delivery');
    expect(quadrantLabel(-1, 1)).toBe('Price ↓ on rising delivery');
    expect(quadrantLabel(1, -1)).toBe('Price ↑ on falling delivery');
    expect(quadrantLabel(-1, -1)).toBe('Price ↓ on falling delivery');
  });
});

describe('statistics helpers', () => {
  it('histogram uses 5-point bins and puts 100 in the last bin', () => {
    const h = histogram([0, 4.9, 5, 99.9, 100]);
    expect(h).toHaveLength(20);
    expect(h[0]!.count).toBe(2);
    expect(h[1]!.count).toBe(1);
    expect(h[19]!.count).toBe(2);
  });
  it('grid deviation is the value minus the group own 60-day mean', () => {
    expect(gridDeviation([10, 20, 30], 1, 60)).toEqual([0, 10]);
  });
});

describe('group grid per timeframe', () => {
  const dates = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
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
  const blockN = 25;
  const flat = Array.from({ length: blockN }, (_, i) => 40 + i);
  const block = {
    keys: Array.from({ length: blockN }, (_, i) => `2026-W${i + 1}`),
    ends: Array.from({ length: blockN }, (_, i) => `2026-03-${String((i % 28) + 1).padStart(2, '0')}`),
    partial: Array.from({ length: blockN }, (_, i) => i === blockN - 1),
    groups: { 'SEC:Bank': g(flat), 'IDX:X': g(flat.map(() => 50)) },
    indexClose: {},
  };
  const daily = dates.map((_, i) => 40 + i);
  const market = {
    dates,
    groups: { 'SEC:Bank': g(daily), 'IDX:X': g(daily.map(() => 50)) },
    indexClose: {},
    weekly: block,
    monthly: { ...block, keys: block.keys.map((_, i) => `2026-${String((i % 12) + 1).padStart(2, '0')}`) },
    quarterly: { ...block, keys: block.keys.map((_, i) => `2026-Q${(i % 4) + 1}`) },
  } as unknown as Market;
  const tf = (t: TimeframeState['tf']): TimeframeState => ({ ...DEFAULT_TF, tf: t, n: 5 });

  it('picks the column count per timeframe', () => {
    expect(gridColumnCount('d', 20)).toBe(20);
    expect(gridColumnCount('d', 60)).toBe(60);
    expect(gridColumnCount('r', 60)).toBe(60);
    expect(gridColumnCount('w')).toBe(20);
    expect(gridColumnCount('m')).toBe(12);
    expect(gridColumnCount('q')).toBe(8);
    expect(gridColumnCount('c')).toBe(20);
  });

  it('daily grid: the last 20 days, no labels, deviation from the group mean', () => {
    const grid = buildGroupGrid(market, 'SEC:', tf('d'));
    expect(grid.rows).toEqual(['Bank']);
    expect(grid.dates).toHaveLength(20);
    expect(grid.labels).toBeUndefined();
    expect(grid.cells).toHaveLength(20);
    const mean = daily.reduce((s, x) => s + x, 0) / 30;
    expect(grid.cells[19]![2]).toBeCloseTo(69 - mean);
  });

  it('weekly, monthly and quarterly grids take the last 20 / 12 / 8 columns with labels; a partial one is starred', () => {
    const w = buildGroupGrid(market, 'SEC:', tf('w'));
    expect(w.dates).toHaveLength(20);
    expect(w.labels).toHaveLength(20);
    expect(w.labels![19]!.endsWith('*')).toBe(true);
    expect(w.labels![0]!.startsWith('w/e')).toBe(true);
    expect(w.lastPartial).toBe(true);
    expect(buildGroupGrid(market, 'SEC:', tf('m')).dates).toHaveLength(12);
    const q = buildGroupGrid(market, 'SEC:', tf('q'));
    expect(q.dates).toHaveLength(8);
    expect(q.labels![0]).toMatch(/^Q\d 2026\*?$/);
  });

  it('N-day bars: bars of 5 days ending at the last date', () => {
    const c = buildGroupGrid(market, 'IDX:', tf('c'));
    expect(c.rows).toEqual(['X']);
    expect(c.dates).toHaveLength(6); // 30 days / 5
    expect(c.dates[5]).toBe(dates[29]);
    expect(c.labels).toHaveLength(6);
  });

  it('a custom range keeps the daily columns inside the range only', () => {
    const r = buildGroupGrid(market, 'SEC:', { ...tf('r'), from: dates[10]!, to: dates[14]! });
    expect(r.dates).toEqual(dates.slice(10, 15));
  });

  it('labels columns and names the unit', () => {
    expect(gridColumnLabel('d', 'k', '2026-01-02', false)).toBe('2026-01-02');
    expect(gridColumnLabel('c', 'k', '2026-01-02', true)).toBe('2026-01-02*');
    expect(GRID_UNIT.m).toBe('months');
  });
});
