import { describe, expect, it } from 'vitest';
import { csvEscape, csvFileName, csvText } from './csv';

describe('csvEscape', () => {
  it('leaves plain values alone and writes null/undefined as empty', () => {
    expect(csvEscape('RELIANCE')).toBe('RELIANCE');
    expect(csvEscape(12.5)).toBe('12.5');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape(Number.NaN)).toBe('');
  });

  it('quotes commas, quotes and line breaks, and doubles embedded quotes', () => {
    expect(csvEscape('Bank, Private')).toBe('"Bank, Private"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
    expect(csvEscape('a\r\nb')).toBe('"a\r\nb"');
  });

  it('keeps raw numbers without grouping separators', () => {
    expect(csvEscape(1234567.25)).toBe('1234567.25');
  });
});

describe('csvText', () => {
  it('writes the header and rows with CRLF line endings and a trailing newline', () => {
    const text = csvText(
      ['Symbol', 'Sector'],
      [
        ['HDFCBANK', 'Financial Services, Banks'],
        ['TCS', null],
      ],
    );
    expect(text).toBe('Symbol,Sector\r\nHDFCBANK,"Financial Services, Banks"\r\nTCS,\r\n');
  });

  it('round-trips a field with quotes and a newline', () => {
    const text = csvText(['Note'], [['line one\n"quoted", value']]);
    expect(text).toBe('Note\r\n"line one\n""quoted"", value"\r\n');
  });
});

describe('csvFileName', () => {
  it('builds view-date.csv', () => {
    expect(csvFileName('screener', '2026-11-13')).toBe('screener-2026-11-13.csv');
    expect(csvFileName('Stock Trail', '2026-11-13')).toBe('stock-trail-2026-11-13.csv');
  });

  it('drops characters that are unsafe in a file name', () => {
    expect(csvFileName('../screener', '2026/11/13')).toBe('screener-20261113.csv');
    expect(csvFileName('', '')).toBe('table.csv');
  });
});
