import type { HolderRow, HoldingsAggregateRow, HoldingsFiling, SymbolFile } from '../types/data';
import { fmtPp } from './format';
import { rowsToObjects } from './dataClient';

/**
 * Shareholding (S16, Phase 4B): the caveats, the change formatting, the stacked segments of a stock's filing, the
 * Screener presets and the movers of Institutions. Descriptive only (04 section 0, 05 section 4): no advice, no ratings.
 */

/** Share-count changes above this (in percent) make the % changes unreliable as buying or selling (04 5.4). */
export const DILUTION_LIMIT_PCT = 2;

/** Named-holder status labels (03 5.10). */
export const STATUS_LABEL: Record<string, string> = {
  NEW: 'NEW',
  UP: 'UP',
  DOWN: 'DOWN',
  SAME: 'SAME',
  EXITED: 'EXITED',
};

export const EMPTY_HOLDINGS = 'No shareholding filings stored for this stock yet.';
export const MODEL_NOTE =
  'Shares by group from the quarterly shareholding filing. Changes are against the previous filed quarter.';
export const ENTITY_DISCLOSURE = 'Only holdings above 1% are disclosed in shareholding filings.';

/** The dilution caveat (05 section 4, 04 5.4). `sharesChgPct` is in percent. */
export function dilutionCaveat(sharesChgPct: number): string {
  return `Share count changed by ${Math.abs(sharesChgPct).toFixed(1)}% this quarter, so % changes are not pure buying or selling`;
}

/** The EXITED caveat: a holder missing from the list may have fallen below 1% rather than sold out (04 5.4). */
export const EXITED_CAVEAT = "Below the 1% disclosure line or sold out; the filing doesn't say which";

/** A quarter's share-count change, as shown next to a holder or a stock: "+1.03 pp", "−0.68 pp", or a dash. */
export function fmtChangePp(v: number | null | undefined): string {
  return fmtPp(v, 2);
}

/** The dilution flag of a filing: |sharesChgPct| above the limit. A null change is not flagged. */
export function isDilution(h: { dilutionFlag?: boolean | null; sharesChgPct?: number | null }): boolean {
  if (h.dilutionFlag) return true;
  return typeof h.sharesChgPct === 'number' && Math.abs(h.sharesChgPct) > DILUTION_LIMIT_PCT;
}

/** The filing rows of a symbol file, oldest quarter first. */
export function filingsOf(file: SymbolFile): HoldingsFiling[] {
  return rowsToObjects<HoldingsFiling>(file.holdings).sort((a, b) => a.quarter.localeCompare(b.quarter));
}

/** The named holders of a symbol file's latest quarter (the file carries that quarter only). */
export function namedOf(file: SymbolFile): HolderRow[] {
  return rowsToObjects<HolderRow & { quarter: string }>(file.namedHolders).map(
    ({ quarter: _q, ...r }) => r as HolderRow,
  );
}

export interface Segment {
  key: 'promoter' | 'fii' | 'mf' | 'insurance' | 'otherDii' | 'retail' | 'others';
  label: string;
  pct: number;
}

/**
 * The stacked segments of one filing: Promoter, FII, then DII split into MF, Insurance and other DII (MF and insurance
 * sit inside DII, 03 5.10), Retail, and Others (the remainder to 100). Null when the core groups are missing.
 */
export function segmentsOf(f: HoldingsFiling): Segment[] | null {
  const { promoterPct, fiiPct, diiPct, retailPct } = f;
  if ([promoterPct, fiiPct, diiPct, retailPct].some((v) => typeof v !== 'number')) return null;
  const mf = Math.max(0, f.mfPct ?? 0);
  const ins = Math.max(0, f.insurancePct ?? 0);
  const otherDii = Math.max(0, (diiPct as number) - mf - ins);
  const others = Math.max(
    0,
    100 - ((promoterPct as number) + (fiiPct as number) + (diiPct as number) + (retailPct as number)),
  );
  return [
    { key: 'promoter', label: 'Promoter', pct: promoterPct as number },
    { key: 'fii', label: 'FII', pct: fiiPct as number },
    { key: 'mf', label: 'MF', pct: mf },
    { key: 'insurance', label: 'Insurance', pct: ins },
    { key: 'otherDii', label: 'Other DII', pct: otherDii },
    { key: 'retail', label: 'Retail', pct: retailPct as number },
    { key: 'others', label: 'Others', pct: others },
  ];
}

// ---- the Screener join ----------------------------------------------------------------------------------------------

/** The ownership fields a Screener row carries (joined from holdings/latest.json; null for stocks without a filing). */
export interface OwnershipFields {
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null;
  mfPct: number | null;
  fiiChgPp: number | null;
  diiChgPp: number | null;
  mfChgPp: number | null;
  promoterChgPp: number | null;
  holdingsQuarter: string | null;
  holdingsFiledOn: string | null;
  dilutionFlag: boolean | null;
  sharesChgPct: number | null;
}

export const NO_OWNERSHIP: OwnershipFields = {
  promoterPct: null,
  fiiPct: null,
  diiPct: null,
  mfPct: null,
  fiiChgPp: null,
  diiChgPp: null,
  mfChgPp: null,
  promoterChgPp: null,
  holdingsQuarter: null,
  holdingsFiledOn: null,
  dilutionFlag: null,
  sharesChgPct: null,
};

/** holdings/latest.json rows by symbol. */
export function ownershipBySym(rows: readonly HoldingsFiling[]): Map<string, OwnershipFields> {
  const m = new Map<string, OwnershipFields>();
  for (const r of rows) {
    if (!r.sym) continue;
    m.set(r.sym, {
      promoterPct: r.promoterPct,
      fiiPct: r.fiiPct,
      diiPct: r.diiPct,
      mfPct: r.mfPct,
      fiiChgPp: r.fiiChgPp,
      diiChgPp: r.diiChgPp,
      mfChgPp: r.mfChgPp,
      promoterChgPp: r.promoterChgPp,
      holdingsQuarter: r.quarter,
      holdingsFiledOn: r.filedOn,
      dilutionFlag: r.dilutionFlag,
      sharesChgPct: r.sharesChgPct,
    });
  }
  return m;
}

// ---- Screener presets (ownership) -----------------------------------------------------------------------------------

/** What an ownership preset reads: the joined fields and the day's delivery spike (null on other views). */
export type OwnershipInput = Partial<OwnershipFields> & { spike?: number | null };

export interface OwnershipPreset {
  id: string;
  label: string;
  /** One line under the chip. Says when the list is a ranking rather than an event (05 section 4). */
  explain: string;
  sort: keyof OwnershipFields | 'spike';
  dir: 'asc' | 'desc';
  test: (r: OwnershipInput) => boolean;
}

/** Stocks whose share count moved by more than the limit are left out of every pp preset (04 5.4). */
const notDiluted = (r: OwnershipInput) => !isDilution(r);
const RANKING = 'A ranking, not an event: no follow-through is measured.';
const EXCL = 'Stocks whose share count changed by more than 2% are left out.';

export const OWNERSHIP_PRESETS: OwnershipPreset[] = [
  {
    id: 'fiiUp',
    label: 'FII stake up last quarter',
    explain: `FII share of shares rose against the previous filing, largest rise first. ${EXCL} ${RANKING}`,
    sort: 'fiiChgPp',
    dir: 'desc',
    test: (r) => typeof r.fiiChgPp === 'number' && r.fiiChgPp > 0 && notDiluted(r),
  },
  {
    id: 'diiUp',
    label: 'DII stake up last quarter',
    explain: `DII share of shares rose against the previous filing, largest rise first. ${EXCL} ${RANKING}`,
    sort: 'diiChgPp',
    dir: 'desc',
    test: (r) => typeof r.diiChgPp === 'number' && r.diiChgPp > 0 && notDiluted(r),
  },
  {
    id: 'mfUp',
    label: 'MF raised',
    explain: `Mutual funds (inside DII) raised their share against the previous filing. ${EXCL} ${RANKING}`,
    sort: 'mfChgPp',
    dir: 'desc',
    test: (r) => typeof r.mfChgPp === 'number' && r.mfChgPp > 0 && notDiluted(r),
  },
  {
    id: 'fiiDiiUp',
    label: 'FII + DII raised holdings (QoQ > 0.5 pp)',
    explain: `FII and DII together rose by more than 0.5 pp against the previous filing. ${EXCL} ${RANKING}`,
    sort: 'fiiChgPp',
    dir: 'desc',
    test: (r) =>
      typeof r.fiiChgPp === 'number' &&
      typeof r.diiChgPp === 'number' &&
      r.fiiChgPp + r.diiChgPp > 0.5 &&
      notDiluted(r),
  },
  {
    id: 'handover',
    label: 'FII→DII handover',
    explain: `FII fell by at least 1 pp while DII rose by at least 1 pp against the previous filing. ${EXCL} ${RANKING}`,
    sort: 'diiChgPp',
    dir: 'desc',
    test: (r) =>
      typeof r.fiiChgPp === 'number' &&
      typeof r.diiChgPp === 'number' &&
      r.fiiChgPp <= -1 &&
      r.diiChgPp >= 1 &&
      notDiluted(r),
  },
  {
    id: 'promoterDown',
    label: 'Promoter holding fell',
    explain: `Promoter share fell against the previous filing, largest fall first. ${EXCL} ${RANKING}`,
    sort: 'promoterChgPp',
    dir: 'asc',
    test: (r) => typeof r.promoterChgPp === 'number' && r.promoterChgPp < 0 && notDiluted(r),
  },
  {
    id: 'spikeFii',
    label: 'Delivery spike + FII stake up',
    explain: `Delivery value at least twice its 20-day average on the day, and FII share up against the previous filing. ${EXCL} A ranking of two conditions, not an event.`,
    sort: 'spike',
    dir: 'desc',
    test: (r) =>
      typeof r.spike === 'number' &&
      r.spike >= 2 &&
      typeof r.fiiChgPp === 'number' &&
      r.fiiChgPp > 0 &&
      notDiluted(r),
  },
];

export const OWNERSHIP_BY_ID = new Map(OWNERSHIP_PRESETS.map((p) => [p.id, p]));

/** Rows that pass a preset, sorted by its key (nulls last). Generic over the row type. */
export function runOwnershipPreset<R extends OwnershipInput>(p: OwnershipPreset, rows: readonly R[]): R[] {
  const sign = p.dir === 'asc' ? 1 : -1;
  const key = p.sort;
  return rows
    .filter((r) => p.test(r))
    .sort((a, b) => {
      const x = a[key as keyof R] as number | null | undefined;
      const y = b[key as keyof R] as number | null | undefined;
      if (typeof x !== 'number' && typeof y !== 'number') return 0;
      if (typeof x !== 'number') return 1;
      if (typeof y !== 'number') return -1;
      return sign * (x - y);
    });
}

// ---- Institutions: movers and aggregate trends ----------------------------------------------------------------------

export type MoverKey = 'fiiChgPp' | 'diiChgPp' | 'mfChgPp' | 'promoterChgPp';

export interface Movers {
  up: HoldingsFiling[];
  down: HoldingsFiling[];
  /** Stocks with a change for this key, before the dilution exclusion. */
  eligible: number;
  /** Of those, how many were left out for a share-count change above the limit. */
  excludedDilution: number;
}

/** The largest rises and falls of one category across stocks, leaving out dilution (04 5.4). */
export function movers(rows: readonly HoldingsFiling[], key: MoverKey, n = 10): Movers {
  const withChg = rows.filter((r) => typeof r[key] === 'number');
  const kept = withChg.filter((r) => !isDilution(r));
  const byDesc = [...kept].sort((a, b) => (b[key] as number) - (a[key] as number));
  const up = byDesc.filter((r) => (r[key] as number) > 0).slice(0, n);
  const down = [...byDesc]
    .reverse()
    .filter((r) => (r[key] as number) < 0)
    .slice(0, n);
  return { up, down, eligible: withChg.length, excludedDilution: withChg.length - kept.length };
}

/** The market-cap-weighted group rows of one group, oldest quarter first. */
export function aggregateTrend(rows: readonly HoldingsAggregateRow[], group: string): HoldingsAggregateRow[] {
  return rows.filter((r) => r.group === group).sort((a, b) => a.quarter.localeCompare(b.quarter));
}

/** How many stocks have a filing in the quarter, out of the universe (the coverage line). */
export function coverageLine(filed: number, universe: number, quarter: string | null): string {
  return quarter
    ? `Holdings stored for ${filed} of ${universe} companies (quarter ${quarter}).`
    : `Holdings stored for ${filed} of ${universe} companies.`;
}

// ---- Entity page: disclosed holdings --------------------------------------------------------------------------------

export interface DisclosedRow {
  quarter: string;
  sym: string;
  category: string;
  holder: string;
  pct: number;
  prevPct: number | null;
  chg: HolderRow['chg'];
}

/**
 * Every stock where the entity is a named holder above 1% (pct not null; EXITED rows have no pct and are left out).
 * Latest quarter first, then the largest holding first.
 */
export function disclosedFor(
  entityId: string,
  holders: readonly { quarter: string; rows: readonly HolderRow[] }[],
): DisclosedRow[] {
  const out: DisclosedRow[] = [];
  for (const h of holders) {
    for (const r of h.rows) {
      if (r.entityId !== entityId || typeof r.pct !== 'number') continue;
      out.push({
        quarter: h.quarter,
        sym: r.sym,
        category: r.category,
        holder: r.holder,
        pct: r.pct,
        prevPct: r.prevPct,
        chg: r.chg,
      });
    }
  }
  return out.sort(
    (a, b) => b.quarter.localeCompare(a.quarter) || b.pct - a.pct || a.sym.localeCompare(b.sym),
  );
}
