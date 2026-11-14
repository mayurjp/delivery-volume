import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CumRow, Meta, SplitBonusRow, UniverseRow } from '../types/data';
import { DataClient, rowsToObjects } from './dataClient';
import {
  buildRangeRows,
  corpActionSyms,
  DEFAULT_RANGE,
  fetchRangeCums,
  parseRange,
  rangeSignal,
  resolveRange,
  writeRange,
} from './range';

const DAYS = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  return d.toISOString().slice(0, 10);
});

describe('resolveRange', () => {
  it('resolves presets on trading days with an equal previous period as the baseline', () => {
    const r = resolveRange({ ...DEFAULT_RANGE, preset: '1W' }, DAYS[30]!, DAYS);
    expect(r.range).toMatchObject({ a: DAYS[26], b: DAYS[30], days: 5, prevA: DAYS[25] });
    expect(r.baseline).toMatchObject({ a: DAYS[21], b: DAYS[25], days: 5, prevA: DAYS[20] });
    expect(r.text).toContain('(5 days) vs baseline');
  });

  it('supports prior-20/50 and custom baselines, MTD, YTD and custom ranges', () => {
    const r20 = resolveRange({ ...DEFAULT_RANGE, preset: '1W', baseline: '20' }, DAYS[40]!, DAYS);
    expect(r20.baseline!.days).toBe(20);
    expect(r20.baseline!.b).toBe(r20.range.prevA);
    const mtd = resolveRange({ ...DEFAULT_RANGE, preset: 'MTD' }, DAYS[45]!, DAYS); // 2026-02-15
    expect(mtd.range.a).toBe('2026-02-01');
    const ytd = resolveRange({ ...DEFAULT_RANGE, preset: 'YTD' }, DAYS[45]!, DAYS);
    expect(ytd.range.a).toBe(DAYS[0]);
    expect(ytd.baseline).toBeNull(); // nothing before the first stored day
    const c = resolveRange(
      { preset: 'C', a: DAYS[10]!, b: DAYS[14]!, baseline: 'c', ba: DAYS[2]!, bb: DAYS[6]! },
      DAYS[50]!,
      DAYS,
    );
    expect(c.range.days).toBe(5);
    expect(c.baseline).toMatchObject({ a: DAYS[2], b: DAYS[6], prevA: DAYS[1] });
  });

  it('round-trips through URL params, writing only non-defaults', () => {
    expect(writeRange(new URLSearchParams(), DEFAULT_RANGE).toString()).toBe('');
    const p = writeRange(new URLSearchParams(), { ...DEFAULT_RANGE, preset: '3M', baseline: '50' });
    expect(p.toString()).toBe('r=3M&bl=50');
    expect(parseRange(p)).toMatchObject({ preset: '3M', baseline: '50' });
  });
});

describe('a range comparison fetches at most 4 cum files', () => {
  const META = { generatedAt: 'g', latestDate: DAYS[59] };
  it('requests cum/prev(a), cum/b, cum/prev(a2), cum/b2 and nothing else', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      const path = url.split('?')[0]!.replace('/data/', '');
      const body = path === 'meta.json' ? META : { schemaVersion: 1, columns: ['sym'], rows: [] };
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    const client = new DataClient({ baseUrl: '/data/', fetchFn });
    const r = resolveRange({ ...DEFAULT_RANGE, preset: '2W' }, DAYS[40]!, DAYS);
    await fetchRangeCums(client, r);
    await fetchRangeCums(client, r); // a repeat is served from memory
    const cums = calls.filter((u) => u.includes('/cum/'));
    // at most 4; the baseline normally ends on prev(a), so the same file serves two of the four roles
    expect(cums.length).toBeLessThanOrEqual(4);
    expect(new Set(cums.map((u) => u.split('/cum/')[1]!.split('.')[0]))).toEqual(
      new Set([r.range.prevA, r.range.b, r.baseline!.prevA, r.baseline!.b]),
    );
    expect(calls.filter((u) => !u.includes('/cum/') && !u.includes('meta.json'))).toHaveLength(0);
  });
});

describe('range signal thresholds (04 section 4.2)', () => {
  const row = (p: Record<string, number | boolean | null>) =>
    ({ excluded: false, ret: 4, delivValChgPct: 40, delivPctChgPp: 4, ...p }) as never;
  it('classifies and never labels ETFs or excluded rows', () => {
    expect(rangeSignal(row({}), false)).toBe('ACC');
    expect(rangeSignal(row({ ret: -4 }), false)).toBe('DIS');
    expect(rangeSignal(row({ ret: 6, delivValChgPct: 0, delivPctChgPp: -6 }), false)).toBe('SPU');
    expect(rangeSignal(row({ ret: -6, delivValChgPct: 0, delivPctChgPp: -6 }), false)).toBe('SPD');
    expect(rangeSignal(row({}), true)).toBeNull();
    expect(rangeSignal(row({ excluded: true }), false)).toBeNull();
  });
});

describe('corporate-action warning on real backfilled data', () => {
  // HDFCAMC: BONUS 1:1 with ex-date 2025-11-26. The fixtures are trimmed copies of real build output
  // (meta, stats/split_bonus.json, cum/ for Nov–Dec 2025, 4 symbols), committed so CI does not need the generated data.
  const data = (p: string) =>
    JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/range-ca', p), 'utf8'));
  const sb = rowsToObjects<SplitBonusRow>(data('stats/split_bonus.json'));
  const meta = data('meta.json') as Meta;

  it('lists the real bonus and flags only ranges that contain its ex-date', () => {
    const ex = sb.find((r) => r.sym === 'HDFCAMC' && r.kind === 'BONUS');
    expect(ex?.exDate).toBe('2025-11-26');
    expect(corpActionSyms(sb, '2025-11-20', '2025-12-05').has('HDFCAMC')).toBe(true);
    expect(corpActionSyms(sb, '2025-12-01', '2025-12-15').has('HDFCAMC')).toBe(false);
  });

  it('puts caWarn on the range row of that stock (cum files from the build)', () => {
    const load = (d: string) => rowsToObjects<CumRow>(data(`cum/${d}.json`));
    const r = resolveRange(
      { preset: 'C', a: '2025-11-24', b: '2025-12-05', baseline: 'p', ba: null, bb: null },
      '2025-12-05',
      meta.tradingDays,
    );
    const cums = {
      a0: load(r.range.prevA!),
      a1: load(r.range.b),
      b0: load(r.baseline!.prevA!),
      b1: load(r.baseline!.b),
    };
    const universe = new Map<string, UniverseRow>(
      cums.a1.map((c) => [
        c.sym,
        { sym: c.sym, name: c.sym, sector: 'X', bucket: 'L', mcapCr: 1, etf: false } as UniverseRow,
      ]),
    );
    const rows = buildRangeRows(cums, r, universe, meta.settings, sb);
    const h = rows.find((x) => x.sym === 'HDFCAMC')!;
    expect(h.caWarn).toBe(true);
    expect(rows.find((x) => x.sym === 'RELIANCE')!.caWarn).toBe(false);
  });
});
