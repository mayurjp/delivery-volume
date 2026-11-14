import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No UI string may call a signal bullish, bearish, a buy or a sell, or "confirmed" (04 section 0, 06 Phase 3).
 * Scans the string literals and JSX text of every source file (the app's locale strings live in the source) and,
 * when a built bundle exists (DIST_DIR, default ../.tmp/dist-check), the string literals of the app's own chunks.
 */
const FORBIDDEN = /\b(bullish|bearish|buy|sell|confirmed)\b/i;
// data-model values, not UI copy
const ALLOWED_LITERALS = new Set(["'BUY'", "'SELL'"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

function uiStrings(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of noComments.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g))
    out.push(m[0]);
  for (const m of noComments.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) out.push(m[1]!);
  return out.filter((s) => !ALLOWED_LITERALS.has(s));
}

describe('forbidden words', () => {
  it('appear in no source string or JSX text', () => {
    const bad: string[] = [];
    for (const f of walk(resolve(process.cwd(), 'src'))) {
      for (const s of uiStrings(readFileSync(f, 'utf8'))) {
        if (FORBIDDEN.test(s)) bad.push(`${f}: ${s.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('appear in no string of the built app chunks (when a build is present)', () => {
    const dist = resolve(process.cwd(), process.env.DIST_DIR ?? '../.tmp/dist-check', 'assets');
    let files: string[];
    try {
      files = readdirSync(dist).filter((f) =>
        /^(index|Compare|Heatmap|Stats|Screener|Stock|Learn|Dashboard)-.*\.js$/.test(f),
      );
    } catch {
      return; // no build: the source scan above is authoritative
    }
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(dist, f), 'utf8');
      for (const m of text.matchAll(/"(?:[^"\\\n]|\\.){12,}"|`(?:[^`\\]|\\.){12,}`/g)) {
        if (/\s/.test(m[0]) && FORBIDDEN.test(m[0]) && !/BUY|SELL/.test(m[0]))
          bad.push(`${f}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
