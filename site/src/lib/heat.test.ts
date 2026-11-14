import { describe, expect, it } from 'vitest';
import { axisRange, buildTree, colorT, gridDeviation, histogram, pin, quadrantLabel } from './heat';

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
