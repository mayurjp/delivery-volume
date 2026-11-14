import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunLibRow, RunsLibraryDoc, UniverseRow } from '../types/data';
import { rowsToObjects } from './dataClient';
import { HEAVY_PRE, TOP_N, oneYearBefore, pickCaseStudies } from './caseStudies';

const fx = (name: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/runs', name), 'utf8'));
const rows = rowsToObjects<RunLibRow>(fx('library.json') as RunsLibraryDoc);
const universe = rowsToObjects<UniverseRow>(fx('universe.json'));
const rank = new Map(universe.map((u) => [u.sym, u.mcapRank]));
const LATEST = '2026-11-13';

/** A brute-force reading of the rule, written separately from the implementation. */
function expected(all: RunLibRow[], rk: Map<string, number | null>, latest: string) {
  const cutoff = oneYearBefore(latest);
  const pool = all.filter((r) => {
    const x = rk.get(r.sym);
    return x != null && x <= TOP_N && r.end >= cutoff;
  });
  const biggest = (xs: RunLibRow[]) =>
    [...xs].sort(
      (a, b) =>
        Math.abs(b.movePct) - Math.abs(a.movePct) || (a.start < b.start ? 1 : a.start > b.start ? -1 : 0),
    )[0];
  const up = biggest(pool.filter((r) => r.dir === 'UP'));
  const down = biggest(pool.filter((r) => r.dir === 'DOWN'));
  const heavy = biggest(
    pool.filter(
      (r) =>
        r.dir === 'UP' &&
        r.preDelivValRatio !== null &&
        r.preDelivValRatio >= HEAVY_PRE &&
        !(up && r.sym === up.sym && r.start === up.start),
    ),
  );
  return [up, down, heavy].filter(Boolean).map((r) => `${r!.sym}|${r!.dir}|${r!.start}`);
}

describe('case studies on the fixture', () => {
  const picks = pickCaseStudies(rows, rank, LATEST);

  it('the picks follow the rule, computed independently on the same fixture', () => {
    expect(picks.map((p) => `${p.sym}|${p.dir}|${p.start}`)).toEqual(expected(rows, rank, LATEST));
  });

  it('the roles are in order: largest up, largest down, heavy pre-run delivery up', () => {
    expect(picks.map((p) => p.role)).toEqual(
      ['largestUp', 'largestDown', 'heavyPreUp'].slice(0, picks.length),
    );
    expect(picks.length).toBeGreaterThanOrEqual(2);
  });

  it('every pick is a top-200 stock with a run that ended in the last year', () => {
    for (const p of picks) {
      expect(rank.get(p.sym)!).toBeLessThanOrEqual(TOP_N);
      expect(p.end >= oneYearBefore(LATEST)).toBe(true);
    }
  });

  it('the heavy pick has pre-run delivery at least HEAVY_PRE times normal and is not the first up pick', () => {
    const heavy = picks.find((p) => p.role === 'heavyPreUp');
    if (heavy) {
      expect(heavy.preDelivValRatio!).toBeGreaterThanOrEqual(HEAVY_PRE);
      expect(heavy.sym === picks[0]!.sym && heavy.start === picks[0]!.start).toBe(false);
    }
  });

  it('the text is built from the run values, with no stock name written in', () => {
    for (const p of picks) {
      expect(p.text).toContain(String(Math.abs(p.movePct)).slice(0, 2));
      expect(p.text).not.toContain(p.sym);
    }
  });
});

describe('case study rule edge cases (synthetic)', () => {
  const run = (
    sym: string,
    dir: 'UP' | 'DOWN',
    start: string,
    end: string,
    movePct: number,
    pre: number | null,
  ): RunLibRow => ({
    sym,
    dir,
    start,
    end,
    movePct,
    days: 10,
    bucket: 'L',
    sector: 'Power',
    preDelivValRatio: pre,
    preDelivPctChgPp: 0,
    preTurnoverRatio: 1,
    preTradeSizeRatio: 1,
    preDelivBalance: 1,
    preSpikeDays: 0,
    prePriceChgPct: 0,
    earlyDelivValRatio: 1,
    earlyDelivBalance: 1,
  });
  const ranks = new Map<string, number | null>([
    ['TOP', 1],
    ['EDGE', 200],
    ['JUST_OUT', 201],
    ['UNRANKED', null],
  ]);

  it('rank 200 is in, rank 201 is out, unranked is out', () => {
    const rs = [
      run('EDGE', 'UP', '2026-03-01', '2026-04-01', 30, 1),
      run('JUST_OUT', 'UP', '2026-03-01', '2026-04-01', 90, 1),
    ];
    expect(pickCaseStudies(rs, ranks, LATEST).map((p) => p.sym)).toEqual(['EDGE']);
    expect(
      pickCaseStudies([run('UNRANKED', 'UP', '2026-03-01', '2026-04-01', 90, 1)], ranks, LATEST),
    ).toEqual([]);
  });

  it('a run must end on or after one year before the latest day', () => {
    const cut = oneYearBefore(LATEST);
    expect(cut).toBe('2025-11-13');
    const old = run('TOP', 'DOWN', '2025-06-01', '2025-07-01', -50, 1);
    const edge = run('TOP', 'DOWN', '2025-10-01', cut, -25, 1);
    expect(pickCaseStudies([old], ranks, LATEST)).toEqual([]);
    expect(pickCaseStudies([edge], ranks, LATEST).map((p) => p.role)).toEqual(['largestDown']);
  });

  it('the heavy pick excludes a run already picked as the largest up run', () => {
    const big = run('TOP', 'UP', '2026-03-01', '2026-04-01', 80, 5);
    const second = run('EDGE', 'UP', '2026-05-01', '2026-06-01', 40, 3);
    const picks = pickCaseStudies([big, second], ranks, LATEST);
    expect(picks.map((p) => [p.role, p.sym])).toEqual([
      ['largestUp', 'TOP'],
      ['heavyPreUp', 'EDGE'],
    ]);
  });

  it('with no heavy pre-run delivery, only the two largest runs are picked', () => {
    const picks = pickCaseStudies(
      [
        run('TOP', 'UP', '2026-03-01', '2026-04-01', 80, 1),
        run('EDGE', 'DOWN', '2026-05-01', '2026-06-01', -30, 9),
      ],
      ranks,
      LATEST,
    );
    expect(picks.map((p) => p.role)).toEqual(['largestUp', 'largestDown']);
  });

  it('ties on size go to the later start, then the symbol', () => {
    const picks = pickCaseStudies(
      [
        run('TOP', 'UP', '2026-01-01', '2026-02-01', 40, 1),
        run('EDGE', 'UP', '2026-03-01', '2026-04-01', 40, 1),
      ],
      ranks,
      LATEST,
    );
    expect(picks[0]!.sym).toBe('EDGE');
  });
});
