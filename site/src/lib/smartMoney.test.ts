import { describe, expect, it } from 'vitest';
import type { TrailPerfRow } from '../types/data';
import type { WindowView } from './trail';
import { tallyBucketId, tallyHistory, tallyLine } from './smartMoney';
import { HISTORICAL_LABEL, type TrailEntry } from './trailView';

function view(A: number, D: number, missing = 0): WindowView {
  const N = 8 - A - D - missing;
  return {
    codes: 'A'.repeat(A) + 'D'.repeat(D) + 'N'.repeat(N) + '-'.repeat(missing),
    delivBal: null,
    delivPctTrend: null,
    tradeSizeTrend: null,
    spikeDays: null,
    spikeUp: null,
    spikeDn: null,
    baseSpikeRate: null,
    upCr: null,
    dnCr: null,
    consA: null,
    consD: null,
    flip: null,
    flipSince: null,
    dealsFii: null,
    dealsDii: null,
    holdInstPp: null,
    holdPromoterPp: null,
    A,
    D,
    N,
    missing,
  };
}

const entry = (w6: WindowView | null): TrailEntry => ({
  sym: 'XYZ',
  strip: '',
  w: { '3M': null, '6M': w6, '1Y': null },
});

const perf = (id: string, n: number, dates: number, median = 1.5, hit = 54): TrailPerfRow => ({
  kind: 'tally',
  id,
  window: '6M',
  horizon: 60,
  n,
  dates,
  medianExcess: median,
  meanExcess: 2,
  hitRate: hit,
});

describe('tallyLine (07 section 6, the header tally)', () => {
  it('reads the 6-month counts of the trail row', () => {
    expect(tallyLine(entry(view(4, 1, 0)))).toBe(
      '6M: 4 of 8 footprints lean accumulation, 1 leans distribution.',
    );
  });

  it('uses the plural "lean" for two or more distribution footprints and names the uncovered ones', () => {
    expect(tallyLine(entry(view(2, 2, 2)))).toBe(
      '6M: 2 of 8 footprints lean accumulation, 2 lean distribution, 2 not covered.',
    );
  });

  it('says so when the stock is not in the trail or the window has no history', () => {
    expect(tallyLine(undefined)).toMatch(/^Not in the trail/);
    expect(tallyLine(entry(null))).toBe('6M: not enough history yet for the trail.');
  });
});

describe('tally bucket', () => {
  it('four or more on one side, else mixed', () => {
    expect(tallyBucketId(view(4, 0))).toBe('tallyA4');
    expect(tallyBucketId(view(1, 5))).toBe('tallyD4');
    expect(tallyBucketId(view(3, 3))).toBe('tallyMixed');
  });
});

describe('"Historically" line of the tally bucket (kind tally)', () => {
  it('shows the numbers when n and dates are enough', () => {
    const rows = [perf('tallyA4', 441, 18, 1.5, 54), perf('tallyA4', 358, 15, 2.3, 53.9)];
    const rows2 = rows.map((r) => ({ ...r, horizon: r.n === 441 ? 60 : 120 }));
    const line = tallyHistory(entry(view(5, 0)), rows2, '6M');
    expect(line).toContain('60 days +1.5% median excess, 54% hit rate (n 441)');
    expect(line).toContain('120 days +2.3% median excess');
    expect(line).toContain(HISTORICAL_LABEL);
  });

  it('says "too few dates" below 6 month-ends, not a number', () => {
    const rows = [perf('tallyA4', 441, 3, 1.5, 54)].map((r) => ({ ...r, horizon: 60 }));
    const line = tallyHistory(entry(view(5, 0)), rows, '6M') ?? '';
    expect(line).toContain('60 days: too few dates (3 month-ends)');
    expect(line).not.toContain('median excess');
  });

  it('says "too few cases" when n is under the minimum', () => {
    const rows = [perf('tallyD4', 12, 18)].map((r) => ({ ...r, horizon: 60 }));
    expect(tallyHistory(entry(view(0, 5)), rows, '6M')).toContain('too few cases (n 12)');
  });

  it('is absent without a 6-month row, and says loading before the track record arrives', () => {
    expect(tallyHistory(entry(null), [], '6M')).toBeNull();
    expect(tallyHistory(entry(view(4, 0)), null, '6M')).toContain('Historically: loading.');
  });
});
