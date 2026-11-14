/**
 * ECharts options for the Phase 4 views: FII/DII cash (P6 Cash), participant positioning (P6 Derivatives), FII
 * derivatives (P6 FII derivatives), the monthly deal-flow bars (stock page and P7), the entity timeline (P7 Entity) and
 * the deal markers on the stock chart (05 section 2). Each builder is pure: data in, option out.
 */

import type { EChartsOption } from './echarts';
import type { Palette } from './theme';
import type { CashRow, Deal, FiiDerivRow, ParticipantRow } from '../types/data';
import { fmtDate } from '../lib/format';
import { cashStreakOf, participantLongPct, percentileBand } from '../lib/institutional';

/** FII blue and DII teal (delivery increase blue, the teal family for the second series); Other grey. */
export const DEAL_COLORS = { FII: '#1d6fd1', DII: '#0e7490', Other: '#94a3b8' } as const;

const axis = (p: Palette) => ({
  axisLine: { lineStyle: { color: p.grid } },
  axisLabel: { color: p.muted },
  splitLine: { lineStyle: { color: p.grid } },
});

export function cashOption(rows: readonly CashRow[], p: Palette, mobile: boolean): EChartsOption {
  const dates = rows.map((r) => r.date);
  let fiiCum = 0;
  let diiCum = 0;
  const fiiCumLine = rows.map((r) => {
    if (r.fiiNet !== null) fiiCum += r.fiiNet;
    return r.fiiNet === null ? null : Math.round(fiiCum * 100) / 100;
  });
  const diiCumLine = rows.map((r) => {
    if (r.diiNet !== null) diiCum += r.diiNet;
    return r.diiNet === null ? null : Math.round(diiCum * 100) / 100;
  });
  return {
    textStyle: { color: p.text },
    grid: [{ left: 56, right: 16, top: 30, bottom: mobile ? 56 : 40 }],
    legend: { top: 0, textStyle: { color: p.muted } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: p.muted, formatter: (v: string) => fmtDate(v).slice(0, -5) },
    },
    yAxis: [
      { type: 'value', name: 'Rs Cr, daily net', nameTextStyle: { color: p.muted }, ...axis(p) },
      {
        type: 'value',
        name: 'Rs Cr, since collection',
        nameTextStyle: { color: p.muted },
        ...axis(p),
        position: 'right',
      },
    ],
    series: [
      {
        name: 'FII net, day',
        type: 'bar',
        data: rows.map((r) => r.fiiNet),
        itemStyle: { color: DEAL_COLORS.FII },
      },
      {
        name: 'DII net, day',
        type: 'bar',
        data: rows.map((r) => r.diiNet),
        itemStyle: { color: DEAL_COLORS.DII },
      },
      {
        name: 'FII cumulative',
        type: 'line',
        yAxisIndex: 1,
        data: fiiCumLine,
        showSymbol: false,
        lineStyle: { color: DEAL_COLORS.FII, type: 'dashed' },
      },
      {
        name: 'DII cumulative',
        type: 'line',
        yAxisIndex: 1,
        data: diiCumLine,
        showSymbol: false,
        lineStyle: { color: DEAL_COLORS.DII, type: 'dashed' },
      },
    ],
    dataZoom: [{ type: 'inside' }, ...(mobile ? [] : [{ type: 'slider', height: 18 }])],
  } as EChartsOption;
}

/** Index futures long share for FII (%), with the 10th to 90th percentile band of its own history (P6 tab 2). */
export function fiiLongPctOption(oi: readonly ParticipantRow[], p: Palette): EChartsOption {
  const fii = oi.filter((r) => r.participant === 'FII').sort((a, b) => a.date.localeCompare(b.date));
  const dates = fii.map((r) => r.date);
  const vals = fii.map((r) => participantLongPct(r));
  const band = percentileBand(vals, 10, 90);
  return {
    textStyle: { color: p.text },
    grid: [{ left: 56, right: 16, top: 30, bottom: 40 }],
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: p.muted, formatter: (v: string) => fmtDate(v).slice(0, -5) },
    },
    yAxis: {
      type: 'value',
      name: '% of index futures contracts',
      nameTextStyle: { color: p.muted },
      ...axis(p),
    },
    series: [
      {
        name: 'FII index futures, long share',
        type: 'line',
        data: vals,
        showSymbol: false,
        lineStyle: { color: DEAL_COLORS.FII },
        markArea: band
          ? {
              silent: true,
              itemStyle: { color: p.band },
              data: [[{ yAxis: band.lo }, { yAxis: band.hi }]],
            }
          : undefined,
      },
    ],
    dataZoom: [{ type: 'inside' }],
  } as EChartsOption;
}

/** Net index-futures contracts by participant (long minus short), one line each (P6 tab 2). */
export function netIndexFuturesOption(oi: readonly ParticipantRow[], p: Palette): EChartsOption {
  const dates = [...new Set(oi.map((r) => r.date))].sort();
  const by = (who: string) => {
    const m = new Map(
      oi.filter((r) => r.participant === who).map((r) => [r.date, r.futIdxLong - r.futIdxShort]),
    );
    return dates.map((d) => m.get(d) ?? null);
  };
  const colors: Record<string, string> = {
    FII: DEAL_COLORS.FII,
    DII: DEAL_COLORS.DII,
    Pro: '#d9730d',
    Client: '#7c3aed',
  };
  return {
    textStyle: { color: p.text },
    grid: [{ left: 64, right: 16, top: 30, bottom: 40 }],
    legend: { top: 0, textStyle: { color: p.muted } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: p.muted, formatter: (v: string) => fmtDate(v).slice(0, -5) },
    },
    yAxis: {
      type: 'value',
      name: 'Contracts, long minus short',
      nameTextStyle: { color: p.muted },
      ...axis(p),
    },
    series: ['FII', 'DII', 'Pro', 'Client'].map((w) => ({
      name: w,
      type: 'line' as const,
      data: by(w),
      showSymbol: false,
      lineStyle: { color: colors[w] },
    })),
    dataZoom: [{ type: 'inside' }],
  } as EChartsOption;
}

/** Share of index-futures volume by participant (stacked area, P6 tab 2). Shares sum to 100 on each date. */
export function volumeShareOption(vol: readonly ParticipantRow[], p: Palette): EChartsOption {
  const dates = [...new Set(vol.map((r) => r.date))].sort();
  const who = ['FII', 'DII', 'Pro', 'Client'] as const;
  const tot = new Map<string, number>();
  const vals = new Map<string, Map<string, number>>();
  for (const r of vol) {
    const v = r.futIdxLong + r.futIdxShort;
    tot.set(r.date, (tot.get(r.date) ?? 0) + v);
    const m = vals.get(r.participant) ?? new Map<string, number>();
    m.set(r.date, v);
    vals.set(r.participant, m);
  }
  const colors: Record<string, string> = {
    FII: DEAL_COLORS.FII,
    DII: DEAL_COLORS.DII,
    Pro: '#d9730d',
    Client: '#94a3b8',
  };
  return {
    textStyle: { color: p.text },
    grid: [{ left: 56, right: 16, top: 30, bottom: 40 }],
    legend: { top: 0, textStyle: { color: p.muted } },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => `${Number(v).toFixed(1)}%` },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: p.muted, formatter: (v: string) => fmtDate(v).slice(0, -5) },
    },
    yAxis: { type: 'value', max: 100, name: '% of volume', nameTextStyle: { color: p.muted }, ...axis(p) },
    series: who.map((w) => ({
      name: w,
      type: 'line' as const,
      stack: 'share',
      areaStyle: { opacity: 0.5 },
      showSymbol: false,
      lineStyle: { width: 1, color: colors[w] },
      itemStyle: { color: colors[w] },
      data: dates.map((d) => {
        const t = tot.get(d) ?? 0;
        return t > 0 ? Math.round(((vals.get(w)?.get(d) ?? 0) / t) * 10000) / 100 : null;
      }),
    })),
  } as EChartsOption;
}

/** FII derivatives (S7): net bought value by category on one date (bars). */
export function fiiDerivNetOption(rows: readonly FiiDerivRow[], date: string, p: Palette): EChartsOption {
  const day = rows.filter((r) => r.date === date && r.level === 'total');
  const cats = day.map((r) => r.category);
  return {
    textStyle: { color: p.text },
    grid: [{ left: 64, right: 16, top: 24, bottom: 56 }],
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: cats, axisLabel: { color: p.muted, interval: 0, rotate: 15 } },
    yAxis: { type: 'value', name: 'Rs Cr, bought minus sold', nameTextStyle: { color: p.muted }, ...axis(p) },
    series: [
      {
        name: 'Net bought value',
        type: 'bar',
        data: day.map((r) =>
          r.buyAmtCr === null || r.sellAmtCr === null
            ? null
            : Math.round((r.buyAmtCr - r.sellAmtCr) * 100) / 100,
        ),
        itemStyle: { color: DEAL_COLORS.FII },
      },
    ],
  } as EChartsOption;
}

/** FII derivatives (S7): open interest value of each total category over time. */
export function fiiDerivOiOption(rows: readonly FiiDerivRow[], p: Palette): EChartsOption {
  const totals = rows.filter((r) => r.level === 'total');
  const dates = [...new Set(totals.map((r) => r.date))].sort();
  const cats = [...new Set(totals.map((r) => r.category))];
  return {
    textStyle: { color: p.text },
    grid: [{ left: 64, right: 16, top: 30, bottom: 40 }],
    legend: { top: 0, textStyle: { color: p.muted } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: p.muted, formatter: (v: string) => fmtDate(v).slice(0, -5) },
    },
    yAxis: { type: 'value', name: 'Rs Cr, open interest', nameTextStyle: { color: p.muted }, ...axis(p) },
    series: cats.map((c, i) => ({
      name: c,
      type: 'line' as const,
      showSymbol: false,
      data: dates.map((d) => totals.find((r) => r.date === d && r.category === c)?.oiAmtCr ?? null),
      lineStyle: { color: [DEAL_COLORS.FII, DEAL_COLORS.DII, '#d9730d', '#7c3aed'][i % 4] },
    })),
    dataZoom: [{ type: 'inside' }],
  } as EChartsOption;
}

/** Monthly deal-flow bars: FII, DII and Other net via deals (stock page, P7). */
export function dealFlowBarsOption(
  m: { months: string[]; fii: number[]; dii: number[]; other: number[] },
  p: Palette,
): EChartsOption {
  return {
    textStyle: { color: p.text },
    grid: [{ left: 56, right: 16, top: 30, bottom: 40 }],
    legend: { top: 0, textStyle: { color: p.muted } },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => `${Number(v).toFixed(2)} Cr` },
    xAxis: { type: 'category', data: m.months, axisLabel: { color: p.muted } },
    yAxis: { type: 'value', name: 'Rs Cr, net', nameTextStyle: { color: p.muted }, ...axis(p) },
    series: [
      { name: 'FII', type: 'bar', data: m.fii, itemStyle: { color: DEAL_COLORS.FII } },
      { name: 'DII', type: 'bar', data: m.dii, itemStyle: { color: DEAL_COLORS.DII } },
      { name: 'Other', type: 'bar', data: m.other, itemStyle: { color: DEAL_COLORS.Other } },
    ],
  } as EChartsOption;
}

/** Entity timeline (P7 Entity): one dot per deal, date by value; bought above zero, sold below. */
export function entityTimelineOption(
  deals: readonly { date: string; side: 'BUY' | 'SELL'; valueCr: number; sym: string }[],
  p: Palette,
): EChartsOption {
  const pts = deals.map((d) => ({
    value: [d.date, d.side === 'BUY' ? d.valueCr : -d.valueCr],
    name: d.sym,
    itemStyle: { color: d.side === 'BUY' ? p.up : p.down },
  }));
  return {
    textStyle: { color: p.text },
    grid: [{ left: 56, right: 16, top: 16, bottom: 40 }],
    tooltip: {
      trigger: 'item',
      formatter: (x: { value: [string, number]; name: string }) =>
        `${fmtDate(x.value[0])} ${x.name} ${x.value[1] > 0 ? 'bought' : 'sold'} ${Math.abs(x.value[1]).toFixed(2)} Cr`,
    },
    xAxis: { type: 'time', axisLabel: { color: p.muted } },
    yAxis: {
      type: 'value',
      name: 'Rs Cr, bought (+) or sold (−)',
      nameTextStyle: { color: p.muted },
      ...axis(p),
    },
    series: [{ type: 'scatter', symbolSize: 10, data: pts }],
  } as EChartsOption;
}

/** Deal markers for the stock price chart: ▲ bought above the high, ▼ sold below the low, sized by value (05 section 2). */
export function dealMarkPoints(
  deals: readonly Deal[],
  rows: readonly { date: string; high: number | null; low: number | null }[],
  p: Palette,
): {
  coord: [string, number];
  value: number;
  symbol: string;
  symbolRotate: number;
  symbolSize: number;
  itemStyle: { color: string };
  name: string;
}[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  for (const d of deals) {
    if (d.roundTrip) continue;
    const r = byDate.get(d.date);
    if (!r || r.high === null || r.low === null) continue;
    const isBuy = d.side === 'BUY';
    out.push({
      coord: [d.date, isBuy ? r.high : r.low] as [string, number],
      value: d.valueCr,
      symbol: 'triangle',
      symbolRotate: isBuy ? 0 : 180,
      symbolSize: Math.min(22, Math.max(8, 6 + Math.sqrt(d.valueCr) * 2)),
      itemStyle: { color: isBuy ? p.up : p.down },
      name: `${d.entityCategory ?? 'Other'} ${d.type} ${isBuy ? 'bought' : 'sold'} ${d.valueCr.toFixed(2)} Cr`,
    });
  }
  return out;
}

/** Cash streak helper for the cash tab (days of net buying or net selling). */
export const streakLabel = (rows: readonly CashRow[], key: 'fiiNet' | 'diiNet'): string => {
  const s = cashStreakOf(rows, key);
  if (s === 0) return 'no streak yet';
  return `${Math.abs(s)} day${Math.abs(s) === 1 ? '' : 's'} of net ${s > 0 ? 'buying' : 'selling'}`;
};
