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
    expect(r1).toEqual([
      { sym: 'A', close: 1 },
      { sym: 'B', close: 2 },
    ]);
    await client.daily('2026-11-12', '2026-11-13');
    expect(calls.some((c) => c.url.startsWith('/data/daily/2026-11-12.json'))).toBe(true);
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
