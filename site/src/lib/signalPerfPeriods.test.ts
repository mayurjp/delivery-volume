import { describe, expect, it } from 'vitest';
import type { SignalPerfPeriodRow } from '../types/data';
import { periodHistoryLine, periodSignalHistory } from './signalPerf';

const prow = (o: Partial<SignalPerfPeriodRow>): SignalPerfPeriodRow => ({
  tf: 'w',
  event: 'ACC',
  group: 'ALL',
  horizon: 20,
  events: 400,
  n: 350,
  periods: 100,
  medianExcess: 0.255,
  meanExcess: 1.4,
  hitRate: 51,
  ...o,
});

describe('period history lines', () => {
  it('names the horizons in weeks or months and hides cells with n below 30', () => {
    const rows = [prow({}), prow({ horizon: 60, n: 29 })];
    const line = periodHistoryLine(rows, 'w', 'ACC', 'ALL')!;
    expect(line).toContain('weekly signals');
    expect(line).toContain('4 weeks ahead, median vs peers +0.3%');
    expect(line).toContain('beat peers 51%');
    expect(line).toContain('12 weeks ahead, too few events');
    expect(line).not.toContain('n=29');
  });
  it('uses the monthly horizons and says too few events when everything is thin', () => {
    const line = periodHistoryLine([prow({ tf: 'm', horizon: 63, n: 5 })], 'm', 'ACC', 'ALL')!;
    expect(line).toContain('3 months ahead, too few events');
    expect(line).toContain('6 months ahead, too few events');
  });
  it('ignores the other timeframe and returns undefined while loading', () => {
    expect(periodHistoryLine([prow({ tf: 'm' })], 'w', 'ACC', 'ALL')).toContain('too few events');
    expect(periodHistoryLine(null, 'w', 'ACC', 'ALL')).toBeUndefined();
  });
  it('picks the stock cap bucket group and no line without a signal', () => {
    const rows = [prow({ group: 'L' })];
    expect(periodSignalHistory(rows, 'w', 'ACC', 'L')).toContain('Large caps');
    expect(periodSignalHistory(rows, 'w', null, 'L')).toBeUndefined();
  });
});
