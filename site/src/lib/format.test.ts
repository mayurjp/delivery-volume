import { describe, expect, it } from 'vitest';
import { fmtCr, fmtDate, fmtInt, fmtPct, fmtPctChg, fmtPp, fmtPrice, fmtQty, fmtRatio } from './format';

describe('formatters', () => {
  it('groups rupees the Indian way', () => {
    expect(fmtCr(1234567.891)).toBe('12,34,567.89 Cr');
    expect(fmtCr(0.5)).toBe('0.5 Cr');
    expect(fmtInt(1234567)).toBe('12,34,567');
    expect(fmtPrice(1450.2)).toBe('1,450.20');
  });
  it('signs changes with a true minus and never shows signed zero', () => {
    expect(fmtPctChg(4.23)).toBe('+4.2%');
    expect(fmtPctChg(-1.26, 2)).toBe('−1.26%');
    expect(fmtPctChg(0.04)).toBe('0.0%');
    expect(fmtPp(4.2)).toBe('+4.2 pp');
    expect(fmtPp(-0.8)).toBe('−0.8 pp');
  });
  it('formats levels and ratios', () => {
    expect(fmtPct(56.32)).toBe('56.3%');
    expect(fmtRatio(2.43)).toBe('2.4×');
  });
  it('compacts quantities in lakh and crore', () => {
    expect(fmtQty(1234567)).toBe('12.35 L');
    expect(fmtQty(12345678)).toBe('1.23 Cr');
    expect(fmtQty(99999)).toBe('99,999');
  });
  it('formats dates from ISO strings without time zones', () => {
    expect(fmtDate('2026-11-13')).toBe('13 Nov 2026');
    expect(fmtDate('2025-01-05')).toBe('5 Jan 2025');
    expect(fmtDate(null)).toBe('—');
  });
  it('shows an em dash for missing values', () => {
    for (const f of [fmtCr, fmtPct, fmtPctChg, fmtPp, fmtRatio, fmtQty, fmtPrice]) expect(f(null)).toBe('—');
  });
});
