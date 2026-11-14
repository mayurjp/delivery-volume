import { useSyncExternalStore } from 'react';
import { readStore, writeStore } from './storage';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'dv.theme';
const listeners = new Set<() => void>();

export function getChoice(): ThemeChoice {
  const v = readStore(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function isDark(): boolean {
  const c = getChoice();
  return c === 'dark' || (c === 'system' && systemDark());
}

function apply(): void {
  document.documentElement.classList.toggle('dark', isDark());
  listeners.forEach((l) => l());
}

export function setChoice(c: ThemeChoice): void {
  writeStore(KEY, c);
  apply();
}

/** Cycles light -> dark -> system. */
export function cycleTheme(): void {
  const c = getChoice();
  setChoice(c === 'light' ? 'dark' : c === 'dark' ? 'system' : 'light');
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => apply();
  mq.addEventListener('change', onChange);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener('change', onChange);
  };
}

export function useDark(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, getChoice, () => 'system' as ThemeChoice);
}
