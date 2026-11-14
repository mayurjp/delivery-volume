import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  CumRow,
  DailyRow,
  Market,
  Meta,
  PeriodInfo,
  PeriodSnapshot,
  PeriodsDoc,
  SignalPerfPeriodRow,
  SymbolFile,
  SymbolRow,
  TrailDoc,
  TrailPerfRow,
  UniverseRow,
  DealRow,
  FlowRow,
  EntityRow,
  FiiDerivRow,
  HoldingsAggregateRow,
  HoldingsFiling,
  HoldingsQuarterRow,
  HolderRow,
} from '../types/data';
import { dataClient } from './dataClient';
import { activeFilterCount, defaultFilters, type Filters } from './filters';
import { readJson, writeJson } from './storage';
import { indexPerf, type PerfIndex } from './signalPerf';
import { parseTimeframe, writeTimeframe, type TimeframeState } from './timeframe';
import { hasFilterParams, parseDate, parseFilters, writeFilters } from './urlState';

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Runs `fn` when `key` changes (key null = idle). Results of a superseded key are ignored. */
export function useAsync<T>(key: string | null, fn: () => Promise<T>): Async<T> {
  const [result, setResult] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    fn().then(
      (data) => live && setResult({ key, data, error: null }),
      (e: unknown) =>
        live && setResult({ key, data: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // `fn` is intentionally not a dependency: the key identifies the request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = result !== null && result.key === key ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: key !== null && current === null,
  };
}

export const useMeta = (): Async<Meta> => useAsync('meta', () => dataClient.getMeta());
export const useUniverse = (): Async<UniverseRow[]> => useAsync('universe', () => dataClient.universe());
export const useSignalPerf = (): Async<PerfIndex> =>
  useAsync('signalPerf', async () => indexPerf(await dataClient.signalPerf()));
export const useMarket = (): Async<Market> => useAsync('market', () => dataClient.market());
export const useDaily = (date: string | null, latest: string): Async<DailyRow[]> =>
  useAsync(date ? `daily:${date}` : null, () => dataClient.daily(date as string, latest));
export const useCum = (date: string | null): Async<CumRow[]> =>
  useAsync(date ? `cum:${date}` : null, () => dataClient.cum(date as string));
export const useSymbol = (fileKey: string | null): Async<{ file: SymbolFile; rows: SymbolRow[] }> =>
  useAsync(fileKey ? `symbol:${fileKey}` : null, () => dataClient.symbol(fileKey as string));

export const useTrail = (asOf: string | null): Async<TrailDoc> =>
  useAsync(`trail:${asOf ?? 'latest'}`, () => dataClient.trail(asOf));
export const useTrailPerf = (): Async<TrailPerfRow[]> => useAsync('trailPerf', () => dataClient.trailPerf());

// ---- Phase 4: institutions and deals ----------------------------------------------------------------------------------

export const useInstitutionalCash = () =>
  useAsync('institutional:cash', () => dataClient.institutionalCash());
export const useParticipants = () => useAsync('institutional:participants', () => dataClient.participants());
export const useFiiDeriv = (): Async<FiiDerivRow[]> =>
  useAsync('institutional:fiiDeriv', () => dataClient.fiiDeriv());
export const useDealFlows = (): Async<FlowRow[]> => useAsync('deals:flows', () => dataClient.dealFlows());
export const useEntities = (): Async<EntityRow[]> => useAsync('deals:entities', () => dataClient.entities());

/**
 * Every deal row, for each year that has deals (deals/{YYYY}.json, loaded together). The years come from the entity
 * table's first and last deal dates, not from meta.firstDate: the published window starts before the first deal day, and
 * a missing file would otherwise answer with the app shell.
 */
export const useDeals = (): Async<DealRow[]> =>
  useAsync('deals:all', async () => {
    const ents = await dataClient.entities();
    const dates = ents
      .flatMap((e) => [e.firstDate, e.lastDate])
      .filter(Boolean)
      .sort();
    if (dates.length === 0) return [];
    const first = Number(dates[0]!.slice(0, 4));
    const last = Number(dates[dates.length - 1]!.slice(0, 4));
    const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    return (await Promise.all(years.map((y) => dataClient.dealsYear(y)))).flat();
  });

// ---- Phase 4B: shareholding (S16) -------------------------------------------------------------------------------------

export const useHoldingsQuarters = (): Async<HoldingsQuarterRow[]> =>
  useAsync('holdings:quarters', () => dataClient.holdingsQuarters());
export const useHoldingsLatest = (enabled = true): Async<HoldingsFiling[]> =>
  useAsync(enabled ? 'holdings:latest' : null, () => dataClient.holdingsLatest());
export const useHoldingsAggregates = (): Async<HoldingsAggregateRow[]> =>
  useAsync('holdings:aggregates', () => dataClient.holdingsAggregates());
export const useHolders = (quarters: string[] | null): Async<{ quarter: string; rows: HolderRow[] }[]> =>
  useAsync(quarters ? `holders:${quarters.join(',')}` : null, () => dataClient.holders(quarters ?? []));

export const usePeriods = (): Async<PeriodsDoc> => useAsync('periods', () => dataClient.periods());
export const usePeriodSnapshot = (tf: 'w' | 'm', info: PeriodInfo | null): Async<PeriodSnapshot> =>
  useAsync(info ? `period:${tf}:${info.key}` : null, () => dataClient.periodSnapshot(tf, info as PeriodInfo));
export const usePeriodSignalPerf = (): Async<SignalPerfPeriodRow[]> =>
  useAsync('signalPerfPeriods', () => dataClient.signalPerfPeriods());

// ---- app-wide context: meta + universe are loaded once before any page renders --------------------------------------

export interface AppData {
  meta: Meta;
  universe: UniverseRow[];
  bySym: Map<string, UniverseRow>;
}

export const AppDataContext = createContext<AppData | null>(null);

export function useApp(): AppData {
  const v = useContext(AppDataContext);
  if (!v) throw new Error('AppDataContext missing');
  return v;
}

// ---- filters and date, kept in the URL --------------------------------------------------------------------------------

const LAST_KEY = 'dv.lastFilters';

/** Remembers the last-used filters (applied only when a URL carries none). */
export function saveLastFilters(f: Filters, minTurn: number): void {
  writeJson(LAST_KEY, writeFilters(new URLSearchParams(), f, minTurn).toString());
}

export interface GlobalState {
  filters: Filters;
  defaults: Filters;
  activeCount: number;
  date: string;
  setFilters: (f: Filters) => void;
  setDate: (d: string) => void;
}

export function useGlobalState(): GlobalState {
  const { meta } = useApp();
  const [params, setParams] = useSearchParams();
  const minTurn = meta.settings.minTurnoverAvg20Cr;
  const defaults = useMemo(() => defaultFilters(minTurn), [minTurn]);
  const paramString = params.toString();
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(paramString), minTurn, meta.indices),
    [paramString, minTurn, meta.indices],
  );
  const date = useMemo(
    () => parseDate(new URLSearchParams(paramString), meta.tradingDays, meta.latestDate),
    [paramString, meta.tradingDays, meta.latestDate],
  );

  // Last-used filters apply only when the URL has none.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    if (hasFilterParams(params)) return;
    const saved = readJson<string | null>(LAST_KEY, null);
    if (typeof saved === 'string' && saved) {
      const sp = new URLSearchParams(saved);
      const merged = new URLSearchParams(params);
      for (const [k, v] of sp) merged.set(k, v);
      if (merged.toString() !== params.toString()) setParams(merged, { replace: true });
    }
  }, [params, setParams]);

  const setFilters = useCallback(
    (f: Filters) => {
      const next = writeFilters(new URLSearchParams(params), f, minTurn);
      const only = writeFilters(new URLSearchParams(), f, minTurn);
      writeJson(LAST_KEY, only.toString());
      setParams(next);
    },
    [params, setParams, minTurn],
  );
  const setDate = useCallback(
    (d: string) => {
      const next = new URLSearchParams(params);
      if (d === meta.latestDate) next.delete('d');
      else next.set('d', d);
      setParams(next);
    },
    [params, setParams, meta.latestDate],
  );
  return { filters, defaults, activeCount: activeFilterCount(filters, defaults), date, setFilters, setDate };
}

// ---- the timeframe (08 sections 1 and 5A), kept in the URL next to the filters and the date ------------------------------

export interface TimeframeHook {
  state: TimeframeState;
  /** Replaces the timeframe keys of the URL (tf, n, from, to, base, bfrom, bto); everything else is kept. */
  setState: (s: TimeframeState) => void;
}

export function useTimeframe(): TimeframeHook {
  const [params, setParams] = useSearchParams();
  const paramString = params.toString();
  const state = useMemo(() => parseTimeframe(new URLSearchParams(paramString)), [paramString]);
  const setState = useCallback(
    (s: TimeframeState) => setParams(writeTimeframe(new URLSearchParams(paramString), s)),
    [paramString, setParams],
  );
  return { state, setState };
}
