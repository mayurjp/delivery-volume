import { describe, expect, it } from 'vitest';
import type { PeriodRow } from './aggregate';
import { daysIn, footprintRows, priorWindow } from './footprint';

const DAYS = [
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-09',
  '2026-11-10',
  '2026-11-11',
];

describe('prior window', () => {
  it('is the same number of market days before the first day of the range', () => {
    expect(daysIn(DAYS, '2026-11-05', '2026-11-09')).toEqual(['2026-11-05', '2026-11-06', '2026-11-09']);
    expect(priorWindow(DAYS, '2026-11-05', '2026-11-09')).toEqual({
      a: '2026-11-02',
      b: '2026-11-04',
      days: 3,
    });
  });
  it('is null when history is too short or the range holds no trading day', () => {
    expect(priorWindow(DAYS, '2026-11-03', '2026-11-09')).toBeNull();
    expect(priorWindow(DAYS, '2026-12-01', '2026-12-05')).toBeNull();
  });
  it('treats a weekend start as the next trading day', () => {
    expect(priorWindow(DAYS, '2026-11-07', '2026-11-10')).toEqual({
      a: '2026-11-05',
      b: '2026-11-06',
      days: 2,
    });
  });
});

const pr = (o: Partial<PeriodRow>): PeriodRow =>
  ({
    days: 10,
    ret: 5,
    high: 120,
    low: 90,
    close: 110,
    clv: 0.5,
    delivPct: 55,
    delivValCr: 12,
    turnoverCr: 20,
    avgTradeSize: 20000,
    delivBalance: 1.5,
    adjusted: 0,
    ...o,
  }) as PeriodRow;

describe('footprint rows', () => {
  const rows = footprintRows(
    pr({ adjusted: 1 }),
    pr({ ret: 2, delivPct: 50, delivValCr: 10, turnoverCr: 25, delivBalance: 1, days: 9 }),
  );
  const by = new Map(rows.map((r) => [r.key, r]));
  it('lists the fields of the card', () => {
    expect(rows.map((r) => r.key)).toEqual([
      'days',
      'ret',
      'high',
      'low',
      'close',
      'clv',
      'delivPct',
      'delivVal',
      'turnover',
      'ats',
      'balance',
    ]);
  });
  it('shows signed changes against the window before', () => {
    expect(by.get('ret')!.change).toBe('+3.0 pp');
    expect(by.get('delivPct')!.change).toBe('+5.0 pp');
    expect(by.get('delivVal')!.change).toBe('+20%');
    expect(by.get('turnover')!.change).toBe('−20%');
    expect(by.get('balance')!.change).toBe('+0.5');
    expect(by.get('days')!.change).toBe('+1');
  });
  it('marks a split-adjusted range', () => {
    expect(by.get('ret')!.warn).toBe(true);
    expect(footprintRows(pr({}), null).find((r) => r.key === 'ret')!.warn).toBe(false);
  });
  it('shows dashes for the comparison without an earlier window', () => {
    for (const r of footprintRows(pr({}), null)) {
      expect(r.prev).toBe('—');
      expect(r.change).toBe('—');
    }
  });
});
