import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrailPerfRow, UniverseRow } from '../types/data';
import { rowsToObjects } from './dataClient';
import { buildInsights, historyLine, narrative, parseTrail } from './trailView';
import {
  EMPTY_HOLDINGS,
  ENTITY_DISCLOSURE,
  EXITED_CAVEAT,
  MODEL_NOTE,
  OWNERSHIP_PRESETS,
  coverageLine,
  dilutionCaveat,
} from './ownership';

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
        /^(index|Compare|Heatmap|Stats|Screener|Stock|Learn|Dashboard|Trail)-.*\.js$/.test(f),
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

/**
 * Smart Money Trail wording (07 section 6A): descriptive and past tense only. The check targets imperative advice (a verb
 * that tells the reader what to do with a holding) and ratings, not ordinary English such as "may not hold", "holdings"
 * or "MFs added 0.8 pp".
 */
const ADVICE_VERB = String.raw`(?:buy|sell|hold|add|reduce|exit|trim|accumulate|avoid|switch)`;
const LEAD = String.raw`(?:^|[.!?;:]\s+|\b(?:and|or|then|to|please|you|should|must|can|could|may|might|do not|don't)\s+)`;
const OBJ = String.raw`(?:the|this|that|these|those|it|them|more|less|now|on|your|its|a|an|some|all|at|into|from)`;
const TRAIL_ADVICE = new RegExp(
  [
    String.raw`\b(?:bullish|bearish|confirmed|buy|sell)\b`,
    String.raw`${LEAD}${ADVICE_VERB}\s+${OBJ}\b`,
    String.raw`^\s*${ADVICE_VERB}\b`,
    String.raw`\b(?:you should|you must|we recommend|recommended|recommendation|average (?:down|up)|consider (?:buying|selling|adding|reducing|exiting|holding)|worth (?:buying|selling)|time to (?:buy|sell|add|exit|reduce))\b`,
    String.raw`\b(?:rating|rated|score|stop-?loss|target price|top pick|strong buy)\b`,
  ].join('|'),
  'i',
);

describe('smart money trail wording', () => {
  const ordinary = [
    'The 3-year study found these readings may not hold.',
    'MFs added 0.8 pp last quarter and FIIs sold 85 Cr via a block deal.',
    'Holdings arrive in Phase 4B.',
    'A leans accumulation, D leans distribution.',
    'Evidence summary, not advice. You decide.',
  ];
  const advice = [
    'Buy the strongest A stocks.',
    'Consider selling when the trail flips.',
    'You should reduce your holding.',
    'Hold this stock.',
    'Accumulate on dips',
    'Add to your position',
    'Exit now',
    'Bullish trail',
    'Top rated stocks',
    'Composite score 82',
  ];
  it('the matcher catches imperative advice but not ordinary English', () => {
    for (const s of ordinary) expect(TRAIL_ADVICE.test(s), s).toBe(false);
    for (const s of advice) expect(TRAIL_ADVICE.test(s), s).toBe(true);
  });

  const trailFiles = [
    'src/pages/Trail.tsx',
    'src/lib/trail.ts',
    'src/lib/trailView.ts',
    'src/charts/trail.ts',
    'src/components/TrailLearn.tsx',
    // Phase 4B: shareholding (ownership section, Institutions holdings tab, entity disclosed holdings, Screener presets)
    'src/components/Ownership.tsx',
    'src/components/HoldingsTab.tsx',
    'src/lib/ownership.ts',
  ].map((f) => resolve(process.cwd(), f));

  it('no trail source string or JSX text gives advice or a rating', () => {
    const bad: string[] = [];
    for (const f of trailFiles) {
      for (const s of uiStrings(readFileSync(f, 'utf8'))) {
        const t = s.replace(/^['"`]|['"`]$/g, '');
        if (TRAIL_ADVICE.test(t)) bad.push(`${f}: ${t.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the ownership texts (caveats, preset explanations, coverage) pass the same check', () => {
    const texts = [
      dilutionCaveat(3.4),
      EXITED_CAVEAT,
      MODEL_NOTE,
      ENTITY_DISCLOSURE,
      EMPTY_HOLDINGS,
      coverageLine(19, 2970, '2026-09-30'),
      ...OWNERSHIP_PRESETS.flatMap((p) => [p.label, p.explain]),
    ];
    const bad = texts.filter((t) => TRAIL_ADVICE.test(t) || FORBIDDEN.test(t));
    expect(bad).toEqual([]);
  });

  it('the generated texts (insights, narrative, history lines, build labels) pass too', () => {
    const fx = (name: string) =>
      JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/trail', name), 'utf8'));
    const latest = fx('latest.json');
    const perfDoc = fx('perf.json');
    const uni = fx('universe.json');
    const bySym = new Map<string, UniverseRow>(rowsToObjects<UniverseRow>(uni).map((u) => [u.sym, u]));
    const entries = parseTrail(latest);
    const perf = rowsToObjects<TrailPerfRow>(perfDoc);
    const texts: string[] = [
      latest.label,
      perfDoc.label,
      ...latest.indicators.map((i: { label: string; rule: string }) => `${i.label}. ${i.rule}`),
    ];
    for (const sl of latest.slots) texts.push(sl.label);
    for (const win of ['3M', '6M', '1Y'] as const) {
      texts.push(
        ...buildInsights(entries, bySym, {
          win,
          universeLabel: 'Nifty 500',
          sectorLabel: null,
          perf,
          minN: 30,
        }).map((i) => i.text),
      );
      for (const e of entries) texts.push(...narrative(e.w[win], win, 26));
      for (const id of ['strongA', 'strongD', 'flip']) texts.push(historyLine(perf, 'list', id, win));
    }
    const bad = [...new Set(texts)].filter((t) => TRAIL_ADVICE.test(t));
    expect(bad).toEqual([]);
  });
});
