import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DailyRow, CumRow, Market, Meta, SymbolRow, SymbolFile, UniverseRow } from '../types/data';
import { dataClient } from './dataClient';
import { activeFilterCount, defaultFilters, type Filters } from './filters';
import { readJson, writeJson } from './storage';
import { indexPerf, type PerfIndex } from './signalPerf';
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
