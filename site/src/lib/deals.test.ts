import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DealRow, EntityRow, FlowRow } from '../types/data';
import { rowsToObjects } from './dataClient';
import {
  DEFAULT_DEAL_FILTER,
  dealChip,
  dealsByDate,
  entityDeals,
  filterDeals,
  fiiDiiLists,
  flowTotals,
  flowsFromSymbol,
  monthlyFlows,
  stockFlows,
  topEntitiesInRange,
} from './deals';

// Fixtures written by the pipeline's own functions from a committed sample of stored deal rows (see DEVIATIONS #76).
const fx = (f: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/deals', f), 'utf8'));
const deals = rowsToObjects<DealRow>(fx('2026.json'));
const flows = rowsToObjects<FlowRow>(fx('flows.json'));
const entities = rowsToObjects<EntityRow>(fx('entities.json'));

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.005);

describe('deals.json and flows.json agree', () => {
  it('every flow total equals the sum of the rows it comes from (round trips excluded)', () => {
    const live = deals.filter((d) => !d.roundTrip);
    for (const cat of ['FII', 'DII', 'Other'] as const) {
      const rows = live.filter((d) => d.entityCategory === cat);
      const buy = rows.filter((d) => d.side === 'BUY').reduce((t, d) => t + d.valueCr, 0);
      const sell = rows.filter((d) => d.side === 'SELL').reduce((t, d) => t + d.valueCr, 0);
      const t = flowTotals(flows, null, null)[cat];
      close(t.buyValueCr, buy);
      close(t.sellValueCr, sell);
      close(t.netValueCr, buy - sell);
    }
  });

  it('the FII vs DII by stock table sums to the same totals as flows.json', () => {
    const t = flowTotals(flows, null, null);
    const table = stockFlows(flows, null, null);
    close(
      table.reduce((s, r) => s + r.fiiNetCr, 0),
      t.FII.netValueCr,
    );
    close(
      table.reduce((s, r) => s + r.diiNetCr, 0),
      t.DII.netValueCr,
    );
    close(
      table.reduce((s, r) => s + r.otherNetCr, 0),
      t.Other.netValueCr,
    );
  });

  it('the stock-page deal-flow chart (monthly bars) sums to the same totals', () => {
    const m = monthlyFlows(flows, null);
    const t = flowTotals(flows, null, null);
    close(
      m.fii.reduce((s, x) => s + x, 0),
      t.FII.netValueCr,
    );
    close(
      m.dii.reduce((s, x) => s + x, 0),
      t.DII.netValueCr,
    );
    close(
      m.other.reduce((s, x) => s + x, 0),
      t.Other.netValueCr,
    );
  });

  it('one stock: its symbol-file dealFlows block gives the same chart as the flows file', () => {
    const sym = flows[0]!.sym;
    const dealFlows = {
      columns: ['date', 'category', 'buyValueCr', 'sellValueCr', 'netValueCr'],
      rows: flows
        .filter((f) => f.sym === sym)
        .map((f) => [f.date, f.category, f.buyValueCr, f.sellValueCr, f.netValueCr]),
    };
    const fromSymbol = monthlyFlows(flowsFromSymbol(sym, dealFlows), sym);
    const fromFile = monthlyFlows(flows, sym);
    expect(fromSymbol).toEqual(fromFile);
  });

  it('the per-date FII and DII net that the trail reads matches the flows', () => {
    const sym = flows[0]!.sym;
    const dealFlows = {
      columns: ['date', 'category', 'buyValueCr', 'sellValueCr', 'netValueCr'],
      rows: flows
        .filter((f) => f.sym === sym)
        .map((f) => [f.date, f.category, f.buyValueCr, f.sellValueCr, f.netValueCr]),
    };
    const byDate = dealsByDate(dealFlows);
    for (const f of flows.filter((x) => x.sym === sym)) {
      const v = byDate[f.date]!;
      if (f.category === 'FII') close(v.fii, f.netValueCr);
      if (f.category === 'DII') close(v.dii, f.netValueCr);
    }
  });

  it('a date range sums only the days inside it: two halves add up to the whole', () => {
    const days = [...new Set(flows.map((f) => f.date))].sort();
    const i = Math.floor(days.length / 2);
    const left = flowTotals(flows, null, days[i]!);
    const right = flowTotals(flows, days[i + 1]!, null);
    const all = flowTotals(flows, null, null);
    for (const c of ['FII', 'DII', 'Other'] as const) {
      close(left[c].netValueCr + right[c].netValueCr, all[c].netValueCr);
    }
  });
});

describe('filters and lists', () => {
  it('hides round trips by default and shows them when asked', () => {
    const hidden = filterDeals(deals, DEFAULT_DEAL_FILTER);
    const shown = filterDeals(deals, { ...DEFAULT_DEAL_FILTER, hideRoundTrips: false });
    expect(hidden.every((d) => !d.roundTrip)).toBe(true);
    expect(shown.length).toBe(deals.length);
    expect(hidden.length).toBeLessThan(shown.length);
  });

  it('the real round-trip pair (ARIHANT buy and sell in AGIIL on 2026-01-01) is flagged on both rows', () => {
    const pair = deals.filter(
      (d) => d.sym === 'AGIIL' && d.date === '2026-01-01' && d.client.startsWith('ARIHANT'),
    );
    expect(pair.map((d) => d.side).sort()).toEqual(['BUY', 'SELL']);
    expect(pair.every((d) => d.roundTrip)).toBe(true);
  });

  it('FII selling to DII lists only stocks where FII is net negative and DII net positive', () => {
    const { fiiSellDiiBuy, fiiBuyDiiSell } = fiiDiiLists(stockFlows(flows, null, null));
    for (const r of fiiSellDiiBuy) expect(r.fiiNetCr < 0 && r.diiNetCr > 0).toBe(true);
    for (const r of fiiBuyDiiSell) expect(r.fiiNetCr > 0 && r.diiNetCr < 0).toBe(true);
  });

  it('the entity page lists every alias of the entity (one entity, several spellings)', () => {
    const gs = entities.find((e) => e.entityId === 'goldman-sachs')!;
    expect(gs.aliases.length).toBeGreaterThanOrEqual(3);
    const mine = entityDeals(deals, 'goldman-sachs');
    expect(new Set(mine.map((d) => d.client))).toEqual(new Set(gs.aliases));
  });

  it('top entities rank by net value in the range, with the category shown', () => {
    const bought = topEntitiesInRange(deals, null, null, 'all', 'bought', 5);
    for (let i = 1; i < bought.length; i++)
      expect(bought[i - 1]!.netValueCr >= bought[i]!.netValueCr).toBe(true);
    for (const e of bought) expect(['FII', 'DII', 'Other']).toContain(e.entityCategory);
  });
});

describe('wording', () => {
  it('deal chips say bought or sold, never buy or sell', () => {
    const chip = dealChip({ entityCategory: 'DII', type: 'block', side: 'BUY', valueCr: 120 });
    expect(chip).toBe('DII block bought ₹120 Cr');
    expect(dealChip({ entityCategory: 'FII', type: 'bulk', side: 'SELL', valueCr: 3.5 })).toBe(
      'FII bulk sold ₹3.5 Cr',
    );
    expect(chip).not.toMatch(/\b(buy|sell)\b/i);
  });
});
