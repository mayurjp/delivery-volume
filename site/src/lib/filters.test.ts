import { describe, expect, it } from 'vitest';
import { FLAG, type DailyRow, type UniverseRow } from '../types/data';
import { activeFilterCount, applyFilters, defaultFilters, universeBit, type Filters } from './filters';
import { hasFilterParams, parseFilters, writeFilters } from './urlState';

const INDICES = ['NIFTY50', 'NIFTYNEXT50', 'NIFTY100'];
const ctx = { indices: INDICES, watchlist: new Set(['CCC']) };

function uni(sym: string, p: Partial<UniverseRow> = {}): UniverseRow {
  return {
    sym,
    f: sym,
    name: sym,
    isin: null,
    sector: 'IT',
    idx: 0,
    mcapCr: 1000,
    mcapRank: 1,
    bucket: 'L',
    listedOn: null,
    aliases: [],
    mcapEstimated: false,
    ...p,
  };
}
function row(sym: string, p: Partial<DailyRow> = {}): DailyRow {
  return { sym, series: 'EQ', close: 100, turnoverAvg20Cr: 10, flags: 0, ...p } as DailyRow;
}

const universe = new Map([
  ['AAA', uni('AAA', { idx: 1 | 4, bucket: 'L', sector: 'IT', mcapCr: 90000 })],
  ['BBB', uni('BBB', { idx: 2 | 4, bucket: 'M', sector: 'Financial Services', mcapCr: 20000 })],
  ['CCC', uni('CCC', { idx: 0, bucket: 'S', sector: 'Unclassified', mcapCr: 800 })],
  ['DDD', uni('DDD', { idx: 0, bucket: null, mcapCr: null })],
]);
const rows = ['AAA', 'BBB', 'CCC', 'DDD'].map((s) => row(s));
const def = defaultFilters(1);
const run = (f: Partial<Filters>, r = rows) =>
  applyFilters(r, universe, { ...def, ...f }, ctx).map((x) => x.sym);

describe('applyFilters', () => {
  it('defaults keep everything in the universe', () => {
    expect(run({})).toEqual(['AAA', 'BBB', 'CCC', 'DDD']);
  });
  it('drops symbols missing from the universe', () => {
    expect(run({}, [...rows, row('ZZZ')])).not.toContain('ZZZ');
  });
  it('Universe = Nifty 50 shows only members', () => {
    expect(run({ u: 'NIFTY50' })).toEqual(['AAA']);
    expect(run({ u: 'NIFTYNEXT50' })).toEqual(['BBB']);
    expect(run({ u: 'NIFTY100' })).toEqual(['AAA', 'BBB']);
  });
  it('Watchlist universe uses the watchlist set', () => {
    expect(run({ u: 'WATCHLIST' })).toEqual(['CCC']);
  });
  it('filters by cap bucket (multi-select) and custom bounds', () => {
    expect(run({ b: ['L', 'M'] })).toEqual(['AAA', 'BBB']);
    expect(run({ capMin: 1000, capMax: 50000 })).toEqual(['BBB']);
    expect(run({ capMin: 1 })).not.toContain('DDD'); // unknown market cap cannot satisfy a bound
  });
  it('filters by sector including Unclassified', () => {
    expect(run({ sec: ['Unclassified'] })).toEqual(['CCC']);
    expect(run({ sec: ['IT', 'Financial Services'] })).toEqual(['AAA', 'BBB', 'DDD']);
  });
  it('applies the turnover floor but lets unknown turnover through', () => {
    const r = [
      row('AAA', { turnoverAvg20Cr: 0.4 }),
      row('BBB', { turnoverAvg20Cr: null }),
      row('CCC', { turnoverAvg20Cr: 5 }),
    ];
    expect(run({ minTurn: 1 }, r)).toEqual(['BBB', 'CCC']);
    expect(run({ minTurn: 0 }, r)).toEqual(['AAA', 'BBB', 'CCC']);
  });
  it('applies minimum price', () => {
    const r = [row('AAA', { close: 49 }), row('BBB', { close: 50 }), row('CCC', { close: null })];
    expect(run({ minPrice: 50 }, r)).toEqual(['BBB']);
  });
  it('hides event rows only when asked', () => {
    const r = [
      row('AAA', { flags: FLAG.corpAction }),
      row('BBB', { flags: FLAG.bandHit }),
      row('CCC', { flags: FLAG.high52 }),
    ];
    expect(run({}, r)).toHaveLength(3);
    expect(run({ hideEvents: true }, r)).toEqual(['CCC']);
  });
  it('is pure: does not mutate its inputs', () => {
    const copy = JSON.stringify(rows);
    run({ u: 'NIFTY50', b: ['L'] });
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe('helpers and URL state', () => {
  it('universeBit maps index keys to bit masks', () => {
    expect(universeBit('NIFTY50', INDICES)).toBe(1);
    expect(universeBit('NIFTY100', INDICES)).toBe(4);
    expect(universeBit('ALL', INDICES)).toBeNull();
  });
  it('counts active filters', () => {
    expect(activeFilterCount(def, def)).toBe(0);
    expect(activeFilterCount({ ...def, u: 'NIFTY50', b: ['L'], hideEvents: true }, def)).toBe(3);
  });
  it('round-trips filters through the query string and omits defaults', () => {
    const f: Filters = {
      ...def,
      u: 'NIFTY100',
      b: ['L', 'M'],
      sec: ['Financial Services'],
      minTurn: 5,
      hideEvents: true,
    };
    const p = writeFilters(new URLSearchParams(), f, 1);
    expect(p.toString()).toBe('u=NIFTY100&b=L%2CM&sec=Financial+Services&mt=5&he=1');
    expect(parseFilters(p, 1, INDICES)).toEqual(f);
    expect(writeFilters(new URLSearchParams('d=2026-11-13'), def, 1).toString()).toBe('d=2026-11-13');
    expect(hasFilterParams(new URLSearchParams('d=2026-11-13'))).toBe(false);
  });
  it('ignores garbage parameters', () => {
    const f = parseFilters(new URLSearchParams('u=NOPE&b=X,L&mt=abc&cmin=-3'), 1, INDICES);
    expect(f).toEqual({ ...def, b: ['L'] });
  });
});
