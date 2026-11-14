import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunFootprintsDoc } from '../types/data';
import { mediansSeries, oddsSeries } from '../lib/runLibrary';
import { FEATURE_IDS } from '../lib/runs';
import { LIGHT } from './theme';
import { mediansOption, oddsOption } from './runsLibrary';

const doc = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/runs/run_footprints.json'), 'utf8'),
) as RunFootprintsDoc;

type Cells = unknown[][];
const cellsOf = (rows: Cells, horizon: number, feature: string) =>
  rows.filter((r) => r[0] === horizon && r[1] === feature).sort((a, b) => Number(a[2]) - Number(b[2]));

describe('odds chart data equals the run_footprints.json cells', () => {
  const lift = doc.lift as { rows: Cells; base: Record<string, unknown> };
  const long = doc.longHorizon as {
    rows: Cells;
    base: Record<string, { bigUpPct: number; bigDownPct: number; n: number }>;
    status: string;
  };

  it('the 20-day lift: every feature has five quintiles with the published values', () => {
    for (const f of FEATURE_IDS) {
      const s = oddsSeries(doc, 20, f);
      const raw = cellsOf(lift.rows, 20, f);
      expect(s.cells.length).toBe(5);
      expect(s.cells.map((c) => [c.quintile, c.n, c.bigUpPct, c.bigDownPct])).toEqual(
        raw.map((r) => [Number(r[2]), Number(r[3]), r[4], r[5]]),
      );
      expect(s.base).toEqual({
        bigUpPct: lift.base.bigUpPct,
        bigDownPct: lift.base.bigDownPct,
        n: lift.base.n,
      });
    }
  });

  it('the 60-day version: the cells at horizon 60 and the base keyed by 60', () => {
    expect(long.status).toBe('computed');
    for (const f of FEATURE_IDS) {
      const s = oddsSeries(doc, 60, f);
      const raw = cellsOf(long.rows, 60, f);
      expect(s.status).toBe('computed');
      expect(s.cells.map((c) => [c.bigUpPct, c.bigDownPct])).toEqual(raw.map((r) => [r[4], r[5]]));
      expect(s.base).toEqual({
        bigUpPct: long.base['60']!.bigUpPct,
        bigDownPct: long.base['60']!.bigDownPct,
        n: long.base['60']!.n,
      });
    }
  });

  it('the chart option carries the same numbers as the cells, and the base rates as lines', () => {
    const s = oddsSeries(doc, 20, 'delivValRatio');
    const opt = oddsOption(s, LIGHT, false, false) as {
      series: { data: unknown[]; markLine: { data: { yAxis: number }[] } }[];
    };
    expect(opt.series[0]!.data).toEqual(s.cells.map((c) => c.bigUpPct));
    expect(opt.series[1]!.data).toEqual(s.cells.map((c) => c.bigDownPct));
    expect(opt.series[0]!.markLine.data.map((l) => l.yAxis)).toEqual([lift.base.bigUpPct]);
    expect(opt.series[1]!.markLine.data.map((l) => l.yAxis)).toEqual([lift.base.bigDownPct]);
  });

  it('a horizon the statistics do not hold reads as needing more history', () => {
    const fake = {
      ...doc,
      longHorizon: { ...long, status: 'needs more history', rows: [] },
    } as RunFootprintsDoc;
    expect(oddsSeries(fake, 60, 'delivValRatio').status).toBe('needs more history');
    expect(oddsSeries(fake, 20, 'delivValRatio').status).toBe('computed');
  });
});

describe('median chart data equals the medians cells', () => {
  it('pre window, all stocks: UP, DOWN and ordinary days match the rows', () => {
    const s = mediansSeries(doc, 'pre', 'ALL');
    const val = (dir: string, f: string) =>
      (doc.medians.rows.find((r) => r[0] === 'pre' && r[1] === dir && r[2] === 'ALL' && r[3] === f) ??
        [])[4] ?? null;
    FEATURE_IDS.forEach((f, i) => {
      expect(s.up[i]).toBe(val('UP', f));
      expect(s.down[i]).toBe(val('DOWN', f));
      expect(s.ordinary[i]).toBe(val('ORDINARY', f));
    });
    const opt = mediansOption(s, LIGHT, false, false) as { series: { data: unknown[] }[] };
    expect(opt.series[0]!.data).toEqual(s.up);
    expect(opt.series[1]!.data).toEqual(s.down);
    expect(opt.series[2]!.data).toEqual(s.ordinary);
  });

  it("a cap bucket switch reads that bucket's cells", () => {
    const s = mediansSeries(doc, 'pre', 'L');
    const row = doc.medians.rows.find(
      (r) => r[0] === 'pre' && r[1] === 'UP' && r[2] === 'L' && r[3] === 'delivBalance',
    );
    expect(s.up[FEATURE_IDS.indexOf('delivBalance')]).toBe(row![4]);
  });
});
