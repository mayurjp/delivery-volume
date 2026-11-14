import { describe, expect, it } from 'vitest';
import vectors from './trailVectors.json';
import { trailForRows, windowView, type TrailCfg, type TrailInput, type TrailResult } from './trail';

const V = vectors as unknown as {
  cfg: TrailCfg;
  tradingDays: string[];
  asOfIndex: number;
  stocks: Record<string, TrailInput[]>;
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

describe('trailForRows matches the Python twin on the shared vectors', () => {
  for (const sym of Object.keys(V.stocks)) {
    it(`${sym}: latest and an earlier as-of date`, () => {
      expectSame(
        trailForRows(V.stocks[sym]!, V.tradingDays, V.cfg),
        V.expected[sym]!.latest,
        `${sym} latest`,
      );
      expectSame(
        trailForRows(V.stocks[sym]!, V.tradingDays, V.cfg, V.asOfIndex),
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
    expect(windowView(e.DDD!.latest.windows['1Y']!).missing).toBe(3);
  });

  it('ignores rows after the as-of date (no lookahead)', () => {
    const cut = V.tradingDays[V.asOfIndex]!;
    const days = V.tradingDays.filter((d) => d <= cut);
    const rows = V.stocks.AAA!.filter((r) => r.date <= cut);
    expectSame(trailForRows(rows, days, V.cfg), V.expected.AAA!.asOf, 'AAA truncated');
  });
});
