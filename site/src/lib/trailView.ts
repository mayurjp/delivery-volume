/**
 * The Smart Money Trail views (07 section 6A): list ranking, sector rotation, deterministic insight templates,
 * "Historically" lines and stock narrative sentences. Pure functions over trail/latest.json rows, so every number a
 * sentence shows can be checked against the statistic it came from (see trailView.test.ts).
 *
 * Wording: descriptive and past tense only. Never an instruction, never a rating (05 section 8).
 */

import type { TrailDoc, TrailPerfRow, UniverseRow } from '../types/data';
import { fmtDate, fmtPp, fmtPct, fmtPctChg, fmtRatio } from './format';
import { universeBit } from './filters';
import { WINDOWS, windowView, type WindowName, type WindowRec, type WindowView } from './trail';

export interface TrailEntry {
  sym: string;
  strip: string;
  w: Record<WindowName, WindowView | null>;
}

export const WINDOW_LABEL: Record<WindowName, string> = {
  '3M': '3 months',
  '6M': '6 months',
  '1Y': '1 year',
};
export const EVIDENCE_LABEL = 'Evidence summary, not advice. You decide.';
export const HISTORICAL_LABEL = 'Historical, not a prediction.';

export function parseTrail(doc: TrailDoc): TrailEntry[] {
  return doc.rows.map((r) => {
    const w = {} as Record<WindowName, WindowView | null>;
    WINDOWS.forEach((name, i) => {
      const rec = r[2 + i] as WindowRec | null;
      w[name] = rec ? windowView(rec) : null;
    });
    return { sym: r[0], strip: r[1], w };
  });
}

// ---- universe, lists ------------------------------------------------------------------------------------------------

export interface TrailFilter {
  /** An index key such as NIFTY500, or ALL. */
  u: string;
  sector: string | null;
}

export const TRAIL_UNIVERSES = [
  { key: 'NIFTY500', label: 'Nifty 500' },
  { key: 'NIFTY200', label: 'Nifty 200' },
  { key: 'NIFTY100', label: 'Nifty 100' },
  { key: 'TOTALMARKET', label: 'Total Market' },
  { key: 'ALL', label: 'All eligible stocks' },
];

export function filterEntries(
  entries: readonly TrailEntry[],
  bySym: ReadonlyMap<string, UniverseRow>,
  f: TrailFilter,
  indices: readonly string[],
): TrailEntry[] {
  const bit = universeBit(f.u, indices);
  return entries.filter((e) => {
    const u = bySym.get(e.sym);
    if (!u || u.etf) return false;
    if (bit !== null && (u.idx & bit) === 0) return false;
    return f.sector === null || u.sector === f.sector;
  });
}

export const leansA = (v: WindowView): boolean => v.A >= 2 && v.A > v.D;
export const leansD = (v: WindowView): boolean => v.D >= 2 && v.D > v.A;

export interface Lists {
  strongA: TrailEntry[];
  strongD: TrailEntry[];
  flips: TrailEntry[];
}

/** Strongest A / D: ranked by the indicator count, then consistency, then symbol. Flips: newest first. */
export function rankLists(entries: readonly TrailEntry[], win: WindowName, size: number): Lists {
  const withW = entries.flatMap((e) => (e.w[win] ? [{ e, v: e.w[win]! }] : []));
  const rank = (key: 'A' | 'D') =>
    withW
      .filter((x) => (key === 'A' ? leansA(x.v) : leansD(x.v)))
      .sort(
        (a, b) =>
          b.v[key] - a.v[key] ||
          (key === 'A' ? (b.v.consA ?? -1) - (a.v.consA ?? -1) : (b.v.consD ?? -1) - (a.v.consD ?? -1)) ||
          a.e.sym.localeCompare(b.e.sym),
      )
      .slice(0, size)
      .map((x) => x.e);
  const flips = withW
    .filter((x) => x.v.flip !== null)
    .sort(
      (a, b) => (b.v.flipSince ?? '').localeCompare(a.v.flipSince ?? '') || a.e.sym.localeCompare(b.e.sym),
    )
    .map((x) => x.e);
  return { strongA: rank('A'), strongD: rank('D'), flips };
}

// ---- sector rotation ------------------------------------------------------------------------------------------------

export interface SectorRow {
  sector: string;
  n: number;
  nA: number;
  nD: number;
  /** Share of stocks leaning A minus the share leaning D, in percentage points. */
  netPp: number;
  /** Value-weighted delivery balance: sum of delivery value on up days / on down days over the sector's stocks. */
  balance: number | null;
  flipsAD: number;
  flipsDA: number;
}

export function sectorRotation(
  entries: readonly TrailEntry[],
  bySym: ReadonlyMap<string, UniverseRow>,
  win: WindowName,
): SectorRow[] {
  const acc = new Map<
    string,
    { n: number; nA: number; nD: number; up: number; dn: number; ad: number; da: number }
  >();
  for (const e of entries) {
    const v = e.w[win];
    const sec = bySym.get(e.sym)?.sector;
    if (!v || !sec) continue;
    const a = acc.get(sec) ?? { n: 0, nA: 0, nD: 0, up: 0, dn: 0, ad: 0, da: 0 };
    a.n++;
    if (leansA(v)) a.nA++;
    if (leansD(v)) a.nD++;
    a.up += v.upCr ?? 0;
    a.dn += v.dnCr ?? 0;
    if (v.flip === 'A→D') a.ad++;
    if (v.flip === 'D→A') a.da++;
    acc.set(sec, a);
  }
  return [...acc.entries()]
    .map(([sector, a]) => ({
      sector,
      n: a.n,
      nA: a.nA,
      nD: a.nD,
      netPp: ((a.nA - a.nD) / a.n) * 100,
      balance: a.dn > 0 ? a.up / a.dn : null,
      flipsAD: a.ad,
      flipsDA: a.da,
    }))
    .sort((x, y) => y.netPp - x.netPp || x.sector.localeCompare(y.sector));
}

export interface SectorGrid {
  sectors: string[];
  /** Per sector and strip position: share of its stocks coded A minus the share coded D, in percentage points (null = no coded stock). */
  cells: (number | null)[][];
}

/** The sector x week grid from the weekly strips (the last `weeks` weeks). */
export function sectorGrid(
  entries: readonly TrailEntry[],
  bySym: ReadonlyMap<string, UniverseRow>,
  weeks: number,
  order: readonly string[],
): SectorGrid {
  const acc = new Map<string, { a: number[]; d: number[]; n: number[] }>();
  for (const e of entries) {
    const sec = bySym.get(e.sym)?.sector;
    if (!sec) continue;
    const s = e.strip.slice(-weeks);
    const g = acc.get(sec) ?? {
      a: new Array<number>(weeks).fill(0),
      d: new Array<number>(weeks).fill(0),
      n: new Array<number>(weeks).fill(0),
    };
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '-') continue;
      g.n[i]!++;
      if (c === 'A') g.a[i]!++;
      if (c === 'D') g.d[i]!++;
    }
    acc.set(sec, g);
  }
  const sectors = order.filter((s) => acc.has(s));
  return {
    sectors,
    cells: sectors.map((s) => {
      const g = acc.get(s)!;
      return g.n.map((n, i) => (n > 0 ? ((g.a[i]! - g.d[i]!) / n) * 100 : null));
    }),
  };
}

// ---- track record lines ---------------------------------------------------------------------------------------------

export interface PerfLookup {
  rows: readonly TrailPerfRow[];
  minN: number;
}

export function perfRow(
  rows: readonly TrailPerfRow[],
  kind: 'list' | 'indicator',
  id: string,
  win: WindowName,
  horizon: number,
): TrailPerfRow | undefined {
  return rows.find((r) => r.kind === kind && r.id === id && r.window === win && r.horizon === horizon);
}

/** "Historically: 60 days +1.5% median excess, 54% hit rate (n 437); 120 days ..." read from stats/trail_perf.json. */
export function historyLine(
  rows: readonly TrailPerfRow[] | null,
  kind: 'list' | 'indicator',
  id: string,
  win: WindowName,
  minN = 30,
  horizons: readonly number[] = [60, 120],
): string {
  if (!rows) return 'Historically: loading.';
  const parts: string[] = [];
  for (const h of horizons) {
    const r = perfRow(rows, kind, id, win, h);
    if (!r || r.n < minN || r.medianExcess === null || r.hitRate === null) {
      parts.push(`${h} days: too few cases${r ? ` (n ${r.n})` : ''}`);
    } else {
      parts.push(
        `${h} days ${fmtPctChg(r.medianExcess, 1)} median excess, ${fmtPct(r.hitRate, 0)} hit rate (n ${r.n})`,
      );
    }
  }
  return `Historically: ${parts.join('; ')}. ${HISTORICAL_LABEL}`;
}

// ---- insights -------------------------------------------------------------------------------------------------------

export interface Insight {
  id: string;
  text: string;
  /** The symbols behind the sentence (its count is the number in the text). */
  syms: string[];
  /** The statistics the sentence quotes, by name (tested against the sentence). */
  numbers: Record<string, number>;
}

export interface InsightCtx {
  win: WindowName;
  universeLabel: string;
  sectorLabel: string | null;
  perf: readonly TrailPerfRow[] | null;
  minN: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function topSectors(syms: readonly string[], bySym: ReadonlyMap<string, UniverseRow>, k: number) {
  const c = new Map<string, number>();
  for (const s of syms) {
    const sec = bySym.get(s)?.sector;
    if (sec) c.set(sec, (c.get(sec) ?? 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k);
}

/** 5 to 10 plain sentences generated from the computed statistics by templates (no model). */
export function buildInsights(
  entries: readonly TrailEntry[],
  bySym: ReadonlyMap<string, UniverseRow>,
  ctx: InsightCtx,
): Insight[] {
  const { win } = ctx;
  const wl = WINDOW_LABEL[win];
  const scope = ctx.sectorLabel ? `${ctx.universeLabel} ${ctx.sectorLabel}` : ctx.universeLabel;
  const withW = entries.flatMap((e) => (e.w[win] ? [{ e, v: e.w[win]! }] : []));
  const out: Insight[] = [];
  if (withW.length === 0) return out;

  const strongA = withW.filter((x) => x.v.A >= 3).map((x) => x.e.sym);
  const strongD = withW.filter((x) => x.v.D >= 3).map((x) => x.e.sym);
  const listIns = (id: string, syms: string[], what: string) => {
    const tops = topSectors(syms, bySym, 2);
    const where =
      !ctx.sectorLabel && tops.length
        ? `; most are in ${tops.map(([s, k]) => `${s} (${k})`).join(' and ')}`
        : '';
    out.push({
      id,
      syms,
      text: `${syms.length} ${scope} ${plural(syms.length, 'stock shows', 'stocks show')} at least 3 of 4 ${what} footprints over ${wl}${where}.`,
      numbers: { count: syms.length, ...(tops[0] ? { top1: tops[0][1] } : {}) },
    });
  };
  listIns('strongA', strongA, 'accumulation');
  listIns('strongD', strongD, 'distribution');

  const ad = withW.filter((x) => x.v.flip === 'A→D').map((x) => x.e.sym);
  const da = withW.filter((x) => x.v.flip === 'D→A').map((x) => x.e.sym);
  out.push({
    id: 'flips',
    syms: [...ad, ...da],
    text: `${ad.length} ${scope} ${plural(ad.length, 'stock', 'stocks')} moved from an accumulation to a distribution lean in the last 6 weeks (${wl} window), and ${da.length} moved the other way.`,
    numbers: { ad: ad.length, da: da.length },
  });

  const rot = sectorRotation(entries, bySym, win).filter((s) => s.n >= 5);
  if (!ctx.sectorLabel && rot.length >= 2) {
    const top = rot[0]!;
    const bot = rot[rot.length - 1]!;
    out.push({
      id: 'sectorNet',
      syms: entries.filter((e) => bySym.get(e.sym)?.sector === top.sector).map((e) => e.sym),
      text: `Over ${wl}, accumulation footprints led in ${top.sector} (${top.nA} of ${top.n} stocks leaning A, ${top.nD} leaning D); distribution footprints led in ${bot.sector} (${bot.nD} of ${bot.n} leaning D, ${bot.nA} leaning A).`,
      numbers: { topN: top.n, topA: top.nA, topD: top.nD, botN: bot.n, botA: bot.nA, botD: bot.nD },
    });
    const withBal = rot.filter((s) => s.balance !== null).sort((a, b) => b.balance! - a.balance!);
    if (withBal.length) {
      const b = withBal[0]!;
      out.push({
        id: 'sectorBalance',
        syms: entries.filter((e) => bySym.get(e.sym)?.sector === b.sector).map((e) => e.sym),
        text: `${b.sector} had the highest value-weighted delivery balance over ${wl}: delivery value on up days was ${fmtRatio(b.balance, 2)} that on down days.`,
        numbers: { balance: Math.round(b.balance! * 100) / 100 },
      });
    }
  }

  const persistentA = withW.filter((x) => (x.v.consA ?? 0) >= 60).map((x) => x.e.sym);
  const persistentD = withW.filter((x) => (x.v.consD ?? 0) >= 60).map((x) => x.e.sym);
  out.push({
    id: 'persistent',
    syms: [...persistentA, ...persistentD],
    text: `${persistentA.length} ${scope} ${plural(persistentA.length, 'stock was', 'stocks were')} coded A in at least 60% of the weeks over ${wl}, and ${persistentD.length} ${plural(persistentD.length, 'was', 'were')} coded D in at least 60%.`,
    numbers: { a: persistentA.length, d: persistentD.length },
  });

  const toA = withW
    .filter((x) => x.e.strip.slice(-1) === 'A' && x.e.strip.slice(-2, -1) !== 'A')
    .map((x) => x.e.sym);
  const toD = withW
    .filter((x) => x.e.strip.slice(-1) === 'D' && x.e.strip.slice(-2, -1) !== 'D')
    .map((x) => x.e.sym);
  out.push({
    id: 'latestWeek',
    syms: [...toA, ...toD],
    text: `In the latest week ${toA.length} ${scope} ${plural(toA.length, 'stock was', 'stocks were')} coded A after a week that was not A, and ${toD.length} ${plural(toD.length, 'was', 'were')} coded D after a week that was not D.`,
    numbers: { toA: toA.length, toD: toD.length },
  });

  if (ctx.perf) {
    const a = perfRow(ctx.perf, 'list', 'strongA', win, 60);
    const d = perfRow(ctx.perf, 'list', 'strongD', win, 60);
    if (a && d && a.n >= ctx.minN && d.n >= ctx.minN && a.medianExcess !== null && d.medianExcess !== null) {
      out.push({
        id: 'history',
        syms: [],
        text: `Historically (Nifty 500, ${wl} window), the strongest-A list's 60-day median excess return was ${fmtPctChg(a.medianExcess, 1)} (n ${a.n}) and the strongest-D list's was ${fmtPctChg(d.medianExcess, 1)} (n ${d.n}). ${HISTORICAL_LABEL}`,
        numbers: { a: a.medianExcess, d: d.medianExcess, nA: a.n, nD: d.n },
      });
    }
  }
  out.push({
    id: 'slots',
    syms: [],
    text: 'Named deals, holdings and F&O footprints arrive in Phase 4, 4B and 5; until then the trail reads delivery footprints only.',
    numbers: {},
  });
  return out.slice(0, 10);
}

// ---- stock mode -----------------------------------------------------------------------------------------------------

/** 3 to 5 template sentences for one stock and window (descriptive, past tense). */
export function narrative(v: WindowView | null, win: WindowName, weeksInWindow: number): string[] {
  if (!v) return ['Not enough history yet to read this stock’s trail.'];
  const wl = WINDOW_LABEL[win];
  const out: string[] = [];
  if (v.delivBal !== null)
    out.push(
      `Over ${wl}, delivery value on up days was ${fmtRatio(v.delivBal, 2)} that on down days (${v.codes[0] === 'A' ? 'heavier on up days' : v.codes[0] === 'D' ? 'heavier on down days' : 'roughly balanced'}).`,
    );
  if (v.delivPctTrend !== null && v.tradeSizeTrend !== null)
    out.push(
      `Delivery % was ${fmtPp(v.delivPctTrend, 1)} against its own baseline and average trade size was ${fmtPctChg(v.tradeSizeTrend, 1)}.`,
    );
  if (v.spikeDays !== null)
    out.push(
      `There ${plural(v.spikeDays, 'was', 'were')} ${v.spikeDays} delivery-spike ${plural(v.spikeDays, 'day', 'days')} (2x or more), ${v.spikeUp ?? 0} on up days and ${v.spikeDn ?? 0} on down days.`,
    );
  if (v.consA !== null && v.consD !== null)
    out.push(
      `In ${v.consA}% of the last ${weeksInWindow} weeks the combined weekly code was A, and in ${v.consD}% it was D.`,
    );
  if (v.flip)
    out.push(
      `In the last 6 weeks the footprints shifted ${v.flip === 'A→D' ? 'toward distribution' : 'toward accumulation'}, against the ${wl} lean (since ${fmtDate(v.flipSince)}).`,
    );
  return out.slice(0, 5);
}

export interface SectorMedian {
  n: number;
  medianA: number;
  medianD: number;
  medianBal: number | null;
  shareA: number;
  shareD: number;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The sector's median trail for the comparison on a stock page. */
export function sectorMedian(
  entries: readonly TrailEntry[],
  bySym: ReadonlyMap<string, UniverseRow>,
  sector: string,
  win: WindowName,
): SectorMedian | null {
  const vs = entries.flatMap((e) => (bySym.get(e.sym)?.sector === sector && e.w[win] ? [e.w[win]!] : []));
  if (vs.length === 0) return null;
  return {
    n: vs.length,
    medianA: median(vs.map((v) => v.A))!,
    medianD: median(vs.map((v) => v.D))!,
    medianBal: median(vs.flatMap((v) => (v.delivBal === null ? [] : [v.delivBal]))),
    shareA: (vs.filter(leansA).length / vs.length) * 100,
    shareD: (vs.filter(leansD).length / vs.length) * 100,
  };
}
