/** localStorage wrappers: every access is inside try/catch (private windows, blocked storage). */

export function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the app still works without persistence */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readStore(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeStore(key, JSON.stringify(value));
}
