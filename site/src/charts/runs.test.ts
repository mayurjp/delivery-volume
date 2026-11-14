import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SymbolFile } from '../types/data';
import { parseRuns, type RunRec } from '../lib/runs';
import { RUN_COLOR, runBarData, runCoverage, runIndexByRow, nextDay, selectedWindowByRow } from './runs';
import { stockTrailOption } from './trail';
import { LIGHT } from './theme';

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

describe('the shading helper is shared by the Runs tab and the Trail stock chart', () => {
  it('the daily coverage (runCoverage on one-day intervals) equals the Runs tab shading', () => {
    const daily = runCoverage(
      rows.map((r) => [r.date, r.date] as const),
      runs,
    );
    expect(daily).toEqual(runIndexByRow(rows, runs));
  });

  it('a Runs-tab bar and a Trail bar of the same run have the same colour and height', () => {
    const cov = runIndexByRow(rows, runs);
    const bars = runBarData(cov, runs, 100, false);
    const i = cov.findIndex((k) => k >= 0);
    expect(bars[i]).toEqual({
      value: 100,
      itemStyle: { color: RUN_COLOR[runs[cov[i]!]!.dir].light, opacity: 0.2 },
    });
    expect(bars[cov.findIndex((k) => k < 0)]).toBeNull();
  });

  it('a week is covered when a run overlaps (previous week end, week end]', () => {
    const run = { start: '2026-03-10', end: '2026-03-20' };
    const weeks: [string, string][] = [
      ['0000-01-01', '2026-03-06'],
      [nextDay('2026-03-06'), '2026-03-13'],
      [nextDay('2026-03-13'), '2026-03-20'],
      [nextDay('2026-03-20'), '2026-03-27'],
    ];
    expect(runCoverage(weeks, [run])).toEqual([-1, 0, 0, -1]);
    expect(nextDay('2026-02-28')).toBe('2026-03-01');
  });

  it('the stock trail chart carries the shading series with the same data, and fixes the price axis', () => {
    const timeline = rows
      .slice(0, 4)
      .map((r) => ({ end: r.date, delivBal: 1, spikeDays: 0, overall: 'N', codes: 'NNNNNNNN' }));
    const cov = [-1, 0, 0, -1];
    const bars = runBarData(cov, runs, 120, false);
    const opt = stockTrailOption(timeline as never, [100, 110, 115, 105], LIGHT, false, {
      coverage: cov,
      runs,
      yMin: 90,
      yMax: 120,
      dark: false,
    }) as { series: { name: string; data: unknown[] }[]; yAxis: { min: number; max: number }[] };
    const shade = opt.series.find((x) => x.name === 'Runs');
    expect(shade?.data).toEqual(bars);
    expect(opt.yAxis[0]).toMatchObject({ min: 90, max: 120 });
  });

  it('without shading the trail chart has no runs series', () => {
    const opt = stockTrailOption([] as never, [], LIGHT, false) as { series: { name: string }[] };
    expect(opt.series.some((x) => x.name === 'Runs')).toBe(false);
  });
});
