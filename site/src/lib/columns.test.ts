import { describe, expect, it } from 'vitest';
import { COLUMN_BY_KEY, COLS_KEY, DEFAULT_COLUMNS, OLD_COLS_KEY, migrateColumns } from './columns';
import { FLAG_INFO } from './signals';

describe('default Screener columns', () => {
  it('shows Prev close, Close, Change (₹), Change (%) side by side, in that order', () => {
    const i = DEFAULT_COLUMNS.indexOf('prevClose');
    expect(DEFAULT_COLUMNS.slice(i, i + 4)).toEqual(['prevClose', 'close', 'chg', 'ret1']);
    expect(['prevClose', 'close', 'chg', 'ret1'].map((k) => COLUMN_BY_KEY.get(k)!.label)).toEqual([
      'Prev close',
      'Close',
      'Change (₹)',
      'Change (%)',
    ]);
  });
  it('the column chooser offers prevClose and the rupee change', () => {
    expect(COLUMN_BY_KEY.has('prevClose')).toBe(true);
    expect(COLUMN_BY_KEY.has('chg')).toBe(true);
  });
  it('versions the saved-columns key', () => {
    expect(COLS_KEY).not.toBe(OLD_COLS_KEY);
  });
});

describe('migrateColumns', () => {
  it('merges the price block after the symbol and keeps the other saved columns in order', () => {
    expect(migrateColumns(['sym', 'close', 'delivPct', 'ret1', 'spike'])).toEqual([
      'sym',
      'prevClose',
      'close',
      'chg',
      'ret1',
      'delivPct',
      'spike',
    ]);
  });
  it('is idempotent', () => {
    const once = migrateColumns(['sym', 'spike']);
    expect(migrateColumns(once)).toEqual(once);
  });
});

describe('plain flag badges', () => {
  it('uses plain words, not codes', () => {
    expect(FLAG_INFO.map((f) => f.short)).toEqual([
      'T2T',
      'Corp action',
      'Bulk deal',
      'Block deal',
      'Circuit',
      'F&O ban',
      '52W high',
      '52W low',
      'Low liquidity',
      'New listing',
      'Expiry week',
    ]);
    for (const f of FLAG_INFO) expect(f.hint.length).toBeGreaterThan(10);
  });
});
