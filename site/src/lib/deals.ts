/**
 * Named bulk and block deals (docs/specs/04 section 5.3, 05 P7, 03 5.8): filters, per-stock FII and DII flows, the
 * "FII vs DII by stock" lists and entity totals. Pure functions over deals/{YYYY}.json, deals/flows.json and
 * deals/entities.json (and the per-stock dealFlows block). Round trips are excluded from every flow and total here,
 * exactly as in the build (pipeline/deals.py), so the page totals equal flows.json totals (tested).
 *
 * Wording: a deal fact may say an entity "bought" or "sold". The caveat on every view: deals capture only large trades.
 */

export type { Category, DealRow, FlowRow, EntityRow } from '../types/data';
import type { Category, DealRow, FlowRow } from '../types/data';
export const CATEGORIES: readonly Category[] = ['FII', 'DII', 'Other'];

export const DEALS_CAVEAT =
  'Deals capture only large trades (bulk and block). They are a small, visible slice of total FII and DII activity.';

/** The side filter options (the data literals BUY and SELL are read here, never shown). */
export const SIDE_OPTIONS: readonly { value: 'all' | 'BUY' | 'SELL'; label: string }[] = [
  { value: 'all', label: 'Bought and sold' },
  { value: 'BUY', label: 'Bought' },
  { value: 'SELL', label: 'Sold' },
];

/** Signed value of a deal row: bought positive, sold negative (Rs Cr). */
export const signedValue = (d: { side: 'BUY' | 'SELL'; valueCr: number }): number =>
  d.side === 'BUY' ? d.valueCr : -d.valueCr;

/** "Bought" and "sold" for the side of a deal. */
export const sideWord = (side: 'BUY' | 'SELL'): string => (side === 'BUY' ? 'bought' : 'sold');

export interface DealFilter {
  from: string | null;
  to: string | null;
  type: 'all' | 'bulk' | 'block';
  side: 'all' | 'BUY' | 'SELL';
  category: 'all' | Category;
  minValueCr: number;
  hideRoundTrips: boolean;
  sym: string | null;
}

export const DEFAULT_DEAL_FILTER: DealFilter = {
  from: null,
  to: null,
  type: 'all',
  side: 'all',
  category: 'all',
  minValueCr: 0,
  hideRoundTrips: true,
  sym: null,
};

export function filterDeals(rows: readonly DealRow[], f: DealFilter): DealRow[] {
  return rows.filter(
    (r) =>
      (f.from === null || r.date >= f.from) &&
      (f.to === null || r.date <= f.to) &&
      (f.type === 'all' || r.type === f.type) &&
      (f.side === 'all' || r.side === f.side) &&
      (f.category === 'all' || r.entityCategory === f.category) &&
      r.valueCr >= f.minValueCr &&
      (!f.hideRoundTrips || !r.roundTrip) &&
      (f.sym === null || r.sym === f.sym),
  );
}

const inRange = (date: string, from: string | null, to: string | null) =>
  (from === null || date >= from) && (to === null || date <= to);

export interface CategoryTotal {
  buyValueCr: number;
  sellValueCr: number;
  netValueCr: number;
}

/** Totals by category over the range, summed from flows.json (the same numbers the page charts show). */
export function flowTotals(
  flows: readonly FlowRow[],
  from: string | null,
  to: string | null,
): Record<Category, CategoryTotal> {
  const out: Record<Category, CategoryTotal> = {
    FII: { buyValueCr: 0, sellValueCr: 0, netValueCr: 0 },
    DII: { buyValueCr: 0, sellValueCr: 0, netValueCr: 0 },
    Other: { buyValueCr: 0, sellValueCr: 0, netValueCr: 0 },
  };
  for (const f of flows) {
    if (!inRange(f.date, from, to)) continue;
    const t = out[f.category];
    t.buyValueCr += f.buyValueCr;
    t.sellValueCr += f.sellValueCr;
    t.netValueCr += f.netValueCr;
  }
  for (const c of CATEGORIES) {
    const t = out[c];
    t.buyValueCr = round2(t.buyValueCr);
    t.sellValueCr = round2(t.sellValueCr);
    t.netValueCr = round2(t.netValueCr);
  }
  return out;
}

export const round2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;

export interface StockFlowRow {
  sym: string;
  fiiNetCr: number;
  diiNetCr: number;
  otherNetCr: number;
}

/** Per stock over the range: FII, DII and Other net via deals. */
export function stockFlows(
  flows: readonly FlowRow[],
  from: string | null,
  to: string | null,
): StockFlowRow[] {
  const by = new Map<string, StockFlowRow>();
  for (const f of flows) {
    if (!inRange(f.date, from, to)) continue;
    const r = by.get(f.sym) ?? { sym: f.sym, fiiNetCr: 0, diiNetCr: 0, otherNetCr: 0 };
    if (f.category === 'FII') r.fiiNetCr += f.netValueCr;
    else if (f.category === 'DII') r.diiNetCr += f.netValueCr;
    else r.otherNetCr += f.netValueCr;
    by.set(f.sym, r);
  }
  return [...by.values()].map((r) => ({
    sym: r.sym,
    fiiNetCr: round2(r.fiiNetCr),
    diiNetCr: round2(r.diiNetCr),
    otherNetCr: round2(r.otherNetCr),
  }));
}

/**
 * The "FII vs DII by stock" lists (04 section 5.3): "FII selling to DII" where FII net is below zero and DII net above
 * zero over the range, and the reverse. Sorted by the size of the flow, largest first.
 */
export function fiiDiiLists(rows: readonly StockFlowRow[]): {
  fiiSellDiiBuy: StockFlowRow[];
  fiiBuyDiiSell: StockFlowRow[];
} {
  const fiiSellDiiBuy = rows
    .filter((r) => r.fiiNetCr < 0 && r.diiNetCr > 0)
    .sort((a, b) => a.fiiNetCr - b.fiiNetCr || a.sym.localeCompare(b.sym));
  const fiiBuyDiiSell = rows
    .filter((r) => r.fiiNetCr > 0 && r.diiNetCr < 0)
    .sort((a, b) => b.fiiNetCr - a.fiiNetCr || a.sym.localeCompare(b.sym));
  return { fiiSellDiiBuy, fiiBuyDiiSell };
}

export interface EntityNet {
  entityId: string;
  entityName: string;
  entityCategory: Category;
  netValueCr: number;
  buyValueCr: number;
  sellValueCr: number;
}

/** Top entities by net value over the range (round trips excluded), for one category. */
export function topEntitiesInRange(
  rows: readonly DealRow[],
  from: string | null,
  to: string | null,
  category: Category | 'all',
  side: 'bought' | 'sold',
  n = 10,
): EntityNet[] {
  const by = new Map<string, EntityNet>();
  for (const r of rows) {
    if (r.roundTrip || !inRange(r.date, from, to)) continue;
    if (category !== 'all' && r.entityCategory !== category) continue;
    const e = by.get(r.entityId) ?? {
      entityId: r.entityId,
      entityName: r.entityName,
      entityCategory: r.entityCategory,
      netValueCr: 0,
      buyValueCr: 0,
      sellValueCr: 0,
    };
    if (r.side === 'BUY') e.buyValueCr += r.valueCr;
    else e.sellValueCr += r.valueCr;
    e.netValueCr += r.side === 'BUY' ? r.valueCr : -r.valueCr;
    by.set(r.entityId, e);
  }
  const all = [...by.values()].map((e) => ({
    ...e,
    netValueCr: round2(e.netValueCr),
    buyValueCr: round2(e.buyValueCr),
    sellValueCr: round2(e.sellValueCr),
  }));
  const ranked = all.filter((e) => (side === 'bought' ? e.netValueCr > 0 : e.netValueCr < 0));
  ranked.sort((a, b) => (side === 'bought' ? b.netValueCr - a.netValueCr : a.netValueCr - b.netValueCr));
  return ranked.slice(0, n);
}

/** Month keys (YYYY-MM) and the net per category per month for the deal-flow chart (round trips already excluded). */
export function monthlyFlows(
  flows: readonly FlowRow[],
  sym: string | null,
): { months: string[]; fii: number[]; dii: number[]; other: number[] } {
  const by = new Map<string, { fii: number; dii: number; other: number }>();
  for (const f of flows) {
    if (sym !== null && f.sym !== sym) continue;
    const m = f.date.slice(0, 7);
    const g = by.get(m) ?? { fii: 0, dii: 0, other: 0 };
    if (f.category === 'FII') g.fii += f.netValueCr;
    else if (f.category === 'DII') g.dii += f.netValueCr;
    else g.other += f.netValueCr;
    by.set(m, g);
  }
  const months = [...by.keys()].sort();
  return {
    months,
    fii: months.map((m) => round2(by.get(m)!.fii)),
    dii: months.map((m) => round2(by.get(m)!.dii)),
    other: months.map((m) => round2(by.get(m)!.other)),
  };
}

/** The per-day FII and DII net for one stock, as the trail twin reads it (symbols/{f}.json dealFlows). */
export function dealsByDate(
  dealFlows: { columns: string[]; rows: unknown[][] } | undefined,
): Record<string, { fii: number; dii: number }> {
  const out: Record<string, { fii: number; dii: number }> = {};
  if (!dealFlows) return out;
  const ix = (name: string) => dealFlows.columns.indexOf(name);
  const di = ix('date');
  const ci = ix('category');
  const ni = ix('netValueCr');
  for (const r of dealFlows.rows) {
    const date = String(r[di]);
    const cur = out[date] ?? { fii: 0, dii: 0 };
    if (r[ci] === 'FII') cur.fii = round2(cur.fii + Number(r[ni]));
    else if (r[ci] === 'DII') cur.dii = round2(cur.dii + Number(r[ni]));
    out[date] = cur;
  }
  return out;
}

/** Deal rows of one entity (every alias is already one entityId in the build). */
export function entityDeals(rows: readonly DealRow[], entityId: string): DealRow[] {
  return rows.filter((r) => r.entityId === entityId).sort((a, b) => b.date.localeCompare(a.date));
}

/** A short chip text for a deal: "DII block bought ₹120 Cr" (past tense: wording rules, 04 section 0). */
export function dealChip(d: {
  entityCategory?: Category;
  type: string;
  side: 'BUY' | 'SELL';
  valueCr: number;
}): string {
  const kind = d.type === 'block' ? 'block' : 'bulk';
  const value = Number(d.valueCr.toFixed(2)).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${d.entityCategory ?? 'Other'} ${kind} ${sideWord(d.side)} ₹${value} Cr`;
}

/** The history gap, said plainly on every deals view (the user's requirement; DEVIATIONS #76). */
export const HISTORY_GAP_NOTE =
  'Bulk and block deal history before 2026-11-14 is incomplete on busy days: the historical source returns at most 70 records per request, so the busiest days are cut short. Daily collection from 2026-11-14 is complete.';

/** The per-stock flow rows of one symbol file (dealFlows), as FlowRow objects. */
export function flowsFromSymbol(
  sym: string,
  dealFlows: { columns: string[]; rows: unknown[][] } | undefined,
): FlowRow[] {
  if (!dealFlows) return [];
  const ix = (n: string) => dealFlows.columns.indexOf(n);
  const [d, c, b, s, n] = ['date', 'category', 'buyValueCr', 'sellValueCr', 'netValueCr'].map(ix);
  return dealFlows.rows.map((r) => ({
    date: String(r[d]),
    sym,
    category: r[c] as Category,
    buyValueCr: Number(r[b]),
    sellValueCr: Number(r[s]),
    netValueCr: Number(r[n]),
  }));
}
