import { describe, expect, it, vi } from 'vitest';
import { DataClient, rowsToObjects } from './dataClient';

const META = { generatedAt: '2026-11-14T10:00:00+05:30', latestDate: '2026-11-13' };

function server(files: Record<string, unknown> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.replace('/data/', '').split('?')[0]!;
    const body = path === 'meta.json' ? META : files[path];
    return body === undefined
      ? ({ ok: false, status: 404, json: async () => ({}) } as Response)
      : ({ ok: true, status: 200, json: async () => body } as Response);
  });
  return { fetchFn, calls, client: new DataClient({ baseUrl: '/data/', fetchFn, lruSize: 3 }) };
}

describe('DataClient', () => {
  it('fetches meta.json with no-store and everything else with ?v=generatedAt and the default cache', async () => {
    const { client, calls } = server({ 'market.json': { dates: [] } });
    await client.market();
    const meta = calls.find((c) => c.url.startsWith('/data/meta.json'))!;
    expect(meta.url).toBe('/data/meta.json');
    expect(meta.init).toEqual({ cache: 'no-store' });
    const m = calls.find((c) => c.url.startsWith('/data/market.json'))!;
    expect(m.url).toBe(`/data/market.json?v=${encodeURIComponent(META.generatedAt)}`);
    expect(m.init).toBeUndefined();
  });

  it('serves repeats from memory and fetches meta only once', async () => {
    const { client, fetchFn } = server({ 'market.json': { dates: [] } });
    await client.market();
    await client.market();
    expect(fetchFn).toHaveBeenCalledTimes(2); // meta + market
  });

  it('de-duplicates concurrent requests for the same file', async () => {
    const { client, fetchFn } = server({ 'market.json': { dates: [] } });
    const [a, b] = await Promise.all([client.market(), client.market()]);
    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used file beyond the LRU size', async () => {
    const files = Object.fromEntries(['a', 'b', 'c', 'd'].map((k) => [`${k}.json`, { k }]));
    const { client, fetchFn } = server(files);
    for (const k of ['a', 'b', 'c']) await client.getJson(`${k}.json`);
    await client.getJson('a.json'); // refresh a; b is now the oldest
    await client.getJson('d.json'); // evicts b
    const before = fetchFn.mock.calls.length;
    await client.getJson('a.json');
    await client.getJson('c.json');
    expect(fetchFn.mock.calls.length).toBe(before); // still cached
    await client.getJson('b.json');
    expect(fetchFn.mock.calls.length).toBe(before + 1); // refetched
  });

  it('uses daily/latest.json for the latest date and converts rows to objects once', async () => {
    const doc = {
      columns: ['sym', 'close'],
      rows: [
        ['A', 1],
        ['B', 2],
      ],
    };
    const { client, calls } = server({ 'daily/latest.json': doc, 'daily/2026-11-12.json': doc });
    const r1 = await client.daily('2026-11-13', '2026-11-13');
    const r2 = await client.daily('2026-11-13', '2026-11-13');
    expect(r1).toBe(r2);
    expect(r1.map((r) => [r.sym, r.close])).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
    // a column the day's file does not carry (a slim day, or the F&O columns) reads as null, so the UI shows a dash
    expect(r1[0]!.spike).toBeNull();
    expect(r1[0]!.futOi).toBeNull();
    await client.daily('2026-11-12', '2026-11-13');
    expect(calls.some((c) => c.url.startsWith('/data/daily/2026-11-12.json'))).toBe(true);
  });

  it('loads periods.json and a period snapshot through the same cache', async () => {
    const info = {
      key: '2026-W46',
      start: '2026-11-09',
      end: '2026-11-13',
      tradingDays: 5,
      partial: false,
      daysIn: 5,
      daysExpected: 5,
      stocks: 1,
      file: 'weekly/2026-11-13.json',
    };
    const snap = {
      tf: 'w',
      key: '2026-W46',
      start: '2026-11-09',
      end: '2026-11-13',
      partial: false,
      daysIn: 5,
      daysExpected: 5,
      columns: ['sym', 'ret'],
      rows: [['A', 1.5]],
    };
    const { client, calls } = server({ 'periods.json': { weekly: [info] }, 'weekly/2026-11-13.json': snap });
    expect((await client.periods()).weekly[0]!.key).toBe('2026-W46');
    const s1 = await client.periodSnapshot('w', info);
    expect(s1.rows).toEqual([{ sym: 'A', ret: 1.5 }]);
    expect(s1.info.end).toBe('2026-11-13');
    expect(await client.periodSnapshot('w', info)).toBe(s1);
    expect(calls.filter((c) => c.url.startsWith('/data/weekly/')).length).toBe(1);
  });

  it('rejects on HTTP errors and does not cache the failure', async () => {
    const { client, fetchFn } = server({});
    await expect(client.getJson('missing.json')).rejects.toThrow('HTTP 404');
    await expect(client.getJson('missing.json')).rejects.toThrow('HTTP 404');
    expect(fetchFn.mock.calls.filter(([u]) => String(u).startsWith('/data/missing.json'))).toHaveLength(2);
  });

  it('rowsToObjects maps columns', () => {
    expect(
      rowsToObjects<{ a: number; b: string | null }>({ columns: ['a', 'b'], rows: [[1, null]] }),
    ).toEqual([{ a: 1, b: null }]);
  });
});
