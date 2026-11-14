import { describe, expect, it } from 'vitest';
import type { CumRow, SymbolRow } from '../types/data';
import { computeRange, pearson, rollingBand, stockStats } from './metrics';
import vectors from './vectors.json';

type Expected = Record<string, number | string | boolean | null>;

describe('computeRange against the shared Python vectors', () => {
  const v = vectors as unknown as {
    opts: Parameters<typeof computeRange>[4];
    cumA0: CumRow[];
    cumA1: CumRow[];
    cumB0: CumRow[];
    cumB1: CumRow[];
    expected: Expected[];
  };
  const got = computeRange(v.cumA0, v.cumA1, v.cumB0, v.cumB1, v.opts);

  it('returns one row per symbol in the range-end file', () => {
    expect(got.map((g) => g.sym)).toEqual(v.expected.map((e) => e.sym));
  });
  it('matches every numeric field to 1e-6', () => {
    for (const e of v.expected) {
      const g = got.find((x) => x.sym === e.sym) as unknown as Expected;
      for (const [k, val] of Object.entries(e)) {
        if (typeof val === 'number') expect(g[k] as number, `${e.sym}.${k}`).toBeCloseTo(val, 6);
        else if (k !== 'sym') expect(g[k], `${e.sym}.${k}`).toBe(val);
      }
    }
  });
  it('treats a missing cum/prev(a) as zero and flags listedDuringRange', () => {
    const a1 = v.cumA1.filter((r) => r.sym === 'AAA');
    const r = computeRange(null, a1, null, a1, v.opts)[0]!;
    expect(r.listedDuringRange).toBe(true);
    expect(r.ret).toBeNull();
    expect(r.nR).toBe(a1[0]!.cDays);
  });
  it('excludes rows with thin coverage or tiny baselines, with reasons', () => {
    const ccc = got.find((g) => g.sym === 'CCC')!;
    expect(ccc.excluded).toBe(true);
    expect(ccc.excludedReasons.length).toBeGreaterThan(0);
    expect(got.find((g) => g.sym === 'AAA')!.excluded).toBe(false);
  });
});

function sRow(i: number, dp: number | null, avg: number | null, close: number): SymbolRow {
  return {
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    series: 'EQ',
    close,
    delivPct: dp,
    delivPctAvg20: avg,
    turnoverCr: 10,
    delivValCr: dp === null ? null : dp / 10,
    flags: 0,
  } as SymbolRow;
}

describe('stockStats', () => {
  const rows = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 20, 30].map((dp, i) => sRow(i, dp, 50, 100 + i));
  it('computes descriptive statistics over the window', () => {
    const s = stockStats(rows, 12);
    expect(s.n).toBe(12);
    expect(s.mean).toBeCloseTo(50, 9);
    expect(s.median).toBeCloseTo(45, 9);
    expect(s.min).toBe(10);
    expect(s.max).toBe(100);
    expect(s.std).toBeCloseTo(
      Math.sqrt(rows.reduce((a, r) => a + ((r.delivPct as number) - 50) ** 2, 0) / 11),
      9,
    );
    expect(s.daysAbove60).toBe(4);
    // today's value is 30: five of the twelve values (10, 20, 30, 20, 30) are <= 30
    expect(s.todayPercentile).toBeCloseTo((5 / 12) * 100, 9);
  });
  it('finds the longest above-average streak and honours the window', () => {
    expect(stockStats(rows, 12).longestAboveAvgStreak).toBe(5); // 60, 70, 80, 90, 100
    expect(stockStats(rows, 2).n).toBe(2);
  });
  it('skips invalid days and needs 10 pairs for a correlation', () => {
    const withNull = [...rows.slice(0, 3), sRow(3, null, null, 103), ...rows.slice(4)];
    expect(stockStats(withNull, 12).n).toBe(11);
    expect(stockStats(rows.slice(0, 5), 5).corrNextDayRet).toBeNull();
  });
  it('pearson is 1 for a perfect line and null for a constant', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull();
  });
});

describe('rollingBand', () => {
  it('uses only prior values, with a minimum period', () => {
    const b = rollingBand([10, 20, 30, 40], 3, 2);
    expect(b.mean).toEqual([null, null, 15, 20]);
    expect(b.std[2]).toBeCloseTo(Math.SQRT2 * 5, 9);
  });
});
