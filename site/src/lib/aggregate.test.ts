import { describe, expect, it } from 'vitest';
import {
  aggregatePeriods,
  aggregateRange,
  skipSet,
  periodKey,
  periodsFor,
  priceAdjustment,
  type AggInput,
  type PeriodRow,
  type PeriodsConfig,
} from './aggregate';
import vectors from './periodVectors.json';

interface Vec {
  config: PeriodsConfig;
  tradingDays: string[];
  stocks: Record<string, AggInput[]>;
  expected: Record<string, Record<string, unknown>>;
}
const V = vectors as unknown as Vec;

function expectClose(got: unknown, want: unknown, path: string): void {
  if (typeof want === 'number' && typeof got === 'number') {
    const tol = 1e-9 * Math.max(1, Math.abs(want));
    expect(Math.abs(got - want), `${path}: ${got} vs ${want}`).toBeLessThanOrEqual(tol);
  } else {
    expect(got, path).toEqual(want);
  }
}

function expectRows(got: PeriodRow[], want: Record<string, unknown>[], label: string): void {
  expect(got.length, `${label}: row count`).toBe(want.length);
  want.forEach((w, i) => {
    const g = got[i] as unknown as Record<string, unknown>;
    expect(Object.keys(g).sort(), `${label}[${i}] keys`).toEqual(Object.keys(w).sort());
    for (const k of Object.keys(w)) expectClose(g[k], w[k], `${label}[${i}].${k}`);
  });
}

describe('aggregatePeriods matches the Python twin on the shared vectors', () => {
  for (const sym of Object.keys(V.stocks)) {
    const e = V.expected[sym]!;
    it(`${sym}: weeks, months, quarters`, () => {
      for (const tf of ['w', 'm', 'q'] as const) {
        expectRows(
          aggregatePeriods(V.stocks[sym]!, tf, V.tradingDays, V.config, { sym: 'X' }),
          e[tf] as Record<string, unknown>[],
          `${sym} ${tf}`,
        );
      }
    });
    it(`${sym}: custom 7-day bars`, () => {
      const got = aggregatePeriods(V.stocks[sym]!, { kind: 'n', n: 7 }, V.tradingDays, V.config, {
        sym: 'X',
      });
      expectRows(got, e.n7 as Record<string, unknown>[], `${sym} n7`);
    });
    it(`${sym}: aggregateRange`, () => {
      for (const r of e.ranges as { a: string; b: string; expected: Record<string, unknown> | null }[]) {
        const got = aggregateRange(V.stocks[sym]!, r.a, r.b, skipSet(V.config, 'X'));
        if (r.expected === null) expect(got).toBeNull();
        else expectRows([got!], [r.expected], `${sym} range ${r.a}..${r.b}`);
      }
    });
  }

  it('covers a split, partial periods and signals', () => {
    const w = aggregatePeriods(V.stocks.BBB!, 'w', V.tradingDays, V.config);
    expect(w.some((p) => p.adjusted === 1)).toBe(true);
    expect(w[w.length - 1]!.partial).toBe(true);
  });
});

describe('calendar', () => {
  it('uses ISO weeks, with a Sunday session inside its week', () => {
    expect(periodKey('2026-11-08', 'w')).toBe('2026-W45');
    expect(periodKey('2026-11-09', 'w')).toBe('2026-W46');
    expect(periodKey('2024-12-30', 'w')).toBe('2025-W01');
    expect(periodKey('2026-12-31', 'q')).toBe('2026-Q4');
    expect(periodKey('2026-04-01', 'm')).toBe('2026-04');
  });
  it('marks the in-progress and the truncated first period partial, holiday weeks complete', () => {
    const days = [
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
    ];
    const w = periodsFor(days, 'w');
    expect(w.map((p) => [p.key, p.partial, p.daysIn, p.daysExpected])).toEqual([
      ['2026-W44', true, 3, 5], // starts on a Wednesday
      ['2026-W45', false, 4, 4], // Friday 6 Nov is a holiday (between the first and the latest day)
      ['2026-W46', true, 3, 5], // in progress (3 of 5 days)
    ]);
  });
  it('builds N-day bars that end at the latest date', () => {
    const days = Array.from({ length: 23 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    const bars = periodsFor(days, { kind: 'n', n: 10 });
    expect(bars.map((b) => b.tradingDays)).toEqual([3, 10, 10]);
    expect(bars[0]!.partial).toBe(true);
    expect(bars[2]!.end).toBe('2026-09-23');
  });
});

describe('price adjustment', () => {
  it('finds a 1:2 split from the close-to-close ratio and leaves circuit-size moves alone', () => {
    expect(priceAdjustment([990, 1000, 1010, 510, 520, 530])).toEqual([0.5, 0.5, 0.5, 1, 1, 1]);
    expect(priceAdjustment([100, 80, 100, 90])).toEqual([1, 1, 1, 1]);
  });
});
