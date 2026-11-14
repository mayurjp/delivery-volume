import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOOT_KEYS, footprintIndicators, footprintSeries, type FootRec } from './footprints';

interface Vectors {
  cases: { name: string; records: FootRec[]; expected: Record<string, number | null> }[];
}
const vectors: Vectors = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/lib/footprintVectors.json'), 'utf8'),
) as Vectors;

describe('footprint twin matches pipeline/footprints.py on the shared vectors', () => {
  for (const c of vectors.cases) {
    it(`case ${c.name}`, () => {
      const got = footprintIndicators(c.records);
      for (const k of Object.keys(c.expected)) {
        expect(got[k as keyof typeof got], `${c.name}.${k}`).toBe(c.expected[k]);
      }
    });
  }

  it('covers every indicator key', () => {
    expect(FOOT_KEYS.every((k) => k in vectors.cases[0]!.expected)).toBe(true);
  });
});

describe('footprintIndicators edge cases', () => {
  it('returns nulls for an empty history', () => {
    const out = footprintIndicators([]);
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });

  it('ignores days without delivery data', () => {
    const base = vectors.cases[0]!.records;
    const withGap: FootRec[] = [
      { close: 10, prevClose: 9, turnoverCr: null, trades: null, delivValCr: null },
      ...base,
    ];
    expect(footprintIndicators(withGap)).toEqual(footprintIndicators(base));
  });
});

describe('footprintSeries', () => {
  it('ends on the same values as footprintIndicators and is null on days without delivery data', () => {
    const recs = vectors.cases[0]!.records;
    const series = footprintSeries([
      ...recs,
      { close: 1, prevClose: 1, turnoverCr: null, trades: null, delivValCr: null },
    ]);
    expect(series).toHaveLength(recs.length + 1);
    expect(series[recs.length - 1]).toEqual(footprintIndicators(recs));
    expect(series[recs.length]!.delivBal60).toBeNull();
  });
});
