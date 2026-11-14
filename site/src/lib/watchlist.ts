import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from './storage';

const KEY = 'dv.watchlist';
let cache: string[] | null = null;
const listeners = new Set<() => void>();

function load(): string[] {
  if (cache === null) {
    const v = readJson<unknown>(KEY, []);
    cache = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }
  return cache;
}

function emit(): void {
  listeners.forEach((l) => l());
}

export function toggleWatch(sym: string): void {
  const cur = load();
  cache = cur.includes(sym) ? cur.filter((s) => s !== sym) : [...cur, sym];
  writeJson(KEY, cache);
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

/** Starred symbols (stable array identity between changes). */
export function useWatchlist(): readonly string[] {
  return useSyncExternalStore(subscribe, load, () => []);
}
