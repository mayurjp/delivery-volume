import { describe, expect, it } from 'vitest';
import type { SignalPerfPeriodRow, SignalPerfRow } from '../types/data';
import { buildPeriodTable, historyLine, indexPerf, PERIOD_THIN_NOTE, usable } from './signalPerf';

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

describe('period signal table', () => {
  const prow = (p: Partial<SignalPerfPeriodRow>): SignalPerfPeriodRow => ({
    tf: 'w',
    event: 'ACC',
    group: 'L',
    horizon: 20,
    events: 100,
    n: 80,
    periods: 40,
    medianExcess: 0.5,
    meanExcess: 0.7,
    hitRate: 52,
    ...p,
  });
  const rows = [
    prow({}),
    prow({ group: 'M', n: 29 }), // too thin
    prow({ event: 'DIS', n: 30 }), // exactly at the floor
    prow({ horizon: 60, medianExcess: 9 }),
    prow({ tf: 'm', horizon: 63, medianExcess: 7 }),
  ];
  it('builds events x groups for one timeframe and horizon, hiding n below 30', () => {
    const t = buildPeriodTable(rows, 'w', 20, ['ACC', 'DIS', 'ABS'], ['L', 'M']);
    expect(t.map((r) => r.event)).toEqual(['ACC', 'DIS', 'ABS']);
    expect(t[0]!.cells[0]).toMatchObject({
      group: 'L',
      shown: true,
      medianExcess: 0.5,
      hitRate: 52,
      n: 80,
      periods: 40,
    });
    expect(t[0]!.cells[1]).toMatchObject({ group: 'M', shown: false, medianExcess: null, n: 29 });
    expect(t[1]!.cells[0]).toMatchObject({ shown: true, n: 30 });
    expect(t[2]!.cells.every((c) => !c.shown && c.n === 0)).toBe(true); // a missing cell is hidden too
  });
  it('keeps the horizons and timeframes apart', () => {
    expect(buildPeriodTable(rows, 'w', 60, ['ACC'], ['L'])[0]!.cells[0]!.medianExcess).toBe(9);
    expect(buildPeriodTable(rows, 'm', 63, ['ACC'], ['L'])[0]!.cells[0]!.medianExcess).toBe(7);
    expect(buildPeriodTable(rows, 'm', 20, ['ACC'], ['L'])[0]!.cells[0]!.shown).toBe(false);
  });
  it('hides a cell whose median or hit rate is missing', () => {
    expect(
      buildPeriodTable([prow({ medianExcess: null })], 'w', 20, ['ACC'], ['L'])[0]!.cells[0]!.shown,
    ).toBe(false);
  });
  it('honours another minN and says monthly cells are thin', () => {
    expect(buildPeriodTable(rows, 'w', 20, ['ACC'], ['M'], 25)[0]!.cells[0]!.shown).toBe(true);
    expect(PERIOD_THIN_NOTE).toContain('Monthly cells are often thin');
  });
});
