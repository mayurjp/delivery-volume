import { describe, expect, it } from 'vitest';
import type { SignalPerfRow } from '../types/data';
import { historyLine, indexPerf, usable } from './signalPerf';

const row = (p: Partial<SignalPerfRow>): SignalPerfRow => ({
  event: 'DIS',
  group: 'L',
  entry: 't1',
  horizon: 20,
  events: 500,
  n: 414,
  days: 140,
  medianExcess: -1.04,
  meanExcess: 0.2,
  hitRate: 44.2,
  ...p,
});

describe('Historically line', () => {
  it('formats median and hit rate for the group and the default next-day entry', () => {
    const idx = indexPerf([row({})]);
    expect(historyLine(idx, 'DIS', 'L')).toBe(
      'Historically (Large caps, 1 yr, next-day close entry): 20-day median vs peers −1.0%, beat peers 44% of the time (n=414).',
    );
  });
  it('is hidden below 30 observations or when missing', () => {
    expect(historyLine(indexPerf([row({ n: 29 })]), 'DIS', 'L')).toBeUndefined();
    expect(historyLine(indexPerf([row({})]), 'ACC', 'L')).toBeUndefined();
    expect(historyLine(null, 'DIS', 'L')).toBeUndefined();
    expect(usable(row({ medianExcess: null }))).toBe(false);
  });
});
