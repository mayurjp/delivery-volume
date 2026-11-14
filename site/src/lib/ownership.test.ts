import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HolderRow, HoldingsAggregateRow, HoldingsFiling, SymbolFile } from '../types/data';
import { rowsToObjects } from './dataClient';
import {
  EXITED_CAVEAT,
  OWNERSHIP_BY_ID,
  aggregateTrend,
  coverageLine,
  dilutionCaveat,
  disclosedFor,
  filingsOf,
  fmtChangePp,
  isDilution,
  movers,
  namedOf,
  ownershipBySym,
  runOwnershipPreset,
  segmentsOf,
  type OwnershipInput,
} from './ownership';

const fx = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/holdings', name), 'utf8')) as T;

const auro = fx<SymbolFile & { sym: string }>('auropharma.json');
const latestDoc = fx<{ columns: string[]; rows: unknown[][] }>('latest.json');
const latest = rowsToObjects<HoldingsFiling>(latestDoc);
const aggs = rowsToObjects<HoldingsAggregateRow>(fx('aggregates.json'));
const holdersDoc = fx<{ columns: string[]; rows: unknown[][] }>('holders-2026-09-30.json');
const holders = rowsToObjects<HolderRow>(holdersDoc);

/** A filing with only the fields a test needs; everything else is a neutral value. */
type Row = OwnershipInput & { sym: string };

function filing(p: Partial<OwnershipInput> & { sym?: string }): Row {
  return {
    sym: 'TEST',
    quarter: '2026-09-30',
    filedOn: '2026-10-14',
    promoterPct: 50,
    fiiPct: 10,
    diiPct: 20,
    mfPct: 10,
    insurancePct: 3,
    retailPct: 10,
    fiiChgPp: 0,
    diiChgPp: 0,
    mfChgPp: 0,
    promoterChgPp: 0,
    sharesChgPct: 0,
    dilutionFlag: false,
    holderCount: 5,
    totalShares: 1000,
    holdingsQuarter: '2026-09-30',
    holdingsFiledOn: '2026-10-14',
    ...p,
  } as Row;
}

describe('caveat text', () => {
  it('dilution: names the share-count change and says the % changes are not pure buying or selling', () => {
    expect(dilutionCaveat(3.456)).toBe(
      'Share count changed by 3.5% this quarter, so % changes are not pure buying or selling',
    );
    expect(dilutionCaveat(-2.4)).toBe(
      'Share count changed by 2.4% this quarter, so % changes are not pure buying or selling',
    );
  });

  it('EXITED: says the filing does not distinguish below 1% from sold out', () => {
    expect(EXITED_CAVEAT).toBe("Below the 1% disclosure line or sold out; the filing doesn't say which");
  });

  it('a dilution flag comes from the flag or from |sharesChgPct| above 2%', () => {
    expect(isDilution({ dilutionFlag: true, sharesChgPct: 0 })).toBe(true);
    expect(isDilution({ dilutionFlag: false, sharesChgPct: 2.5 })).toBe(true);
    expect(isDilution({ dilutionFlag: false, sharesChgPct: -2.5 })).toBe(true);
    expect(isDilution({ dilutionFlag: false, sharesChgPct: 2 })).toBe(false);
    expect(isDilution({ dilutionFlag: null, sharesChgPct: null })).toBe(false);
  });
});

describe('change formatting', () => {
  it('signed percentage points with two decimals, a true minus, and a dash for no value', () => {
    expect(fmtChangePp(1.03)).toBe('+1.03 pp');
    expect(fmtChangePp(-0.68)).toBe('−0.68 pp');
    expect(fmtChangePp(null)).toBe('—');
    expect(fmtChangePp(undefined)).toBe('—');
  });
});

describe('stock filings (AUROPHARMA fixture)', () => {
  it('reads four quarters, oldest first, and the named holders of the latest quarter', () => {
    const f = filingsOf(auro);
    expect(f.map((x) => x.quarter)).toEqual(['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']);
    expect(f[3]!.fiiChgPp).toBe(1.03);
    const named = namedOf(auro);
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((n) => typeof n.holder === 'string')).toBe(true);
  });

  it('segments add up to 100 with the DII split (MF and insurance inside DII)', () => {
    const latestF = filingsOf(auro).at(-1)!;
    const segs = segmentsOf(latestF)!;
    const total = segs.reduce((s, x) => s + x.pct, 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(0.1);
    const byKey = Object.fromEntries(segs.map((s) => [s.key, s.pct]));
    expect(byKey.mf).toBe(latestF.mfPct);
    expect(byKey.insurance).toBe(latestF.insurancePct);
    expect(byKey.otherDii).toBeCloseTo(latestF.diiPct! - latestF.mfPct! - latestF.insurancePct!, 2);
  });

  it('gives no segments when the core groups are missing (no split to draw)', () => {
    expect(segmentsOf(filing({ fiiPct: null }) as unknown as HoldingsFiling)).toBeNull();
  });

  it('an empty holdings block yields no filings and no named holders', () => {
    const empty = {
      sym: 'X',
      holdings: { columns: [], rows: [] },
      namedHolders: { columns: [], rows: [] },
    } as unknown as SymbolFile;
    expect(filingsOf(empty)).toEqual([]);
    expect(namedOf(empty)).toEqual([]);
  });
});

describe('Screener ownership presets', () => {
  const rows: Row[] = [
    filing({ sym: 'UP2', fiiChgPp: 2 }),
    filing({ sym: 'UP05', fiiChgPp: 0.4 }),
    filing({ sym: 'DOWN', fiiChgPp: -1.5 }),
    filing({ sym: 'DILUTED', fiiChgPp: 3, sharesChgPct: 4, dilutionFlag: true }),
    filing({ sym: 'NONE', fiiChgPp: null, diiChgPp: null }),
  ];
  const run = (id: string, rs: Row[] = rows) => runOwnershipPreset(OWNERSHIP_BY_ID.get(id)!, rs);

  it('FII stake up: rises only, largest first, and leaves out diluted stocks and stocks with no filing', () => {
    expect(run('fiiUp').map((r) => r.sym)).toEqual(['UP2', 'UP05']);
  });

  it('the combined FII + DII preset needs more than 0.5 pp together', () => {
    const rs = [
      filing({ sym: 'A', fiiChgPp: 0.3, diiChgPp: 0.3 }),
      filing({ sym: 'B', fiiChgPp: 0.2, diiChgPp: 0.2 }),
    ];
    expect(run('fiiDiiUp', rs).map((r) => r.sym)).toEqual(['A']);
  });

  it('handover: FII down by at least 1 pp while DII up by at least 1 pp, not the reverse', () => {
    const rs = [
      filing({ sym: 'HAND', fiiChgPp: -1, diiChgPp: 1 }),
      filing({ sym: 'NEAR', fiiChgPp: -0.9, diiChgPp: 1 }),
      filing({ sym: 'REV', fiiChgPp: 1, diiChgPp: -1 }),
    ];
    expect(run('handover', rs).map((r) => r.sym)).toEqual(['HAND']);
  });

  it('promoter fell: only falls, and the largest fall first', () => {
    const rs = [
      filing({ sym: 'P1', promoterChgPp: -0.4 }),
      filing({ sym: 'P2', promoterChgPp: -2 }),
      filing({ sym: 'P0', promoterChgPp: 0 }),
    ];
    expect(run('promoterDown', rs).map((r) => r.sym)).toEqual(['P2', 'P1']);
  });

  it('delivery spike + FII up needs spike at least 2 and an FII rise', () => {
    const rs: Row[] = [
      filing({ sym: 'BOTH', fiiChgPp: 0.5, spike: 2.5 }),
      filing({ sym: 'SPIKE_ONLY', fiiChgPp: -0.5, spike: 3 }),
      filing({ sym: 'WEAK', fiiChgPp: 0.5, spike: 1.5 }),
    ];
    expect(run('spikeFii', rs).map((r) => r.sym)).toEqual(['BOTH']);
  });

  it('MF raised uses the MF change', () => {
    const rs = [filing({ sym: 'M', mfChgPp: 0.2 }), filing({ sym: 'N', mfChgPp: -0.2 })];
    expect(run('mfUp', rs).map((r) => r.sym)).toEqual(['M']);
  });

  it('every ownership preset explains itself, and says when it is a ranking rather than an event', () => {
    for (const p of OWNERSHIP_BY_ID.values()) {
      expect(p.explain.length).toBeGreaterThan(20);
      expect(p.explain).toMatch(/ranking|not an event/);
    }
  });

  it('joins the fixture latest.json by symbol and runs the FII preset on it', () => {
    const map = ownershipBySym(latest);
    expect(map.get('AUROPHARMA')!.holdingsQuarter).toBe('2026-09-30');
    expect(map.get('AUROPHARMA')!.fiiChgPp).toBe(1.03);
    const joined = [...map.entries()].map(([sym, o]) => ({ sym, ...o }));
    const got = run('fiiUp', joined).map((r) => r.sym);
    expect(got[0]).toBe('AUROPHARMA');
    expect(got).not.toContain('GESHIP');
  });
});

describe('Institutions movers', () => {
  it('largest FII rises and falls from the fixture, excluding diluted stocks', () => {
    const m = movers(latest, 'fiiChgPp');
    expect(m.up[0]!.sym).toBe('AUROPHARMA');
    expect(m.down[0]!.sym).toBe('GESHIP');
    expect(m.excludedDilution).toBe(0);
  });

  it('leaves diluted stocks out and counts them', () => {
    const rs = [
      filing({ sym: 'A', fiiChgPp: 2 }),
      filing({ sym: 'B', fiiChgPp: 5, sharesChgPct: 6, dilutionFlag: true }),
      filing({ sym: 'C', fiiChgPp: -1 }),
    ];
    const m = movers(rs as unknown as HoldingsFiling[], 'fiiChgPp');
    expect(m.up.map((r) => r.sym)).toEqual(['A']);
    expect(m.down.map((r) => r.sym)).toEqual(['C']);
    expect(m.eligible).toBe(3);
    expect(m.excludedDilution).toBe(1);
  });
});

describe('group trend and coverage', () => {
  it('the ALL group is one row per quarter, oldest first', () => {
    const t = aggregateTrend(aggs, 'ALL');
    expect(t.map((r) => r.quarter)).toEqual(['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']);
    expect(t.every((r) => r.n === 19)).toBe(true);
  });

  it('the coverage line names the filed and universe counts', () => {
    expect(coverageLine(19, 2970, '2026-09-30')).toBe(
      'Holdings stored for 19 of 2970 companies (quarter 2026-09-30).',
    );
    expect(coverageLine(0, 2970, null)).toBe('Holdings stored for 0 of 2970 companies.');
  });
});

describe('entity disclosed holdings', () => {
  it('lists every stock where the entity is a named holder above 1%, latest quarter first, largest first', () => {
    const rows = disclosedFor('hdfc-mf', [{ quarter: '2026-09-30', rows: holders }]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => typeof r.pct === 'number' && r.pct > 1)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.pct).toBeGreaterThanOrEqual(rows[i]!.pct);
  });

  it('leaves EXITED rows (no current percentage) out and returns nothing for an unknown entity', () => {
    expect(
      disclosedFor('hdfc-mf', [{ quarter: '2026-09-30', rows: holders }]).some((r) => r.chg === 'EXITED'),
    ).toBe(false);
    expect(disclosedFor('no-such-entity', [{ quarter: '2026-09-30', rows: holders }])).toEqual([]);
  });

  it('orders the quarters newest first across files', () => {
    const rows = disclosedFor('hdfc-mf', [
      { quarter: '2026-06-30', rows: holders },
      { quarter: '2026-09-30', rows: holders },
    ]);
    expect(rows[0]!.quarter).toBe('2026-09-30');
    expect(rows.at(-1)!.quarter).toBe('2026-06-30');
  });
});
