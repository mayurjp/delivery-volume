import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrailDoc, TrailPerfDoc, TrailPerfRow, UniverseRow } from '../types/data';
import { rowsToObjects } from './dataClient';
import { holdSeries, holdingsOf, type TrailCfg } from './trail';
import {
  HOLD_RISE_PP,
  buildInsights,
  filterEntries,
  historyLine,
  leansA,
  leansD,
  narrative,
  parseTrail,
  perfRow,
  rankLists,
  sectorGrid,
  sectorMedian,
  sectorRotation,
} from './trailView';

const fx = (f: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/trail', f), 'utf8'));
const doc = fx('latest.json') as TrailDoc;
const perfDoc = fx('perf.json') as TrailPerfDoc;
const uniDoc = fx('universe.json') as { columns: string[]; rows: unknown[][] };
const perf = rowsToObjects<TrailPerfRow>(perfDoc);
const universe = rowsToObjects<UniverseRow>(uniDoc);
const bySym = new Map(universe.map((u) => [u.sym, u]));
const entries = parseTrail(doc);
const INDICES = ['NIFTY50', 'NIFTYNEXT50', 'NIFTY100', 'NIFTY200', 'NIFTY500'];

describe('lists', () => {
  const l = rankLists(entries, '6M', 25);
  it('ranks the strongest A and D by count, then consistency, and flips newest first', () => {
    expect(l.strongA.length).toBeGreaterThan(0);
    for (let i = 1; i < l.strongA.length; i++) {
      const a = l.strongA[i - 1]!.w['6M']!;
      const b = l.strongA[i]!.w['6M']!;
      expect(a.A > b.A || (a.A === b.A && (a.consA ?? -1) >= (b.consA ?? -1))).toBe(true);
    }
    expect(l.strongA.every((e) => leansA(e.w['6M']!)) && l.strongD.every((e) => leansD(e.w['6M']!))).toBe(
      true,
    );
    const since = l.flips.map((e) => e.w['6M']!.flipSince ?? '');
    expect([...since].sort().reverse()).toEqual(since);
    expect(l.flips.every((e) => e.w['6M']!.flip !== null)).toBe(true);
  });
  it('filters by universe and sector', () => {
    const all = filterEntries(entries, bySym, { u: 'ALL', sector: null }, INDICES);
    const sec = all[0] && bySym.get(all[0].sym)!.sector;
    const one = filterEntries(entries, bySym, { u: 'NIFTY500', sector: sec ?? null }, INDICES);
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((e) => bySym.get(e.sym)!.sector === sec)).toBe(true);
  });
});

describe('sector rotation', () => {
  const rot = sectorRotation(entries, bySym, '6M');
  it('counts match the entries and the balance is value weighted', () => {
    expect(rot.reduce((s, r) => s + r.n, 0)).toBe(
      entries.filter((e) => e.w['6M'] && bySym.has(e.sym)).length,
    );
    const r0 = rot[0]!;
    const members = entries.filter((e) => bySym.get(e.sym)!.sector === r0.sector && e.w['6M']);
    expect(r0.nA).toBe(members.filter((e) => leansA(e.w['6M']!)).length);
    const up = members.reduce((s, e) => s + (e.w['6M']!.upCr ?? 0), 0);
    const dn = members.reduce((s, e) => s + (e.w['6M']!.dnCr ?? 0), 0);
    expect(r0.balance).toBeCloseTo(up / dn, 10);
    expect([...rot].sort((a, b) => b.netPp - a.netPp || a.sector.localeCompare(b.sector))).toEqual(rot);
  });
  it('builds a sector x week grid of net shares', () => {
    const g = sectorGrid(
      entries,
      bySym,
      26,
      rot.map((r) => r.sector),
    );
    expect(g.cells.length).toBe(g.sectors.length);
    expect(g.cells.every((row) => row.length === 26)).toBe(true);
    const flat = g.cells.flat().filter((x): x is number => x !== null);
    expect(flat.every((x) => x >= -100 && x <= 100)).toBe(true);
  });
});

describe('insight templates', () => {
  const ctx = { win: '6M' as const, universeLabel: 'Nifty 500', sectorLabel: null, perf, minN: 30 };
  const ins = buildInsights(entries, bySym, ctx);
  const byId = new Map(ins.map((i) => [i.id, i]));
  it('produces 5 to 10 sentences', () => {
    expect(ins.length).toBeGreaterThanOrEqual(5);
    expect(ins.length).toBeLessThanOrEqual(10);
  });
  it('every number equals its source statistic', () => {
    const w = (e: (typeof entries)[number]) => e.w['6M'];
    const withW = entries.filter((e) => w(e));
    const a3 = withW.filter((e) => w(e)!.A >= 3);
    expect(byId.get('strongA')!.numbers.count).toBe(a3.length);
    expect(byId.get('strongA')!.syms).toEqual(a3.map((e) => e.sym));
    expect(byId.get('strongA')!.text.startsWith(`${a3.length} Nifty 500 `)).toBe(true);
    const d3 = withW.filter((e) => w(e)!.D >= 3);
    expect(byId.get('strongD')!.numbers.count).toBe(d3.length);
    const ad = withW.filter((e) => w(e)!.flip === 'A→D').length;
    const da = withW.filter((e) => w(e)!.flip === 'D→A').length;
    const fl = byId.get('flips')!;
    expect(fl.numbers).toEqual({ ad, da });
    expect(fl.text).toContain(`${ad} Nifty 500`);
    expect(fl.text).toContain(`and ${da} moved`);
    const pa = withW.filter((e) => (w(e)!.consA ?? 0) >= 60).length;
    const pd = withW.filter((e) => (w(e)!.consD ?? 0) >= 60).length;
    expect(byId.get('persistent')!.numbers).toEqual({ a: pa, d: pd });
    const rot = sectorRotation(entries, bySym, '6M').filter((s) => s.n >= 5);
    if (rot.length >= 2) {
      const top = rot[0]!;
      const sn = byId.get('sectorNet')!;
      expect(sn.numbers).toMatchObject({ topN: top.n, topA: top.nA, topD: top.nD });
      expect(sn.text).toContain(
        `${top.sector} (${top.nA} of ${top.n} stocks leaning A, ${top.nD} leaning D)`,
      );
    }
    const lastA = withW.filter((e) => e.strip.at(-1) === 'A' && e.strip.at(-2) !== 'A').length;
    expect(byId.get('latestWeek')!.numbers.toA).toBe(lastA);
    const h = byId.get('history');
    expect(h).toBeDefined();
    const a = perfRow(perf, 'list', 'strongA', '6M', 60)!;
    expect(h!.numbers).toMatchObject({ a: a.medianExcess, nA: a.n });
    expect(h!.text).toContain(`n ${a.n}`);
  });
  it('every insight links to rows that exist', () => {
    for (const i of ins) for (const s of i.syms) expect(bySym.has(s)).toBe(true);
  });
  it('are deterministic', () => {
    expect(buildInsights(entries, bySym, ctx)).toEqual(ins);
  });
});

describe('history lines and narrative', () => {
  it('quote the track-record file exactly and hide thin cells', () => {
    const r60 = perfRow(perf, 'list', 'strongA', '6M', 60)!;
    const r120 = perfRow(perf, 'list', 'strongA', '6M', 120)!;
    const line = historyLine(perf, 'list', 'strongA', '6M');
    expect(line).toContain(`n ${r60.n}`);
    expect(line).toContain(`n ${r120.n}`);
    expect(line.startsWith('Historically: 60 days')).toBe(true);
    const thin = perf.map((r) => ({ ...r, n: 5 }));
    expect(historyLine(thin, 'list', 'strongA', '6M')).toContain('too few cases (n 5)');
    // many overlapping cases from few month-ends (the deals indicator in 2026) are hidden too
    const fewDates = perf.map((r) => ({ ...r, n: 500, dates: 3 }));
    expect(historyLine(fewDates, 'list', 'strongA', '6M')).toContain('too few dates (3 month-ends)');
    expect(historyLine(fewDates, 'list', 'strongA', '6M')).not.toContain('median excess');
  });
  it('writes 3 to 5 sentences whose numbers come from the window record', () => {
    const e = entries.find((x) => x.w['6M'] && x.w['6M'].spikeDays !== null && x.w['6M'].consA !== null)!;
    const v = e.w['6M']!;
    const s = narrative(v, '6M', 26);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(5);
    expect(s.join(' ')).toContain(`${v.spikeDays} delivery-spike`);
    expect(s.join(' ')).toContain(`${v.consA}% of the last 26 weeks`);
  });
  it('compares a stock with its sector median', () => {
    const sec = bySym.get(entries[0]!.sym)!.sector;
    const m = sectorMedian(entries, bySym, sec, '6M')!;
    expect(m.n).toBe(entries.filter((e) => bySym.get(e.sym)!.sector === sec && e.w['6M']).length);
    expect(m.shareA + m.shareD).toBeLessThanOrEqual(100);
  });
});

// ---- named deals in the trail views (Phase 4): the sector flows and the "via deals" insight ----------------------------

describe('named deals in the trail views', () => {
  const win = '3M' as const;
  const ctx = { win, universeLabel: 'Nifty 500', sectorLabel: null, perf, minN: 30 };

  it('each sector row sums the window deal flows of its own stocks, and nothing else', () => {
    const rot = sectorRotation(entries, bySym, win);
    expect(rot.length).toBeGreaterThan(0);
    for (const r of rot) {
      const mine = entries.filter((e) => bySym.get(e.sym)?.sector === r.sector && e.w[win]);
      const fii = mine.reduce((t, e) => t + (e.w[win]!.dealsFii ?? 0), 0);
      const dii = mine.reduce((t, e) => t + (e.w[win]!.dealsDii ?? 0), 0);
      expect(r.fiiDeals).toBeCloseTo(Math.round(fii * 100) / 100, 1);
      expect(r.diiDeals).toBeCloseTo(Math.round(dii * 100) / 100, 1);
    }
  });

  it('the via-deals insight quotes exactly the sector numbers it is built from', () => {
    const rot = sectorRotation(entries, bySym, win);
    // the insight's rule: among sectors with FII net below zero and DII net above zero, the most negative FII flow
    const want = rot
      .filter((r) => r.fiiDeals !== null && r.diiDeals !== null && r.fiiDeals < 0 && r.diiDeals > 0)
      .sort((a, b) => a.fiiDeals! - b.fiiDeals!)[0];
    const ins = buildInsights(entries, bySym, ctx).find((i) => i.id === 'dealsSector');
    if (!want) {
      expect(ins).toBeUndefined();
      return;
    }
    expect(ins).toBeDefined();
    expect(ins!.text).toContain(
      `FIIs net sold ₹${Math.round(-want.fiiDeals!).toLocaleString('en-IN')} Cr in ${want.sector}`,
    );
    expect(ins!.text).toContain(`DIIs bought ₹${Math.round(want.diiDeals!).toLocaleString('en-IN')} Cr`);
    expect(ins!.numbers.fii).toBe(want.fiiDeals);
    expect(ins!.numbers.dii).toBe(want.diiDeals);
  });

  it('the list insights count indicators out of the eight the trail computes', () => {
    const texts = buildInsights(entries, bySym, ctx)
      .map((i) => i.text)
      .join(' ');
    expect(texts).toContain('of 8');
    expect(texts).not.toContain('of 5 ');
    expect(texts).not.toContain('Phase 4B');
  });
});

// ---- holdings in the trail views (Phase 4B) ---------------------------------------------------------------------------

describe('holdings in the trail views', () => {
  const win = '6M' as const;
  const ctx = { win, universeLabel: 'Nifty 500', sectorLabel: null, perf, minN: 30 };
  const cfg = doc.config as unknown as TrailCfg;

  it('the holdings insight counts the stocks whose FII + DII holdings rose by more than 0.5 pp, as the window records say', () => {
    const withHold = entries.filter((e) => e.w[win] && e.w[win]!.holdInstPp !== null);
    const rose = withHold.filter((e) => e.w[win]!.holdInstPp! > HOLD_RISE_PP);
    const ins = buildInsights(entries, bySym, ctx).find((i) => i.id === 'holdings');
    if (withHold.length === 0) {
      expect(ins).toBeUndefined();
      return;
    }
    expect(ins).toBeDefined();
    expect(ins!.numbers).toMatchObject({ count: rose.length, of: withHold.length });
    expect(ins!.syms).toEqual(rose.map((e) => e.sym));
    expect(ins!.text).toContain(
      `rose by more than 0.5 pp in ${rose.length} Nifty 500 ${rose.length === 1 ? 'stock' : 'stocks'} (of ${withHold.length}`,
    );
  });

  it('the holdings history line quotes the holdings indicator row, and says too few dates while the history is short', () => {
    const line = historyLine(perf, 'indicator', 'holdInst:A', win);
    expect(line.startsWith('Historically:')).toBe(true);
    const fewDates = perf.map((r) => ({ ...r, n: 500, dates: 3 }));
    expect(historyLine(fewDates, 'indicator', 'holdInst:A', win)).toContain('too few dates (3 month-ends)');
  });

  it('a stock with no holdings stored has every holdings code missing and no change', () => {
    const days = ['2025-07-01', '2025-07-02'];
    const none = holdSeries(holdingsOf(undefined), days, cfg);
    expect(none.codes).toEqual([
      [9, 9],
      [9, 9],
    ]);
    expect(none.pp).toEqual([
      [null, null],
      [null, null],
    ]);
    const empty = holdingsOf({
      columns: ['quarter', 'filedOn', 'promoterPct', 'fiiPct', 'diiPct', 'mfPct'],
      rows: [],
    });
    expect(empty).toEqual({ quarters: [], filings: [] });
    expect(holdSeries(empty, days, cfg).codes).toEqual([
      [9, 9],
      [9, 9],
    ]);
  });
});
