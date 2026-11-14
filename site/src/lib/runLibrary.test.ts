import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Bucket, RunLibRow, RunsLibraryDoc, UniverseRow } from '../types/data';
import { rowsToObjects } from './dataClient';
import { csvText } from './csv';
import {
  DEFAULT_MIN_MOVE,
  LIB_CSV_HEADERS,
  filterLibrary,
  libCsvRows,
  parseLibQuery,
  writeLibQuery,
  type LibContext,
  type LibQuery,
} from './runLibrary';

const fx = (name: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/runs', name), 'utf8'));
const rows = rowsToObjects<RunLibRow>(fx('library.json') as RunsLibraryDoc);
const universe = rowsToObjects<UniverseRow>(fx('universe.json'));
const INDICES = [
  'NIFTY50',
  'NIFTYNEXT50',
  'NIFTY100',
  'NIFTY200',
  'NIFTY500',
  'MIDCAP150',
  'SMALLCAP250',
  'MICROCAP250',
  'TOTALMARKET',
  'FNO',
];
const ctx: LibContext = {
  indices: INDICES,
  universe: new Map(universe.map((u) => [u.sym, u])),
  watchlist: new Set(['RELIANCE', 'NATIONALUM']),
};
const ALL: LibQuery = {
  dir: 'ALL',
  minMove: DEFAULT_MIN_MOVE,
  u: 'ALL',
  b: [],
  sec: [],
  from: null,
  to: null,
};

describe('run library fixture', () => {
  it('is a trimmed copy of runs/library.json with its 17 columns', () => {
    expect(rows.length).toBeGreaterThan(300);
    expect(new Set(rows.map((r) => r.sym)).size).toBeGreaterThan(50);
    for (const r of rows) {
      expect(['UP', 'DOWN']).toContain(r.dir);
      expect(Math.abs(r.movePct)).toBeGreaterThanOrEqual(20);
    }
  });
});

describe('filterLibrary', () => {
  it('the default query keeps every run, newest start first', () => {
    const out = filterLibrary(rows, ALL, ctx);
    expect(out.length).toBe(rows.length);
    for (let i = 1; i < out.length; i++) expect(out[i - 1]!.start >= out[i]!.start).toBe(true);
  });

  it('direction keeps one side only', () => {
    const up = filterLibrary(rows, { ...ALL, dir: 'UP' }, ctx);
    expect(up.length).toBe(rows.filter((r) => r.dir === 'UP').length);
    expect(up.every((r) => r.dir === 'UP')).toBe(true);
  });

  it('minimum move compares the absolute move', () => {
    const q = { ...ALL, minMove: 40 };
    const out = filterLibrary(rows, q, ctx);
    expect(out.length).toBe(rows.filter((r) => Math.abs(r.movePct) >= 40).length);
    expect(out.every((r) => Math.abs(r.movePct) >= 40)).toBe(true);
  });

  it('universe keeps the stocks in the index (bit mask), and the watchlist keeps its own', () => {
    const bit = 2 ** INDICES.indexOf('NIFTY50');
    const expected = rows.filter((r) => {
      const u = ctx.universe.get(r.sym);
      return u !== undefined && (u.idx & bit) !== 0;
    });
    const out = filterLibrary(rows, { ...ALL, u: 'NIFTY50' }, ctx);
    expect(out.length).toBe(expected.length);
    const w = filterLibrary(rows, { ...ALL, u: 'WATCHLIST' }, ctx);
    expect(w.every((r) => ctx.watchlist.has(r.sym))).toBe(true);
  });

  it('cap bucket and sector filter on the row values', () => {
    const b = filterLibrary(rows, { ...ALL, b: ['L' as Bucket] }, ctx);
    expect(b.every((r) => r.bucket === 'L')).toBe(true);
    expect(b.length).toBe(rows.filter((r) => r.bucket === 'L').length);
    const sector = rows.find((r) => r.sector)!.sector!;
    const s = filterLibrary(rows, { ...ALL, sec: [sector] }, ctx);
    expect(s.every((r) => (r.sector ?? 'Unclassified') === sector)).toBe(true);
  });

  it('the start-date range is inclusive at both ends', () => {
    const dates = rows.map((r) => r.start).sort();
    const from = dates[Math.floor(dates.length / 3)]!;
    const to = dates[Math.floor((2 * dates.length) / 3)]!;
    const out = filterLibrary(rows, { ...ALL, from, to }, ctx);
    expect(out.every((r) => r.start >= from && r.start <= to)).toBe(true);
    expect(out.length).toBe(rows.filter((r) => r.start >= from && r.start <= to).length);
  });
});

describe('URL query', () => {
  it('round-trips through the URL and keeps the other params', () => {
    const q: LibQuery = {
      dir: 'DOWN',
      minMove: 30,
      u: 'NIFTY200',
      b: ['M', 'S'],
      sec: ['Power'],
      from: '2025-01-01',
      to: '2026-01-31',
    };
    const p = writeLibQuery(new URLSearchParams('d=2026-11-13&tf=w'), q);
    expect(parseLibQuery(p, 1, INDICES)).toEqual(q);
    expect(p.get('d')).toBe('2026-11-13');
    expect(p.get('tf')).toBe('w');
  });

  it('defaults are not written, and bad values fall back to the defaults', () => {
    const p = writeLibQuery(new URLSearchParams(), ALL);
    expect(p.toString()).toBe('');
    const bad = parseLibQuery(new URLSearchParams('dir=SIDEWAYS&mm=33&from=yesterday&u=NOPE'), 1, INDICES);
    expect(bad).toEqual(ALL);
  });
});

describe('CSV of the library', () => {
  it('has one cell per header and one line per run, raw numbers', () => {
    const sub = filterLibrary(rows, { ...ALL, dir: 'UP' }, ctx).slice(0, 5);
    const cells = libCsvRows(sub);
    expect(cells.every((r) => r.length === LIB_CSV_HEADERS.length)).toBe(true);
    const text = csvText(LIB_CSV_HEADERS, cells);
    expect(text.split('\r\n').length).toBe(sub.length + 2);
    expect(text).not.toContain('₹');
  });
});
