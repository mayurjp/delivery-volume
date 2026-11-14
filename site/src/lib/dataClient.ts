import type {
  CumRow,
  DailyRow,
  Market,
  Meta,
  PeriodInfo,
  PeriodSnapshot,
  PeriodSnapshotRow,
  PeriodsDoc,
  SignalPerfDoc,
  SignalPerfPeriodRow,
  SignalPerfPeriodsDoc,
  SignalPerfRow,
  SplitBonusRow,
  SymbolFile,
  SymbolRow,
  Table,
  TrailDoc,
  TrailPerfDoc,
  TrailPerfRow,
  UniverseRow,
  CashRow,
  ParticipantRow,
  FiiDerivRow,
  DealRow,
  FlowRow,
  EntityRow,
  HoldingsAggregateRow,
  HoldingsFiling,
  HoldingsQuarterRow,
  HolderRow,
} from '../types/data';

/**
 * Data loading (05 section 6). meta.json is fetched with cache: 'no-store'; every other file gets ?v=<generatedAt>
 * and the default cache, so each deploy busts the cache while files are reused within a deploy. An in-memory LRU
 * (40 files) and in-flight de-duplication sit in front of the network.
 */

export const LRU_SIZE = 40;

/** Every daily column. daily/ files older than publish.dailyFullTradingDays (and the F&O columns, until Phase 5) lack some of them. */
export const DAILY_KEYS: readonly (keyof DailyRow)[] = [
  'sym',
  'series',
  'open',
  'high',
  'low',
  'close',
  'prevClose',
  'vwap',
  'vol',
  'turnoverCr',
  'trades',
  'delivQty',
  'delivPct',
  'delivValCr',
  'delivValAvg5',
  'delivValAvg20',
  'delivValAvg50',
  'delivPctAvg20',
  'volAvg20',
  'turnoverAvg20Cr',
  'tradeSizeRatio',
  'spike',
  'delivPctDiff',
  'relVol',
  'ret1',
  'clv',
  'vwapGap',
  'delivPctZ60',
  'delivPctPctile',
  'streak',
  'signal',
  'flags',
  'futOi',
  'futOiChgPct',
  'buildup',
  'pcr',
];

/** A column that a given day's file does not carry reads as null, so the UI shows "—" (with a tooltip for slim days). */
export function fillMissing<T extends object>(
  rows: T[],
  columns: readonly string[],
  all: readonly string[],
): T[] {
  const missing = all.filter((k) => !columns.includes(k));
  if (missing.length === 0) return rows;
  for (const r of rows) for (const k of missing) (r as Record<string, unknown>)[k] = null;
  return rows;
}

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
    const path = date === latest ? 'daily/latest.json' : `daily/${date}.json`;
    return this.cached(path, async () => {
      const doc = await this.fetchData<Table>(path);
      return fillMissing(rowsToObjects<DailyRow>(doc), doc.columns, DAILY_KEYS);
    });
  }

  /** periods.json: the weeks, months and quarters, and the aggregation config the client uses (08 section 4). */
  periods(): Promise<PeriodsDoc> {
    return this.getJson<PeriodsDoc>('periods.json');
  }

  /** One weekly/ or monthly/ snapshot (slim columns). */
  periodSnapshot(tf: 'w' | 'm', info: PeriodInfo): Promise<PeriodSnapshot> {
    const path = info.file ?? (tf === 'w' ? `weekly/${info.end}.json` : `monthly/${info.key}.json`);
    return this.cached(path, async () => {
      const doc = await this.fetchData<
        Table & {
          tf: 'w' | 'm';
          key: string;
          start: string;
          end: string;
          partial: boolean;
          daysIn: number;
          daysExpected: number;
        }
      >(path);
      return {
        info: {
          tf,
          key: doc.key,
          start: doc.start,
          end: doc.end,
          partial: doc.partial,
          daysIn: doc.daysIn,
          daysExpected: doc.daysExpected,
        },
        rows: rowsToObjects<PeriodSnapshotRow>(doc),
      };
    });
  }

  signalPerfPeriodsDoc(): Promise<SignalPerfPeriodsDoc> {
    return this.getJson<SignalPerfPeriodsDoc>('stats/signal_perf_periods.json');
  }

  signalPerfPeriods(): Promise<SignalPerfPeriodRow[]> {
    return this.cached('signalPerfPeriods:rows', async () =>
      rowsToObjects<SignalPerfPeriodRow>(await this.signalPerfPeriodsDoc()),
    );
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

  /** trail/latest.json, or the month-end snapshot trail/asof/{date}.json (07 section 6A). */
  trail(asOf: string | null): Promise<TrailDoc> {
    return this.getJson<TrailDoc>(asOf ? `trail/asof/${asOf}.json` : 'trail/latest.json');
  }

  trailPerfDoc(): Promise<TrailPerfDoc> {
    return this.getJson<TrailPerfDoc>('stats/trail_perf.json');
  }

  trailPerf(): Promise<TrailPerfRow[]> {
    return this.cached('trailPerf:rows', async () => rowsToObjects<TrailPerfRow>(await this.trailPerfDoc()));
  }

  /** deals/{YYYY}.json: every deal row of one year (Phase 4, 03 5.8). */
  dealsYear(year: number): Promise<DealRow[]> {
    return this.cached(`deals/${year}`, async () =>
      rowsToObjects<DealRow>(await this.fetchData<Table>(`deals/${year}.json`)),
    );
  }

  /** deals/flows.json: per stock, date and category (round trips excluded). */
  dealFlows(): Promise<FlowRow[]> {
    return this.table<FlowRow>('deals/flows.json');
  }

  /** deals/entities.json: one row per entity, with its aliases. */
  entities(): Promise<EntityRow[]> {
    return this.table<EntityRow>('deals/entities.json');
  }

  /** holdings/quarters.json: the stored quarters, with how many companies filed (S16, Phase 4B). */
  holdingsQuarters(): Promise<HoldingsQuarterRow[]> {
    return this.table<HoldingsQuarterRow>('holdings/quarters.json');
  }

  /** holdings/latest.json: one filing per stock (its latest stored quarter). */
  holdingsLatest(): Promise<HoldingsFiling[]> {
    return this.table<HoldingsFiling>('holdings/latest.json');
  }

  /** holdings/aggregates.json: market-cap-weighted group percentages per quarter. */
  holdingsAggregates(): Promise<HoldingsAggregateRow[]> {
    return this.table<HoldingsAggregateRow>('holdings/aggregates.json');
  }

  /**
   * holdings/holders/{q}.json for each quarter (the store writes the latest two). A quarter whose file is missing or
   * unreadable is left out of the result rather than failing the view.
   */
  holders(quarters: readonly string[]): Promise<{ quarter: string; rows: HolderRow[] }[]> {
    return Promise.all(
      quarters.map(async (quarter) => {
        try {
          const rows = await this.table<HolderRow>(`holdings/holders/${quarter}.json`);
          return { quarter, rows };
        } catch {
          return null;
        }
      }),
    ).then((all) => all.filter((x): x is { quarter: string; rows: HolderRow[] } => x !== null));
  }

  /** institutional/cash.json: the FII/DII cash table and the first collected day. */
  async institutionalCash(): Promise<{ rows: CashRow[]; collectingSince: string | null }> {
    return this.cached('institutional/cash', async () => {
      const doc = await this.fetchData<Table & { collectingSince?: string | null }>(
        'institutional/cash.json',
      );
      return { rows: rowsToObjects<CashRow>(doc), collectingSince: doc.collectingSince ?? null };
    });
  }

  /** institutional/participants.json: participant OI and volume tables (FII, DII, Pro, Client). */
  participants(): Promise<{ oi: ParticipantRow[]; vol: ParticipantRow[] }> {
    return this.cached('institutional/participants', async () => {
      const doc = await this.fetchData<{ oi: Table; vol: Table }>('institutional/participants.json');
      return { oi: rowsToObjects<ParticipantRow>(doc.oi), vol: rowsToObjects<ParticipantRow>(doc.vol) };
    });
  }

  /** institutional/fii_deriv.json: S7 FII derivatives statistics. */
  fiiDeriv(): Promise<FiiDerivRow[]> {
    return this.table<FiiDerivRow>('institutional/fii_deriv.json');
  }

  symbol(fileKey: string): Promise<{ file: SymbolFile; rows: SymbolRow[] }> {
    return this.cached(`symbols/${fileKey}.json`, async () => {
      const file = await this.fetchData<SymbolFile>(`symbols/${fileKey}.json`);
      return { file, rows: rowsToObjects<SymbolRow>(file) };
    });
  }
}

export const dataClient = new DataClient();
