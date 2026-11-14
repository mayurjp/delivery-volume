/**
 * Smart Money Trail v1, one stock (docs/specs/07-run-forensics.md section 6A): the TypeScript twin of
 * `trail_for_rows` in pipeline/trail.py. Both are tested on the same shared vectors (trailVectors.json).
 *
 * Input: one stock's daily rows from symbols/{f}.json and the market calendar. Eligible day: an EQ row with a delivery
 * quantity, volume and trades whose flags carry none of lowLiquidity, newListing and etf. Codes: A leans accumulation,
 * D leans distribution, N neutral, '-' not enough history.
 */

import { periodKey } from './aggregate';

export const INDICATORS = [
  'delivBal',
  'delivPctTrend',
  'tradeSizeTrend',
  'spikePersist',
  'dealsNet',
] as const;
export type IndicatorId = (typeof INDICATORS)[number];
export type Code = 'A' | 'D' | 'N' | '-';
export type WindowName = '3M' | '6M' | '1Y';
export const WINDOWS: readonly WindowName[] = ['3M', '6M', '1Y'];

/** Order of the cells of one window record (trail/latest.json rows). */
export const WINDOW_COLS = [
  'codes',
  'delivBal',
  'delivPctTrend',
  'tradeSizeTrend',
  'spikeDays',
  'spikeUp',
  'spikeDn',
  'baseSpikeRate',
  'upCr',
  'dnCr',
  'consA',
  'consD',
  'flip',
  'flipSince',
  'dealsFii',
  'dealsDii',
] as const;

export type WindowRec = [
  codes: string,
  delivBal: number | null,
  delivPctTrend: number | null,
  tradeSizeTrend: number | null,
  spikeDays: number | null,
  spikeUp: number | null,
  spikeDn: number | null,
  baseSpikeRate: number | null,
  upCr: number | null,
  dnCr: number | null,
  consA: number | null,
  consD: number | null,
  flip: string | null,
  flipSince: string | null,
  dealsFii: number | null,
  dealsDii: number | null,
];

export interface TrailCfg {
  windows: Record<WindowName, { days: number; weeks: number }>;
  baselineDays: number;
  minBaselineDays: number;
  minWindowFraction: number;
  delivBal: { aboveA: number; belowD: number };
  delivPctTrendPp: number;
  tradeSizeTrendPct: number;
  spike: { minSpike: number; minDays: number; rateMult: number; upDownMult: number };
  weekDays: number;
  weekMargin: number;
  flipDays: number;
  flipMinIndicators: number;
  stripWeeks: number;
  listSize: number;
  persistent: number;
  /** Named deals indicator (Phase 4): FII + DII net Rs Cr over the window, A above aboveA, D below belowD. */
  dealsNet: { aboveA: number; belowD: number };
  /** First day of the named-deal history (ISO); null means no history is configured (the indicator is missing). */
  dealsFrom: string | null;
}

/** Named deal flows of one stock on one day, Rs Crore, round trips excluded (symbols/{f}.json dealFlows). */
export type DealsByDate = Readonly<Record<string, { fii: number; dii: number }>>;

export interface TrailInput {
  date: string;
  series: string;
  close: number | null;
  prevClose: number | null;
  vol: number | null;
  delivQty: number | null;
  turnoverCr: number | null;
  trades: number | null;
  delivValCr: number | null;
  spike: number | null;
  flags: number;
}

export interface TimelineWeek {
  end: string;
  key: string;
  codes: string;
  overall: Code;
  delivBal: number | null;
  delivPctTrend: number | null;
  tradeSizeTrend: number | null;
  spikeDays: number | null;
}

export interface TrailResult {
  asOf: string;
  eligible: boolean;
  strip: string;
  stripWeeks: (string | null)[];
  windows: Record<WindowName, WindowRec | null>;
  timeline: TimelineWeek[];
}

const EXCLUDED = 256 | 512 | 1024;
const MISSING = 9;
const CH: Record<number, Code> = { 1: 'A', [-1]: 'D', 0: 'N', 9: '-' };
const KEYS = ['NE', 'DV', 'TV', 'TR', 'UP', 'DN', 'SP', 'SPU', 'SPD', 'DF', 'DD'] as const;
type Cums = Record<(typeof KEYS)[number], Float64Array>;

/** Python's round() on a float: ties to even (cons values are percentages of small integers). */
function rint(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

const r = (x: number | null, dp: number): number | null =>
  x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** dp) / 10 ** dp;

function buildCums(
  rows: readonly TrailInput[],
  days: readonly string[],
  deals: DealsByDate,
): { cs: Cums; elig: boolean[] } {
  const T = days.length;
  const pos = new Map(days.map((d, i) => [d, i]));
  const m = Object.fromEntries(KEYS.map((k) => [k, new Float64Array(T)])) as Cums;
  const elig = new Array<boolean>(T).fill(false);
  for (const [date, v] of Object.entries(deals)) {
    const t = pos.get(date);
    if (t === undefined) continue;
    m.DF[t] = v.fii;
    m.DD[t] = v.dii;
  }
  for (const row of rows) {
    const t = pos.get(row.date);
    if (t === undefined) continue;
    const ok =
      row.series === 'EQ' &&
      row.delivQty !== null &&
      (row.vol ?? 0) > 0 &&
      (row.trades ?? 0) > 0 &&
      (row.flags & EXCLUDED) === 0;
    if (!ok) continue;
    elig[t] = true;
    const dv = row.delivValCr ?? 0;
    const up = row.close !== null && row.prevClose !== null && row.close > row.prevClose;
    const dn = row.close !== null && row.prevClose !== null && row.close < row.prevClose;
    const sp = row.spike !== null && row.spike >= 2;
    m.NE[t] = 1;
    m.DV[t] = dv;
    m.TV[t] = row.turnoverCr ?? 0;
    m.TR[t] = row.trades ?? 0;
    m.UP[t] = up ? dv : 0;
    m.DN[t] = dn ? dv : 0;
    m.SP[t] = sp ? 1 : 0;
    m.SPU[t] = sp && up ? 1 : 0;
    m.SPD[t] = sp && dn ? 1 : 0;
  }
  // cumulative sums with a leading zero: a window (a, b] is C[b + 1] - C[a + 1]
  const cs = {} as Cums;
  for (const k of KEYS) {
    const c = new Float64Array(T + 1);
    for (let i = 0; i < T; i++) c[i + 1] = c[i]! + m[k][i]!;
    cs[k] = c;
  }
  return { cs, elig };
}

interface Ind {
  ok: boolean;
  codes: number[];
  fii: number | null;
  dii: number | null;
  bal: number | null;
  dp: number | null;
  ts: number | null;
  spn: number | null;
  spu: number | null;
  spd: number | null;
  brate: number | null;
  up: number | null;
  dn: number | null;
}

function indicators(cs: Cums, end: number, n: number, cfg: TrailCfg, dealFrom: number): Ind {
  const lo = end + 1 - n;
  const full = lo >= 0;
  const loC = Math.max(lo, 0);
  const blo = Math.max(lo - cfg.baselineDays, 0);
  const w = (k: (typeof KEYS)[number]) => cs[k][end + 1]! - cs[k][loC]!;
  const b = (k: (typeof KEYS)[number]) => cs[k][loC]! - cs[k][blo]!;
  const nw = w('NE');
  const nb = b('NE');
  const okW = full && nw >= Math.ceil(cfg.minWindowFraction * n);
  const okB = okW && nb >= cfg.minBaselineDays;
  const up = w('UP');
  const dn = w('DN');
  const [dvw, tvw, trw] = [w('DV'), w('TV'), w('TR')];
  const [dvb, tvb, trb] = [b('DV'), b('TV'), b('TR')];
  const [spw, spb, spu, spd] = [w('SP'), b('SP'), w('SPU'), w('SPD')];
  const bal = okW && dn > 0 ? up / dn : null;
  const dp = okB && tvw > 0 && tvb > 0 ? (dvw / tvw) * 100 - (dvb / tvb) * 100 : null;
  const ts = okB && trw > 0 && trb > 0 && tvw > 0 && tvb > 0 ? (tvw / trw / (tvb / trb) - 1) * 100 : null;
  const sp = cfg.spike;
  const persist = okB && spw >= sp.minDays && spw * nb >= sp.rateMult * spb * nw;
  const spikeA = persist && spu >= sp.upDownMult * spd && spu > spd;
  const spikeD = persist && spd >= sp.upDownMult * spu && spd > spu;
  const lead = (v: number | null, a: number, d: number) =>
    v === null ? MISSING : v > a ? 1 : v < d ? -1 : 0;
  // named deals: coded only when the whole window lies inside the deal history
  const dealOk = lo >= dealFrom;
  const dfw = w('DF');
  const ddw = w('DD');
  const net = r(dfw + ddw, 2) ?? 0;
  const dealCode = !dealOk ? MISSING : net > cfg.dealsNet.aboveA ? 1 : net < cfg.dealsNet.belowD ? -1 : 0;
  const codes = [
    lead(bal, cfg.delivBal.aboveA, cfg.delivBal.belowD),
    lead(dp, cfg.delivPctTrendPp, -cfg.delivPctTrendPp),
    lead(ts, cfg.tradeSizeTrendPct, -cfg.tradeSizeTrendPct),
    !okB ? MISSING : spikeA ? 1 : spikeD ? -1 : 0,
    dealCode,
  ];
  return {
    ok: okW,
    codes,
    fii: dealOk ? r(dfw, 2) : null,
    dii: dealOk ? r(ddw, 2) : null,
    bal,
    dp,
    ts,
    spn: okW ? spw : null,
    spu: okW ? spu : null,
    spd: okW ? spd : null,
    brate: okB ? (spb / (nb > 0 ? nb : 1)) * 100 : null,
    up: okW ? up : null,
    dn: okW ? dn : null,
  };
}

function overall(codes: readonly number[], margin: number): number {
  const a = codes.filter((c) => c === 1).length;
  const d = codes.filter((c) => c === -1).length;
  const known = codes.filter((c) => c !== MISSING).length;
  if (known === 0) return MISSING;
  return a - d >= margin ? 1 : d - a >= margin ? -1 : 0;
}

function tally(codes: readonly number[]): { A: number; D: number } {
  return { A: codes.filter((c) => c === 1).length, D: codes.filter((c) => c === -1).length };
}

const str = (codes: readonly number[]): string => codes.map((c) => CH[c]!).join('');

function weekIndex(days: readonly string[]): { wk: number[]; ends: number[]; keys: string[] } {
  const keys: string[] = [];
  const wk: number[] = [];
  const ends: number[] = [];
  days.forEach((d, i) => {
    const k = periodKey(d, 'w');
    if (keys[keys.length - 1] !== k) keys.push(k);
    wk.push(keys.length - 1);
    ends[keys.length - 1] = i;
  });
  return { wk, ends, keys };
}

/** First market-day index on or after cfg.dealsFrom; the number of days when no history is configured. */
export function dealFromIndex(days: readonly string[], cfg: TrailCfg): number {
  if (!cfg.dealsFrom) return days.length;
  const i = days.findIndex((d) => d >= cfg.dealsFrom!);
  return i < 0 ? days.length : i;
}

/** ONE stock's trail at as-of index `a` (default: the latest day). `deals` are the stock's named deal flows by date. */
export function trailForRows(
  rows: readonly TrailInput[],
  days: readonly string[],
  cfg: TrailCfg,
  asOfIndex?: number,
  deals: DealsByDate = {},
): TrailResult {
  const a = asOfIndex ?? days.length - 1;
  const { cs, elig } = buildCums(rows, days, deals);
  const dealFrom = dealFromIndex(days, cfg);
  const { wk, ends, keys } = weekIndex(days);
  const lastW = wk[a]!;
  const firstW = lastW - cfg.stripWeeks + 1;
  const stripCodes: number[] = [];
  const stripDates: (string | null)[] = [];
  const timeline: TimelineWeek[] = [];
  for (let wi = firstW; wi <= lastW; wi++) {
    if (wi < 0) {
      stripCodes.push(MISSING);
      stripDates.push(null);
      continue;
    }
    const e = Math.min(ends[wi]!, a);
    const ind = indicators(cs, e, cfg.weekDays, cfg, dealFrom);
    const ov = overall(ind.codes, cfg.weekMargin);
    stripCodes.push(ov);
    stripDates.push(days[e]!);
    timeline.push({
      end: days[e]!,
      key: keys[wi]!,
      codes: str(ind.codes),
      overall: CH[ov]!,
      delivBal: r(ind.bal, 3),
      delivPctTrend: r(ind.dp, 2),
      tradeSizeTrend: r(ind.ts, 2),
      spikeDays: ind.spn,
    });
  }
  const windows = {} as Record<WindowName, WindowRec | null>;
  for (const name of WINDOWS) {
    const wc = cfg.windows[name];
    const ind = indicators(cs, a, wc.days, cfg, dealFrom);
    if (!ind.ok) {
      windows[name] = null;
      continue;
    }
    const t = tally(ind.codes);
    const weeksSlice = stripCodes.slice(-wc.weeks);
    const defined = weeksSlice.filter((c) => c !== MISSING).length;
    const enough = defined >= Math.ceil(wc.weeks / 2);
    const consA = enough ? (weeksSlice.filter((c) => c === 1).length / defined) * 100 : null;
    const consD = enough ? (weeksSlice.filter((c) => c === -1).length / defined) * 100 : null;
    const rt = tally(indicators(cs, a, cfg.flipDays, cfg, dealFrom).codes);
    const leansA = t.A >= 2 && t.A > t.D;
    const leansD = t.D >= 2 && t.D > t.A;
    const flip =
      leansA && rt.D >= cfg.flipMinIndicators ? 'A→D' : leansD && rt.A >= cfg.flipMinIndicators ? 'D→A' : '';
    let since: string | null = null;
    if (flip) {
      const opp = flip === 'A→D' ? -1 : 1;
      let run = 0;
      while (run < stripCodes.length && stripCodes[stripCodes.length - 1 - run] === opp) run++;
      const first = run > 0 ? stripCodes.length - run : stripCodes.length - 6;
      since = stripDates[first] ?? null;
    }
    windows[name] = [
      str(ind.codes),
      r(ind.bal, 3),
      r(ind.dp, 2),
      r(ind.ts, 2),
      ind.spn,
      ind.spu,
      ind.spd,
      r(ind.brate, 1),
      r(ind.up, 1),
      r(ind.dn, 1),
      consA === null ? null : rint(consA),
      consD === null ? null : rint(consD),
      flip || null,
      since,
      ind.fii,
      ind.dii,
    ];
  }
  return {
    asOf: days[a]!,
    eligible: elig[a]!,
    strip: str(stripCodes),
    stripWeeks: stripDates,
    windows,
    timeline,
  };
}

/** The named cells of one window record. */
export interface WindowView {
  codes: string;
  delivBal: number | null;
  delivPctTrend: number | null;
  tradeSizeTrend: number | null;
  spikeDays: number | null;
  spikeUp: number | null;
  spikeDn: number | null;
  baseSpikeRate: number | null;
  upCr: number | null;
  dnCr: number | null;
  consA: number | null;
  consD: number | null;
  flip: 'A→D' | 'D→A' | null;
  flipSince: string | null;
  /** Named deals over the window, Rs Cr (null before the deal history). */
  dealsFii: number | null;
  dealsDii: number | null;
  /** Tally of the five codes. */
  A: number;
  D: number;
  N: number;
  missing: number;
}

export function windowView(rec: WindowRec): WindowView {
  const c = rec[0];
  const count = (ch: string) => [...c].filter((x) => x === ch).length;
  return {
    codes: c,
    delivBal: rec[1],
    delivPctTrend: rec[2],
    tradeSizeTrend: rec[3],
    spikeDays: rec[4],
    spikeUp: rec[5],
    spikeDn: rec[6],
    baseSpikeRate: rec[7],
    upCr: rec[8],
    dnCr: rec[9],
    consA: rec[10],
    consD: rec[11],
    flip: rec[12] as 'A→D' | 'D→A' | null,
    flipSince: rec[13],
    dealsFii: rec[14],
    dealsDii: rec[15],
    A: count('A'),
    D: count('D'),
    N: count('N'),
    missing: count('-'),
  };
}
