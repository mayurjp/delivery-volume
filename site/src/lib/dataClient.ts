import type {
  CumRow,
  DailyRow,
  Market,
  Meta,
  SignalPerfDoc,
  SignalPerfRow,
  SplitBonusRow,
  SymbolFile,
  SymbolRow,
  Table,
  UniverseRow,
} from '../types/data';

/**
 * Data loading (05 section 6). meta.json is fetched with cache: 'no-store'; every other file gets ?v=<generatedAt>
 * and the default cache, so each deploy busts the cache while files are reused within a deploy. An in-memory LRU
 * (40 files) and in-flight de-duplication sit in front of the network.
 */

export const LRU_SIZE = 40;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface DataClientOptions {
  baseUrl?: string;
  fetchFn?: FetchFn;
  lruSize?: number;
}

export function rowsToObjects<T>(doc: { columns: string[]; rows: unknown[][] }): T[] {
  const cols = doc.columns;
  const n = cols.length;
  return doc.rows.map((row) => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) o[cols[i]!] = row[i];
    return o as T;
  });
}

export class DataClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly lruSize: number;
  private readonly cache = new Map<string, unknown>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private metaPromise: Promise<Meta> | null = null;
  private version = '';
  /** Number of network requests issued (tests and diagnostics). */
  requests = 0;

  constructor(opt: DataClientOptions = {}) {
    this.baseUrl = opt.baseUrl ?? `${import.meta.env.BASE_URL}data/`;
    this.fetchFn = opt.fetchFn ?? ((i, init) => fetch(i, init));
    this.lruSize = opt.lruSize ?? LRU_SIZE;
  }

  private async http(url: string, init?: RequestInit): Promise<unknown> {
    this.requests++;
    const res = await this.fetchFn(url, init);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  getMeta(): Promise<Meta> {
    if (!this.metaPromise) {
      this.metaPromise = this.http(`${this.baseUrl}meta.json`, { cache: 'no-store' }).then((m) => {
        const meta = m as Meta;
        this.version = meta.generatedAt;
        return meta;
      });
      this.metaPromise.catch(() => {
        this.metaPromise = null; // allow a retry
      });
    }
    return this.metaPromise;
  }

  /** Generic LRU + in-flight de-duplication in front of `produce` (which runs at most once per key at a time). */
  private cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
    if (this.cache.has(key)) {
      const v = this.cache.get(key) as T;
      this.cache.delete(key); // refresh recency
      this.cache.set(key, v);
      return Promise.resolve(v);
    }
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const p = produce()
      .then((v) => {
        this.cache.set(key, v);
        while (this.cache.size > this.lruSize) this.cache.delete(this.cache.keys().next().value as string);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async fetchData<T>(path: string): Promise<T> {
    await this.getMeta();
    return (await this.http(`${this.baseUrl}${path}?v=${encodeURIComponent(this.version)}`)) as T;
  }

  /** Fetch `path` (relative to the data folder, e.g. 'market.json') through the LRU. */
  getJson<T>(path: string): Promise<T> {
    return this.cached(path, () => this.fetchData<T>(path));
  }

  private table<T>(path: string): Promise<T[]> {
    return this.cached(path, async () => rowsToObjects<T>(await this.fetchData<Table>(path)));
  }

  universe(): Promise<UniverseRow[]> {
    return this.table<UniverseRow>('universe.json');
  }

  daily(date: string, latest: string): Promise<DailyRow[]> {
    return this.table<DailyRow>(date === latest ? 'daily/latest.json' : `daily/${date}.json`);
  }

  cum(date: string): Promise<CumRow[]> {
    return this.table<CumRow>(`cum/${date}.json`);
  }

  market(): Promise<Market> {
    return this.getJson<Market>('market.json');
  }

  signalPerf(): Promise<SignalPerfRow[]> {
    return this.cached('signalPerf:rows', async () =>
      rowsToObjects<SignalPerfRow>(await this.getJson<SignalPerfDoc>('stats/signal_perf.json')),
    );
  }

  signalPerfDoc(): Promise<SignalPerfDoc> {
    return this.getJson<SignalPerfDoc>('stats/signal_perf.json');
  }

  splitBonus(): Promise<SplitBonusRow[]> {
    return this.table<SplitBonusRow>('stats/split_bonus.json');
  }

  symbol(fileKey: string): Promise<{ file: SymbolFile; rows: SymbolRow[] }> {
    return this.cached(`symbols/${fileKey}.json`, async () => {
      const file = await this.fetchData<SymbolFile>(`symbols/${fileKey}.json`);
      return { file, rows: rowsToObjects<SymbolRow>(file) };
    });
  }
}

export const dataClient = new DataClient();
