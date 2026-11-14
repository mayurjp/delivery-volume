import { fmtDateShort, fmtNum, fmtPct, fmtPrice } from '../lib/format';
import type { RunRec } from '../lib/runs';
import type { TimelineWeek } from '../lib/trail';
import type { SectorGrid, SectorRow } from '../lib/trailView';
import type { EChartsOption } from './echarts';
import { runBarData } from './runs';
import type { Palette } from './theme';

/** Sector rotation: share of stocks leaning A minus the share leaning D, per sector (blue = more A, orange = more D). */
export function sectorBarOption(rows: readonly SectorRow[], p: Palette, mobile: boolean): EChartsOption {
  const data = [...rows].reverse();
  return {
    grid: { left: mobile ? 8 : 12, right: 16, top: 8, bottom: 24, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        const r = data[ps[0]!.dataIndex]!;
        return `${r.sector}<br/>${r.nA} leaning A, ${r.nD} leaning D of ${r.n} stocks<br/>Net ${fmtNum(r.netPp, 0)} pp`;
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: p.muted, formatter: '{value} pp' },
      splitLine: { lineStyle: { color: p.grid } },
    },
    yAxis: {
      type: 'category',
      data: data.map((r) => r.sector),
      axisLabel: { color: p.text, fontSize: 11, width: mobile ? 110 : 190, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: data.map((r) => ({
          value: Math.round(r.netPp * 10) / 10,
          itemStyle: { color: r.netPp >= 0 ? p.inc : p.dec },
        })),
      },
    ],
  };
}

/** Sector x week grid: net share of stocks coded A minus D in each week (blue = A, orange = D, grey = none coded). */
export function sectorGridOption(
  g: SectorGrid,
  weeks: readonly (string | null)[],
  p: Palette,
  mobile: boolean,
): EChartsOption {
  const labels = weeks.map((w) => (w ? fmtDateShort(w) : ''));
  const data: [number, number, number | null][] = [];
  g.cells.forEach((row, y) => row.forEach((v, x) => data.push([x, y, v === null ? null : Math.round(v)])));
  return {
    grid: { left: 8, right: 8, top: 8, bottom: mobile ? 54 : 44, containLabel: true },
    tooltip: {
      formatter: (q: unknown) => {
        const d = (q as { data: [number, number, number | null] }).data;
        return `${g.sectors[d[1]]}<br/>week ending ${labels[d[0]]}<br/>${d[2] === null ? 'no coded stock' : `net ${d[2]} pp (A minus D)`}`;
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: p.muted, interval: mobile ? 12 : 5, rotate: 0, fontSize: 10 },
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      data: g.sectors,
      axisLabel: { color: p.text, fontSize: 10, width: mobile ? 90 : 170, overflow: 'truncate' },
    },
    visualMap: {
      min: -60,
      max: 60,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 10,
      itemHeight: 120,
      text: ['more A', 'more D'],
      textStyle: { color: p.muted, fontSize: 10 },
      inRange: { color: [p.dec, p.divMid, p.inc] },
      outOfRange: { color: p.nonDelivered },
    },
    series: [
      {
        type: 'heatmap',
        data: data.map((d) => ({
          value: d,
          itemStyle: d[2] === null ? { color: 'transparent' } : undefined,
        })),
        emphasis: { itemStyle: { borderColor: p.text, borderWidth: 1 } },
      },
    ],
  };
}

/**
 * The run shading of the stock trail (07 6A row 5B): the runs covering each week (`coverage`, from runCoverage), shaded
 * with the same bars as the Stock page's Runs tab. The price axis is fixed to [yMin, yMax] so the bars fill it.
 */
export interface TrailRunShade {
  coverage: readonly number[];
  runs: readonly RunRec[];
  yMin: number;
  yMax: number;
  dark: boolean;
}

/** Stock trail chart: weekly close as a line, with weekly delivery balance and spike-day bars underneath. */
export function stockTrailOption(
  timeline: readonly TimelineWeek[],
  closes: readonly (number | null)[],
  p: Palette,
  mobile: boolean,
  shade?: TrailRunShade,
): EChartsOption {
  const x = timeline.map((t) => fmtDateShort(t.end));
  const bal = timeline.map((t) => (t.delivBal === null ? null : Math.min(t.delivBal, 4)));
  return {
    grid: [
      { left: 8, right: 8, top: 14, height: mobile ? 150 : 190, containLabel: true },
      { left: 8, right: 8, top: mobile ? 220 : 260, height: mobile ? 90 : 110, containLabel: true },
    ],
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        const i = ps[0]!.dataIndex;
        const t = timeline[i]!;
        return [
          `Week ending ${t.end}`,
          `Close ${fmtPrice(closes[i] ?? null)}`,
          `Delivery balance (20 days) ${t.delivBal === null ? '—' : fmtNum(t.delivBal, 2) + '×'}`,
          `Delivery-spike days (20 days) ${t.spikeDays ?? '—'}`,
          `Week code ${t.overall} (${t.codes})`,
        ].join('<br/>');
      },
    },
    xAxis: [
      { type: 'category', data: x, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false } },
      {
        type: 'category',
        data: x,
        gridIndex: 1,
        axisLabel: { color: p.muted, interval: mobile ? 11 : 5, fontSize: 10 },
      },
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        scale: !shade,
        ...(shade ? { min: shade.yMin, max: shade.yMax } : {}),
        axisLabel: { color: p.muted },
        splitLine: { lineStyle: { color: p.grid } },
      },
      {
        type: 'value',
        gridIndex: 1,
        axisLabel: { color: p.muted, formatter: (v: number) => `${fmtNum(v, 1)}×` },
        splitLine: { lineStyle: { color: p.grid } },
        max: 4,
      },
      { type: 'value', gridIndex: 1, show: false, min: 0, max: 20 },
    ],
    series: [
      ...(shade
        ? [
            {
              name: 'Runs',
              type: 'bar' as const,
              xAxisIndex: 0,
              yAxisIndex: 0,
              data: runBarData(shade.coverage, shade.runs, shade.yMax, shade.dark),
              barWidth: '100%',
              barCategoryGap: '0%',
              silent: true,
              z: 1,
              tooltip: { show: false },
            },
          ]
        : []),
      {
        name: 'Close',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: closes.map((c) => (c === null ? '-' : c)),
        showSymbol: false,
        lineStyle: { color: p.line, width: 2 },
        z: 3,
      },
      {
        name: 'Delivery balance',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: bal.map((v) => ({
          value: v === null ? '-' : v,
          itemStyle: { color: v !== null && v >= 1 ? p.inc : p.dec },
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: p.muted, type: 'dashed' },
          data: [{ yAxis: 1 }],
          label: { show: false },
        },
      },
      {
        name: 'Spike days',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 2,
        data: timeline.map((t) => t.spikeDays ?? '-'),
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: p.line2, width: 1 },
        itemStyle: { color: p.line2 },
      },
    ],
  };
}

export const shareLabel = (v: number | null): string => (v === null ? '—' : fmtPct(v, 0));
