/**
 * The run library page's two charts (07 section 7): grouped bars of the UP, DOWN and ordinary medians per feature, and
 * per-feature quintile bars of P(big up) and P(big down) with the base rates as dashed lines.
 */

import { FEATURE_LABEL, type FeatureId } from '../lib/runs';
import type { MediansSeries, OddsSeries } from '../lib/runLibrary';
import type { EChartsOption } from './echarts';
import { RUN_COLOR } from './runs';
import type { Palette } from './theme';

/** The ordinary-days colour: the slate of the pre window (07 section 7 footprint card). */
const ORDINARY = { light: '#64748b', dark: '#94a3b8' } as const;

const SHORT: Record<FeatureId, string> = {
  delivValRatio: 'Delivery value (x)',
  delivPctChgPp: 'Delivery % chg (pp)',
  turnoverRatio: 'Turnover (x)',
  tradeSizeRatio: 'Trade size (x)',
  delivBalance: 'Delivery balance (x)',
  spikeDays: 'Spike days',
  priceChgPct: 'Price change (%)',
};

export function mediansOption(s: MediansSeries, p: Palette, mobile: boolean, dark: boolean): EChartsOption {
  const val = (v: number | null) => (v === null ? '-' : v);
  return {
    textStyle: { color: p.text },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: p.bg,
      borderColor: p.grid,
      textStyle: { color: p.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        const i = ps[0]?.dataIndex ?? 0;
        const f = s.features[i]!;
        const rows = [
          `UP runs: ${fmtOrDash(s.up[i])}`,
          `DOWN runs: ${fmtOrDash(s.down[i])}`,
          `Ordinary days: ${fmtOrDash(s.ordinary[i])}`,
        ];
        return [`<b>${FEATURE_LABEL[f]}</b>`, ...rows].join('<br/>');
      },
    },
    legend: { top: 0, textStyle: { color: p.muted, fontSize: 11 } },
    grid: { left: 52, right: 12, top: 36, bottom: mobile ? 84 : 64, containLabel: true },
    xAxis: {
      type: 'category',
      data: s.features.map((f) => SHORT[f]),
      axisLabel: { color: p.muted, interval: 0, rotate: mobile ? 30 : 0, fontSize: mobile ? 10 : 11 },
      axisLine: { lineStyle: { color: p.grid } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: p.muted },
      splitLine: { lineStyle: { color: p.grid } },
    },
    series: [
      {
        name: 'UP runs',
        type: 'bar',
        data: s.up.map(val),
        itemStyle: { color: RUN_COLOR.UP[dark ? 'dark' : 'light'] },
      },
      {
        name: 'DOWN runs',
        type: 'bar',
        data: s.down.map(val),
        itemStyle: { color: RUN_COLOR.DOWN[dark ? 'dark' : 'light'] },
      },
      {
        name: 'Ordinary days',
        type: 'bar',
        data: s.ordinary.map(val),
        itemStyle: { color: ORDINARY[dark ? 'dark' : 'light'] },
      },
    ],
  };
}

const fmtOrDash = (v: number | null): string => (v === null ? '—' : String(v));

const UP_COLOR = { light: '#0f766e', dark: '#2dd4bf' } as const;
const DOWN_COLOR = { light: '#c2410c', dark: '#fb923c' } as const;

/** One feature's quintile bars: P(big up) and P(big down) in percent, the base rates as dashed lines. */
export function oddsOption(s: OddsSeries, p: Palette, dark: boolean, mobile: boolean): EChartsOption {
  const cats = s.cells.map((c) => `Q${c.quintile}`);
  const base = s.base;
  const lines = (v: number | null, color: string) =>
    v === null
      ? []
      : [
          {
            yAxis: v,
            lineStyle: { color, type: 'dashed' as const, width: 1 },
            label: { show: false },
          },
        ];
  return {
    textStyle: { color: p.text },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: p.bg,
      borderColor: p.grid,
      textStyle: { color: p.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        const c = s.cells[ps[0]?.dataIndex ?? 0];
        if (!c) return '';
        return [
          `<b>${FEATURE_LABEL[s.feature]}, ${cats[ps[0]?.dataIndex ?? 0]}</b>`,
          `Stock-days in quintile: ${c.n}`,
          `P(big up): ${fmtPct(c.bigUpPct)}`,
          `P(big down): ${fmtPct(c.bigDownPct)}`,
        ].join('<br/>');
      },
    },
    legend: { top: 0, textStyle: { color: p.muted, fontSize: 11 } },
    grid: { left: 44, right: 10, top: 30, bottom: 28, containLabel: true },
    xAxis: {
      type: 'category',
      data: cats,
      axisLabel: { color: p.muted, fontSize: mobile ? 10 : 11 },
      axisLine: { lineStyle: { color: p.grid } },
    },
    yAxis: {
      type: 'value',
      name: '%',
      nameTextStyle: { color: p.muted },
      axisLabel: { color: p.muted, formatter: (v: number) => `${v}%` },
      splitLine: { lineStyle: { color: p.grid } },
    },
    series: [
      {
        name: 'P(big up)',
        type: 'bar',
        data: s.cells.map((c) => c.bigUpPct),
        itemStyle: { color: UP_COLOR[dark ? 'dark' : 'light'] },
        markLine: {
          symbol: 'none',
          silent: true,
          animation: false,
          data: lines(base?.bigUpPct ?? null, UP_COLOR[dark ? 'dark' : 'light']),
        },
      },
      {
        name: 'P(big down)',
        type: 'bar',
        data: s.cells.map((c) => c.bigDownPct),
        itemStyle: { color: DOWN_COLOR[dark ? 'dark' : 'light'] },
        markLine: {
          symbol: 'none',
          silent: true,
          animation: false,
          data: lines(base?.bigDownPct ?? null, DOWN_COLOR[dark ? 'dark' : 'light']),
        },
      },
    ],
  } as EChartsOption;
}

const fmtPct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(2)}%`);
