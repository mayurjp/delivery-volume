/**
 * The Stock page's Runs tab chart (07 section 7): the price with runs shaded (UP teal, DOWN orange), the selected run's
 * pre, early and full windows, the deal, results, corporate-action and quarter-end markers, and the footprint pane
 * (delivBal60 and delivValRatio60 from lib/footprints.ts) underneath.
 */

import { footprintSeries, type FootIndicators } from '../lib/footprints';
import { fmtDate, fmtPctChg, fmtPrice, fmtRatio } from '../lib/format';
import { inSpan, windowSpans, type RunRec, type Span } from '../lib/runs';
import type { CorpAction, Deal, SymbolRow } from '../types/data';
import { dealMarkPoints } from './deals';
import type { EChartsOption } from './echarts';
import type { Palette } from './theme';

export const RUN_COLOR = {
  UP: { light: '#0f766e', dark: '#2dd4bf' },
  DOWN: { light: '#c2410c', dark: '#fb923c' },
} as const;

/** The selected run's windows: pre (slate), early (violet), full (amber). */
export const WINDOW_COLOR = {
  pre: '#64748b',
  early: '#7c3aed',
  full: '#eab308',
} as const;

const isQuarterEnd = (dates: readonly string[], i: number): boolean => {
  const month = Number(dates[i]!.slice(5, 7));
  const last = i === dates.length - 1 || dates[i + 1]!.slice(5, 7) !== dates[i]!.slice(5, 7);
  return [3, 6, 9, 12].includes(month) && last;
};

export interface RunsChartInput {
  rows: readonly SymbolRow[];
  runs: readonly RunRec[];
  selected: number | null;
  deals: readonly Deal[];
  resultsDates: readonly string[];
  corp: readonly CorpAction[];
  /** Precomputed footprint series, one entry per row (footprintSeries). */
  foot?: readonly FootIndicators[];
}

/** Which run covers each row (the run's full span), or -1. Later runs win on a shared pivot day. */
export function runIndexByRow(rows: readonly { date: string }[], runs: readonly RunRec[]): number[] {
  const dates = rows.map((r) => r.date);
  const out = new Array<number>(rows.length).fill(-1);
  runs.forEach((run, k) => {
    const full = windowSpans(run, dates).full;
    if (!full) return;
    for (let i = full[0]; i <= full[1]; i++) out[i] = k;
  });
  return out;
}

/** The selected run's window of each row (pre, early or full), or null. */
export function selectedWindowByRow(
  rows: readonly { date: string }[],
  run: RunRec | null,
): { window: ('pre' | 'early' | 'full' | null)[]; spans: Record<'pre' | 'early' | 'full', Span | null> } {
  const dates = rows.map((r) => r.date);
  const spans = run ? windowSpans(run, dates) : { pre: null, early: null, full: null, post: null };
  // The early days lie inside the full run, and the start pivot lies in both pre and full: the most specific wins
  // (early, then full, then pre).
  const window = rows.map((_, i) => {
    if (inSpan(spans.early, i)) return 'early' as const;
    if (inSpan(spans.full, i)) return 'full' as const;
    if (inSpan(spans.pre, i)) return 'pre' as const;
    return null;
  });
  return { window, spans: { pre: spans.pre, early: spans.early, full: spans.full } };
}

export function runsChartOption(
  input: RunsChartInput,
  p: Palette,
  mobile: boolean,
  dark: boolean,
): EChartsOption {
  const { rows, runs, selected, deals, resultsDates, corp } = input;
  const dates = rows.map((r) => r.date);
  const closes = rows.map((r) => r.close);
  const valid = closes.filter((c): c is number => c !== null);
  const yMin = valid.length ? Math.min(...valid) * 0.95 : 0;
  const yMax = valid.length ? Math.max(...valid) * 1.03 : 1;
  const foot = input.foot ?? footprintSeries(rows);
  const runOf = runIndexByRow(rows, runs);
  const sel = selected !== null ? (runs[selected] ?? null) : null;
  const selWin = selectedWindowByRow(rows, sel);

  const runBars = rows.map((_, i) => {
    const k = runOf[i]!;
    if (k < 0) return null;
    const dir = runs[k]!.dir;
    return { value: yMax, itemStyle: { color: RUN_COLOR[dir][dark ? 'dark' : 'light'], opacity: 0.2 } };
  });
  const windowBars = rows.map((_, i) => {
    const w = selWin.window[i];
    if (!w) return null;
    const color = WINDOW_COLOR[w];
    return { value: yMax, itemStyle: { color, opacity: w === 'full' ? 0.35 : 0.4 } };
  });

  const resultsSet = new Set(resultsDates);
  const markLines = [
    ...resultsDates
      .filter((d) => dates.includes(d))
      .map((d) => ({
        xAxis: d,
        label: { show: !mobile, formatter: 'Results', color: p.muted, fontSize: 10 },
        lineStyle: { color: p.line2, type: 'solid' as const, width: 1 },
      })),
    ...corp
      .filter((c) => dates.includes(c.exDate))
      .map((c) => ({
        xAxis: c.exDate,
        label: { show: false },
        lineStyle: { color: p.muted, type: 'dashed' as const, width: 1 },
      })),
    ...dates
      .map((d, i) => (isQuarterEnd(dates, i) && !resultsSet.has(d) ? d : null))
      .filter((d): d is string => d !== null)
      .map((d) => ({
        xAxis: d,
        label: { show: false },
        lineStyle: { color: p.grid, type: 'dotted' as const, width: 1 },
      })),
  ];

  const runLabel = (k: number) => {
    const r = runs[k]!;
    return `${r.dir === 'UP' ? 'UP' : 'DOWN'} run ${fmtDate(r.start)} to ${fmtDate(r.end)}: ${fmtPctChg(r.movePct, 1)} over ${r.days} days`;
  };

  const axisBase = {
    axisLine: { lineStyle: { color: p.grid } },
    axisLabel: { color: p.muted },
    splitLine: { lineStyle: { color: p.grid } },
  };

  return {
    textStyle: { color: p.text },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      triggerOn: 'mousemove|click',
      confine: true,
      backgroundColor: p.bg,
      borderColor: p.grid,
      textStyle: { color: p.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const i = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
        const r = rows[i];
        if (!r) return '';
        const lines = [`<b>${fmtDate(r.date)}</b>`, `Close ${fmtPrice(r.close)}`];
        const k = runOf[i]!;
        if (k >= 0) lines.push(runLabel(k));
        const f = foot[i];
        if (f && f.delivBal60 !== null) lines.push(`Delivery balance (60 days) ${fmtRatio(f.delivBal60, 2)}`);
        if (f && f.delivValRatio60 !== null)
          lines.push(`Delivery value, 20 vs prior 60 days ${fmtRatio(f.delivValRatio60, 2)}`);
        return lines.join('<br/>');
      },
    },
    legend: { show: false },
    grid: [
      { left: 56, right: 12, top: 14, height: '56%' },
      { left: 56, right: 12, top: '74%', height: '18%' },
    ],
    xAxis: [0, 1].map((gi) => ({
      type: 'category' as const,
      gridIndex: gi,
      data: dates,
      boundaryGap: true,
      axisLabel: { show: gi === 1, color: p.muted, formatter: (v: string) => fmtDate(v).slice(0, -5) },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: p.grid } },
      axisPointer: { show: true, label: { show: gi === 1 } },
    })),
    yAxis: [
      {
        gridIndex: 0,
        scale: false,
        min: yMin,
        max: yMax,
        ...axisBase,
        name: 'Close (Rs)',
        nameTextStyle: { color: p.muted, align: 'left' as const },
        nameGap: 6,
      },
      {
        gridIndex: 1,
        scale: true,
        ...axisBase,
        name: 'Footprint (x)',
        nameTextStyle: { color: p.muted, align: 'left' as const },
        nameGap: 6,
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
      {
        type: 'slider',
        xAxisIndex: [0, 1],
        start: 0,
        end: 100,
        height: 18,
        bottom: 2,
        borderColor: p.grid,
        textStyle: { color: p.muted },
      },
    ],
    series: [
      {
        name: 'Runs',
        type: 'bar',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: runBars,
        barWidth: '100%',
        barCategoryGap: '0%',
        silent: true,
        z: 1,
        tooltip: { show: false },
      },
      {
        name: 'Selected run windows',
        type: 'bar',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: windowBars,
        barWidth: '100%',
        barCategoryGap: '0%',
        silent: true,
        z: 2,
        tooltip: { show: false },
      },
      {
        name: 'Close',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: closes,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: p.line, width: 1.4 },
        itemStyle: { color: p.line },
        z: 3,
        markPoint: { data: dealMarkPoints(deals, rows, p), animation: false },
        markLine: { symbol: 'none', silent: true, animation: false, data: markLines },
      },
      {
        name: 'Delivery balance, 60 days',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: foot.map((f) => f.delivBal60),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: p.inc, width: 1.4 },
        itemStyle: { color: p.inc },
        markLine: {
          symbol: 'none',
          silent: true,
          animation: false,
          data: [
            {
              yAxis: 1,
              lineStyle: { color: p.muted, type: 'dashed' as const, width: 1 },
              label: { show: false },
            },
          ],
        },
      },
      {
        name: 'Delivery value, 20 vs prior 60 days',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: foot.map((f) => f.delivValRatio60),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: p.dec, width: 1.4 },
        itemStyle: { color: p.dec },
      },
    ],
  } as EChartsOption;
}
