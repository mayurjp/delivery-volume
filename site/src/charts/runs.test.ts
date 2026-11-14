import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SymbolFile } from '../types/data';
import { parseRuns, type RunRec } from '../lib/runs';
import { runIndexByRow, selectedWindowByRow } from './runs';

const file = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/runs/NATIONALUM.json'), 'utf8'),
) as SymbolFile;
const runs = parseRuns(file.runs);
const rows = file.rows.map((r, i) => ({ date: String(r[0]), i }));

describe('run shading on the chart rows', () => {
  it('every row of a run carries the run index, and rows outside runs carry -1', () => {
    const shade = runIndexByRow(rows, runs);
    const first = runs[0]!;
    const s = rows.findIndex((r) => r.date === first.start);
    const e = rows.findIndex((r) => r.date === first.end);
    expect(shade[s]).toBe(0);
    // the end pivot of run 0 is the start pivot of run 1: the later run owns the shared day
    expect(shade[e]).toBe(1);
    expect(shade[s - 1]).toBe(-1);
    const covered = shade.filter((k) => k >= 0).length;
    expect(covered).toBeGreaterThan(0);
  });

  it('a shaded row lies inside the run it is shaded for', () => {
    const shade = runIndexByRow(rows, runs);
    shade.forEach((k, i) => {
      if (k < 0) return;
      const r = runs[k]!;
      expect(rows[i]!.date >= r.start && rows[i]!.date <= r.end).toBe(true);
    });
  });
});

describe('selected run highlighting (pre, early, full)', () => {
  it('no selection highlights nothing', () => {
    const { window } = selectedWindowByRow(rows, null);
    expect(window.every((w) => w === null)).toBe(true);
  });

  it('a selected run highlights its pre window, its early days and its full run, and nothing after', () => {
    const run = runs[0] as RunRec;
    const { window, spans } = selectedWindowByRow(rows, run);
    const s = rows.findIndex((r) => r.date === run.start);
    const e = rows.findIndex((r) => r.date === run.end);
    expect(spans.pre).toEqual([s - 19, s]);
    expect(window[s - 19]).toBe('pre');
    expect(window[s]).toBe('full');
    expect(window[s + 1]).toBe('early');
    expect(window[s + 5]).toBe('early');
    expect(window[s + 6]).toBe('full');
    expect(window[e]).toBe('full');
    expect(window[e + 1]).toBeNull();
    expect(window[s - 20]).toBeNull();
  });
});
