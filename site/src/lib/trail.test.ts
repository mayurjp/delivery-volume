import { describe, expect, it } from 'vitest';
import vectors from './trailVectors.json';
import {
  foByDate,
  holdSeries,
  trailForRows,
  windowView,
  type HoldingsInput,
  type TrailCfg,
  type TrailInput,
  type TrailResult,
} from './trail';
import type { DealsByDate, FoByDate } from './trail';

const V = vectors as unknown as {
  cfg: TrailCfg;
  tradingDays: string[];
  asOfIndex: number;
  stocks: Record<string, TrailInput[]>;
  deals: Record<string, Record<string, [number, number]>>;
  holdings: Record<string, HoldingsInput>;
  fo: Record<string, FoByDate>;
  expected: Record<string, { latest: TrailResult; asOf: TrailResult }>;
};

function sameCell(got: unknown, want: unknown, label: string) {
  if (typeof want === 'number' && typeof got === 'number') expect(got, label).toBeCloseTo(want, 1);
  else expect(got, label).toEqual(want);
}

function expectSame(got: TrailResult, want: TrailResult, label: string) {
  expect(got.asOf).toBe(want.asOf);
  expect(got.eligible, `${label} eligible`).toBe(want.eligible);
  expect(got.strip, `${label} strip`).toBe(want.strip);
  expect(got.stripWeeks).toEqual(want.stripWeeks);
  for (const w of ['3M', '6M', '1Y'] as const) {
    const g = got.windows[w];
    const e = want.windows[w];
    if (e === null) {
      expect(g, `${label} ${w}`).toBeNull();
      continue;
    }
    expect(g, `${label} ${w}`).not.toBeNull();
    e.forEach((cell, i) => sameCell(g![i], cell, `${label} ${w}[${i}]`));
  }
  expect(got.timeline.length).toBe(want.timeline.length);
  for (const w of ['3M', '6M', '1Y'] as const) {
    const g = got.windows[w];
    const e = want.windows[w];
    if (g && e) {
      sameCell(g[16], e[16], `${label} ${w} holdInstPp`);
      sameCell(g[17], e[17], `${label} ${w} holdPromoterPp`);
    }
  }
  want.timeline.forEach((t, i) => {
    const g = got.timeline[i]!;
    expect(g.end).toBe(t.end);
    expect(g.key).toBe(t.key);
    expect(g.codes, `${label} week ${t.end}`).toBe(t.codes);
    expect(g.overall).toBe(t.overall);
    sameCell(g.delivBal, t.delivBal, `${label} ${t.end} bal`);
    sameCell(g.delivPctTrend, t.delivPctTrend, `${label} ${t.end} dp`);
    sameCell(g.tradeSizeTrend, t.tradeSizeTrend, `${label} ${t.end} ts`);
    expect(g.spikeDays).toBe(t.spikeDays);
  });
}

/** The vector deals of one stock, as the browser reads them from dealFlows (FII and DII net, Rs Cr). */
const dealsOf = (sym: string): DealsByDate =>
  Object.fromEntries(Object.entries(V.deals[sym] ?? {}).map(([d, [fii, dii]]) => [d, { fii, dii }]));
/** The vector F&O days of one stock (the symbol file's fo block, read as the browser reads it). */
const foOf = (sym: string): FoByDate => (V.fo as Record<string, FoByDate>)[sym] ?? {};

describe('trailForRows matches the Python twin on the shared vectors', () => {
  for (const sym of Object.keys(V.stocks)) {
    it(`${sym}: latest and an earlier as-of date`, () => {
      expectSame(
        trailForRows(
          V.stocks[sym]!,
          V.tradingDays,
          V.cfg,
          undefined,
          dealsOf(sym),
          V.holdings[sym],
          foOf(sym),
        ),
        V.expected[sym]!.latest,
        `${sym} latest`,
      );
      expectSame(
        trailForRows(
          V.stocks[sym]!,
          V.tradingDays,
          V.cfg,
          V.asOfIndex,
          dealsOf(sym),
          V.holdings[sym],
          foOf(sym),
        ),
        V.expected[sym]!.asOf,
        `${sym} as-of`,
      );
    });
  }

  it('covers accumulation, distribution, a flip and a short history', () => {
    const e = V.expected;
    expect(windowView(e.AAA!.latest.windows['6M']!).codes[0]).toBe('A');
    expect(windowView(e.BBB!.latest.windows['3M']!).flip).toBe('A→D');
    expect(windowView(e.CCC!.latest.windows['3M']!).codes[3]).toBe('D');
    expect(windowView(e.AAA!.latest.windows['3M']!).codes[4]).toBe('A'); // named deals: DII bought 63 Cr
    expect(windowView(e.BBB!.latest.windows['3M']!).codes[4]).toBe('D'); // FII sold 25 Cr
    expect(windowView(e.AAA!.asOf.windows['1Y']!).codes[4]).toBe('-'); // the as-of 1Y window starts before the history
    expect(windowView(e.AAA!.latest.windows['3M']!).dealsDii).toBeCloseTo(63, 1);
    expect(windowView(e.DDD!.latest.windows['1Y']!).missing).toBe(6); // two trend codes, spike, two holdings codes and F&O
  });

  it('codes the holdings indicators: latest A for FII + DII (+2 pp), D for promoter selling, missing before the base', () => {
    const latest6M = windowView(V.expected.AAA!.latest.windows['6M']!);
    expect(latest6M.codes[5]).toBe('A');
    expect(latest6M.holdInstPp).toBeCloseTo(2, 6);
    // no lookahead: the June filing is broadcast after the as-of day, so the as-of code is missing
    expect(windowView(V.expected.AAA!.asOf.windows['6M']!).codes[5]).toBe('-');
    expect(windowView(V.expected.BBB!.latest.windows['6M']!).codes[6]).toBe('D');
    expect(windowView(V.expected.BBB!.latest.windows['6M']!).holdPromoterPp).toBeCloseTo(-2, 6);
    expect(windowView(V.expected.CCC!.latest.windows['6M']!).codes.slice(5)).toBe('--D');
  });

  it('codes foTrend (the 8th code): long build-up leans A, short build-up leans D, no F&O block is missing', () => {
    expect(windowView(V.expected.AAA!.latest.windows['6M']!).codes[7]).toBe('A');
    expect(windowView(V.expected.BBB!.latest.windows['3M']!).codes[7]).toBe('N');
    expect(windowView(V.expected.CCC!.latest.windows['3M']!).codes[7]).toBe('D');
    expect(windowView(V.expected.DDD!.latest.windows['1Y']!).codes[7]).toBe('-');
    expect(V.expected.AAA!.latest.windows['6M']![0]!.length).toBe(8);
  });

  it('reads the F&O block of a symbol file as the trail input', () => {
    const block = {
      columns: ['date', 'futOi', 'futOiChgPct', 'buildup', 'pcr'],
      rows: [
        ['2026-01-02', 100, 1.5, 'LB', 0.9],
        ['2026-01-05', 90, null, null, null],
      ],
    };
    expect(foByDate(block)).toEqual({
      '2026-01-02': { buildup: 'LB', futOiChgPct: 1.5 },
      '2026-01-05': { buildup: null, futOiChgPct: null },
    });
    expect(foByDate(undefined)).toEqual({});
  });

  it('holds no holdings change before the base quarter is filed and on the broadcast day only', () => {
    const q = V.holdings.AAA!.quarters;
    const days = ['2025-07-18', '2025-07-21'];
    const s = holdSeries(V.holdings.AAA!, days, V.cfg);
    expect(s.codes[0]![0]).toBe(9); // the June filing is not yet broadcast (filedOn 2025-07-20 comes after)
    expect(s.codes[1]![0]).toBe(1);
    expect(q.length).toBe(4);
  });

  it('ignores rows after the as-of date (no lookahead)', () => {
    const cut = V.tradingDays[V.asOfIndex]!;
    const days = V.tradingDays.filter((d) => d <= cut);
    const rows = V.stocks.AAA!.filter((r) => r.date <= cut);
    expectSame(
      trailForRows(rows, days, V.cfg, undefined, dealsOf('AAA'), undefined, foOf('AAA')),
      V.expected.AAA!.asOf,
      'AAA truncated',
    );
  });
});
