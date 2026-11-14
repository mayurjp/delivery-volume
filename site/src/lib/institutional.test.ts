import { describe, expect, it } from 'vitest';
import type { CashRow } from '../types/data';
import { cashStreakOf, cashSum, monthlyCash, participantLongPct, percentileBand } from './institutional';

const cash = (date: string, fiiNet: number | null, diiNet: number | null): CashRow => ({
  date,
  fiiBuy: null,
  fiiSell: null,
  fiiNet,
  diiBuy: null,
  diiSell: null,
  diiNet,
});

describe('institutional series', () => {
  it('long share is long over long plus short, and null for an empty position', () => {
    expect(participantLongPct({ futIdxLong: 75, futIdxShort: 25 })).toBe(75);
    expect(participantLongPct({ futIdxLong: 0, futIdxShort: 0 })).toBeNull();
  });

  it('percentile band uses nearest rank and ignores missing values', () => {
    const xs = [10, null, 20, 30, 40, 50, 60, 70, 80, 90];
    expect(percentileBand(xs, 10, 90)).toEqual({ lo: 10, hi: 90, median: 50 });
    expect(percentileBand([null, null], 10, 90)).toBeNull();
  });

  it('a streak counts consecutive days of one sign, and a day with no value breaks it', () => {
    const rows = [
      cash('d1', -5, 1),
      cash('d2', 3, 1),
      cash('d3', 4, null),
      cash('d4', 2, 1),
      cash('d5', 6, 1),
    ];
    expect(cashStreakOf(rows, 'fiiNet')).toBe(4); // d2 to d5 are all positive; d1 is negative
    expect(cashStreakOf(rows, 'diiNet')).toBe(2); // d4 and d5; d3 has no DII value, so it is not bridged
    expect(cashStreakOf([cash('d1', -5, -1), cash('d2', -2, -1)], 'fiiNet')).toBe(-2);
  });

  it('cash sums count only days that have a record', () => {
    const rows = [cash('d1', 10, 1), cash('d2', null, 1), cash('d3', 5, 1)];
    expect(cashSum(rows, 'fiiNet', 5)).toEqual({ sum: 15, n: 2 });
    expect(cashSum(rows, 'diiNet', 2)).toEqual({ sum: 2, n: 2 });
  });

  it('monthly totals add the days of each month that have both values', () => {
    const rows = [cash('2026-10-30', 1, 2), cash('2026-11-02', 3, null), cash('2026-11-03', 4, 5)];
    expect(monthlyCash(rows)).toEqual([
      { month: '2026-10', fiiNet: 1, diiNet: 2, days: 1 },
      { month: '2026-11', fiiNet: 4, diiNet: 5, days: 1 },
    ]);
  });
});
