import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SymbolFile } from '../types/data';
import {
  MIN_HISTORY_DAYS,
  NO_RUNS_TEXT,
  RUN_CSV_HEADERS,
  SHORT_HISTORY_TEXT,
  bigPlayerLines,
  fmtFeature,
  footprintCardLines,
  marketMedian,
  parseRuns,
  parseSummary,
  patternEnough,
  runCsvRows,
  runsState,
  windowSpans,
  type MediansDoc,
  type WindowId,
} from './runs';

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/runs', name), 'utf8')) as unknown;

// The committed fixture is a copy of the generated NATIONALUM symbol file and of stats/run_footprints.json.
const file = fixture('NATIONALUM.json') as SymbolFile;
const medians = fixture('run_footprints.json') as MediansDoc;
const runBlock = file.runs!;
const runs = parseRuns(runBlock);
const summary = parseSummary(file.runSummary);

/** The raw cell of a run row, read by column name from the stored block (the source of truth). */
const raw = (i: number, col: string) => runBlock.rows[i]![runBlock.columns.indexOf(col)];

const WINDOWS: WindowId[] = ['pre', 'early', 'full'];

describe('parseRuns and parseSummary', () => {
  it('parses every stored run in order', () => {
    expect(runs).toHaveLength(runBlock.rows.length);
    expect(runs[0]).toMatchObject({
      dir: 'UP',
      start: '2024-03-13',
      end: '2024-05-18',
      movePct: 46.82,
      days: 43,
    });
  });

  it('reads the summary groups', () => {
    expect(summary.UP?.runs).toBe(7);
    expect(summary.DOWN?.runs).toBe(5);
    expect(summary.ORDINARY?.runs).toBe(665);
    expect(summary.UP?.enough).toBe(true);
  });
});

describe('footprint card numbers equal the source fields', () => {
  it('each window value is the run row cell, for every run', () => {
    runs.forEach((run, i) => {
      for (const w of WINDOWS) {
        const byFeature = Object.fromEntries(
          footprintCardLines(run, w, summary, medians, 'M').map((l) => [l.feature, l.run]),
        );
        expect(byFeature.delivValRatio, `run ${i} ${w}`).toBe(raw(i, `${w}DelivValRatio`));
        expect(byFeature.delivPctChgPp, `run ${i} ${w}`).toBe(raw(i, `${w}DelivPctChgPp`));
        expect(byFeature.delivBalance, `run ${i} ${w}`).toBe(raw(i, `${w}DelivBalance`));
        expect(byFeature.spikeDays, `run ${i} ${w}`).toBe(raw(i, `${w}SpikeDays`));
        expect(byFeature.priceChgPct, `run ${i} ${w}`).toBe(raw(i, `${w}PriceChgPct`));
      }
    });
  });

  it('the ordinary column is the runSummary ORDINARY row, for the pre window only', () => {
    const ord = summary.ORDINARY!;
    const pre = footprintCardLines(runs[0]!, 'pre', summary, medians, 'M');
    expect(pre.find((l) => l.feature === 'delivValRatio')?.ordinary).toBe(ord.preDelivValRatio);
    expect(pre.find((l) => l.feature === 'priceChgPct')?.ordinary).toBe(ord.prePriceChgPct);
    const early = footprintCardLines(runs[0]!, 'early', summary, medians, 'M');
    expect(early.every((l) => l.ordinary === null)).toBe(true);
  });

  it('the market column is the medians row for the run direction and the stock bucket', () => {
    const expected = medians.medians.rows.find(
      (r) => r[0] === 'pre' && r[1] === 'UP' && r[2] === 'M' && r[3] === 'delivValRatio',
    )![4];
    const lines = footprintCardLines(runs[0]!, 'pre', summary, medians, 'M');
    expect(lines.find((l) => l.feature === 'delivValRatio')?.market).toBe(expected);
  });

  it('falls back to the ALL bucket when the stock bucket has no median', () => {
    const allRow = medians.medians.rows.find(
      (r) => r[0] === 'pre' && r[1] === 'UP' && r[2] === 'ALL' && r[3] === 'delivValRatio',
    )!;
    expect(marketMedian(medians, 'pre', 'UP', 'XX', 'delivValRatio')).toBe(allRow[4]);
    expect(marketMedian(null, 'pre', 'UP', 'M', 'delivValRatio')).toBeNull();
  });

  it('big-player fields equal the row cells, and are null where the source did not cover the window', () => {
    const i = runs.findIndex((r) => r.results !== null && r.results > 0);
    const big = bigPlayerLines(runs[i]!);
    expect(big.results).toBe(raw(i, 'results'));
    expect(big.deals.pre.FII).toBe(raw(i, 'dealsPreFII'));
    expect(big.fo.find((f) => f.label === 'Long build-up days')?.value).toBe(raw(i, 'buildLB'));
    const uncovered = runs.find((r) => r.dealsPre.FII === null);
    expect(uncovered).toBeDefined();
    expect(bigPlayerLines(uncovered!).deals.pre.FII).toBeNull();
    expect(fmtFeature('delivValRatio', null)).toBe('—');
  });
});

describe('pattern card', () => {
  it('gives numbers only with at least 3 runs in the direction and the source flag', () => {
    expect(patternEnough(summary.UP!)).toBe(true);
    expect(patternEnough({ ...summary.UP!, runs: 2 })).toBe(false);
    expect(patternEnough({ ...summary.UP!, enough: false })).toBe(false);
    expect(patternEnough(null)).toBe(false);
  });
});

describe('windowSpans (the highlight rule)', () => {
  // 60 real calendar days from 2024-01-01 (index = position), so the pivot dates below exist
  const dates = Array.from({ length: 60 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
  );

  it('pre is the 20 days ending at the start pivot, early the 5 days after it, full start to end, post the 20 after', () => {
    const spans = windowSpans({ start: dates[25]!, end: dates[30]! }, dates);
    expect(spans.pre).toEqual([6, 25]);
    expect(spans.early).toEqual([26, 30]);
    expect(spans.full).toEqual([25, 30]);
    expect(spans.post).toEqual([31, 50]);
    const shortTail = windowSpans({ start: dates[25]!, end: dates[50]! }, dates);
    expect(shortTail.post).toBeNull(); // only 9 days follow the end pivot
  });

  it('a window cut short by the stored rows is null (no partial pre, early or post window)', () => {
    const early = windowSpans({ start: dates[10]!, end: dates[59]! }, dates);
    expect(early.pre).toBeNull();
    expect(early.post).toBeNull();
    const late = windowSpans({ start: dates[58]!, end: dates[59]! }, dates);
    expect(late.early).toBeNull();
    expect(late.full).toEqual([58, 59]);
  });

  it('a pivot that is not a stored date moves to the next stored day (start) or the previous one (end)', () => {
    const stored = dates.filter((d) => d !== '2024-01-31');
    const spans = windowSpans({ start: '2024-01-31', end: '2024-02-10' }, stored);
    expect(spans.full?.[0]).toBe(stored.indexOf('2024-02-01'));
    expect(spans.full?.[1]).toBe(stored.indexOf('2024-02-10'));
  });

  it('every stored NATIONALUM run resolves its full window on the stored rows', () => {
    const rowDates = file.rows.map((r) => String(r[0]));
    for (const r of runs) expect(windowSpans(r, rowDates).full).not.toBeNull();
  });
});

describe('empty states', () => {
  it('not enough history comes first, then no runs, then ok', () => {
    expect(runsState(0, MIN_HISTORY_DAYS - 1)).toBe('short');
    expect(runsState(5, MIN_HISTORY_DAYS - 1)).toBe('short');
    expect(runsState(0, 500)).toBe('none');
    expect(runsState(3, 500)).toBe('ok');
  });

  it('the empty-state wording is the spec wording', () => {
    expect(NO_RUNS_TEXT).toBe('No runs of 20% or more in the stored history.');
    expect(SHORT_HISTORY_TEXT).toContain('Not enough history yet');
  });
});

describe('CSV of the runs table', () => {
  it('has one row per run, the header width, and the stored results count', () => {
    const rows = runCsvRows(runs);
    expect(rows).toHaveLength(runs.length);
    for (const r of rows) expect(r).toHaveLength(RUN_CSV_HEADERS.length);
    expect(rows[0]![0]).toBe('UP');
    expect(rows[0]![11]).toBe(raw(0, 'results'));
  });
});

describe('wording (07 section 9, 05 section 8)', () => {
  const FORBIDDEN = /\b(buy|sell|hold|add|reduce|exit|bullish|bearish|confirmed|rating|score)\b/i;
  const files = [
    'src/lib/footprints.ts',
    'src/lib/runs.ts',
    'src/lib/smartMoney.ts',
    'src/components/RunsTab.tsx',
    'src/components/SmartMoneyPanel.tsx',
    'src/charts/runs.ts',
  ];

  it('no advice word in the new files, outside comments', () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(resolve(process.cwd(), f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const m of text.matchAll(
        /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}]+</g,
      )) {
        if (FORBIDDEN.test(m[0])) bad.push(`${f}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the new files are inside the source tree that the wording test scans', () => {
    const all = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) =>
        statSync(join(dir, n)).isDirectory() ? all(join(dir, n)) : [join(dir, n)],
      );
    const scanned = all(resolve(process.cwd(), 'src')).map((p) => p.replace(/\\/g, '/'));
    for (const f of files) expect(scanned.some((p) => p.endsWith(f))).toBe(true);
  });
});
