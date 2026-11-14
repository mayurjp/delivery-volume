import { fmtCr, fmtDate, fmtNum, fmtPct, fmtPctChg, fmtPp, fmtRatio } from '../lib/format';
import {
  axisRange,
  histogram,
  movingAvg,
  pin,
  quadrantLabel,
  type HeatItem,
  type TreeNode,
} from '../lib/heat';
import { splitPartial } from '../lib/statsSeries';
import type { EChartsOption } from './echarts';
import { divergeColor, type Palette } from './theme';

/** Charts of Phase 3: quadrant scatter, treemap, group x day grid, statistics. */

const tooltipBase = (p: Palette) => ({
  confine: true,
  triggerOn: 'mousemove|click' as const,
  backgroundColor: p.bg,
  borderColor: p.grid,
  textStyle: { color: p.text, fontSize: 12 },
});

const axisStyle = (p: Palette) => ({
  axisLine: { lineStyle: { color: p.grid } },
  axisLabel: { color: p.muted },
  splitLine: { lineStyle: { color: p.grid } },
});

export interface QuadPoint {
  sym: string;
  name: string;
  sector: string;
  x: number;
  y: number;
  size: number;
}

/** Quadrant scatter (04 section 4.3): dashed axes at 0, axes clamped at the 2nd/98th percentiles, outliers pinned. */
export function quadrantOption(
  points: readonly QuadPoint[],
  p: Palette,
  sectors: readonly string[],
  labels: { x: string; y: string },
  mobile: boolean,
): EChartsOption {
  const rx = axisRange(points.map((d) => d.x));
  const ry = axisRange(points.map((d) => d.y));
  const maxSize = Math.max(1, ...points.map((d) => d.size));
  const color = (s: string) => p.cat[Math.max(0, sectors.indexOf(s)) % p.cat.length]!;
  const data = points.map((d) => {
    const px = pin(d.x, rx);
    const py = pin(d.y, ry);
    return {
      value: [px.value, py.value],
      sym: d.sym,
      name: d.sym,
      full: d,
      symbol: px.pinned || py.pinned ? 'diamond' : 'circle',
      symbolSize: 4 + 14 * Math.sqrt(d.size / maxSize),
      itemStyle: {
        color: color(d.sector),
        opacity: 0.75,
        borderColor: px.pinned || py.pinned ? p.text : 'transparent',
      },
    };
  });
  return {
    textStyle: { color: p.text },
    tooltip: {
      ...tooltipBase(p),
      trigger: 'item',
      formatter: (e: unknown) => {
        const d = (e as { data: { full: QuadPoint } }).data.full;
        return `<b>${d.sym}</b> ${d.name}<br/>${d.sector}<br/>${labels.x} ${fmtNum(d.x, 1)}<br/>${labels.y} ${fmtNum(d.y, 1)}<br/>${quadrantLabel(d.x, d.y)}<br/>Click to open`;
      },
    },
    grid: { left: mobile ? 44 : 56, right: 16, top: 16, bottom: 44 },
    xAxis: {
      type: 'value',
      min: rx[0],
      max: rx[1],
      name: labels.x,
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: p.muted },
      ...axisStyle(p),
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: ry[0],
      max: ry[1],
      name: labels.y,
      nameTextStyle: { color: p.muted, align: 'left' },
      ...axisStyle(p),
      splitLine: { show: false },
    },
    series: [
      {
        type: 'scatter',
        data,
        large: false,
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: p.muted, type: 'dashed', width: 1 },
          data: [{ xAxis: 0 }, { yAxis: 0 }],
        },
      },
    ],
    graphic: mobile
      ? []
      : [
          {
            type: 'text',
            right: 24,
            top: 20,
            style: { text: 'Price ↑ on rising delivery', fill: p.muted, fontSize: 11 },
          },
          {
            type: 'text',
            left: 62,
            top: 20,
            style: { text: 'Price ↓ on rising delivery', fill: p.muted, fontSize: 11 },
          },
          {
            type: 'text',
            right: 24,
            bottom: 52,
            style: { text: 'Price ↑ on falling delivery', fill: p.muted, fontSize: 11 },
          },
          {
            type: 'text',
            left: 62,
            bottom: 52,
            style: { text: 'Price ↓ on falling delivery', fill: p.muted, fontSize: 11 },
          },
        ],
  };
}

/** Treemap: sector -> stock tiles sized by the chosen metric and coloured on the diverging scale. */
export function treemapOption(tree: readonly TreeNode[], p: Palette): EChartsOption {
  const fix = (n: TreeNode): unknown => ({
    name: n.name,
    value: n.value,
    sym: n.sym,
    item: n.item,
    itemStyle: { color: divergeColor(n.t, p), borderColor: p.bg, borderWidth: n.children ? 2 : 1 },
    children: n.children?.map(fix),
  });
  return {
    textStyle: { color: p.text },
    tooltip: {
      ...tooltipBase(p),
      formatter: (e: unknown) => {
        const d = (e as { data: { name: string; value: number; item?: HeatItem } }).data;
        const it = d.item;
        if (!it) return `<b>${d.name}</b><br/>${fmtCr(d.value)}`;
        return `<b>${it.sym}</b> ${it.name}<br/>Delivery ${fmtPct(it.dp)} (avg ${fmtPct(it.dpAvg)})<br/>Spike ${fmtRatio(it.spike)}<br/>Price ${fmtPctChg(it.ret, 2)}`;
      },
    },
    series: [
      {
        type: 'treemap',
        data: tree.map(fix),
        left: 0,
        right: 0,
        top: 0,
        bottom: 22,
        roam: false,
        nodeClick: 'zoomToNode',
        breadcrumb: {
          show: true,
          bottom: 0,
          height: 20,
          itemStyle: { color: p.grid, textStyle: { color: p.text } },
        },
        visibleMin: 40,
        label: {
          show: true,
          formatter: '{b}',
          color: p.text,
          // a halo in the page colour keeps the label readable on any tile colour, in both themes
          textBorderColor: p.bg,
          textBorderWidth: 2,
          fontSize: 11,
          overflow: 'truncate',
        },
        upperLabel: { show: true, height: 18, color: p.text, fontSize: 11 },
        levels: [
          {
            itemStyle: { borderColor: p.bg, borderWidth: 2, gapWidth: 2 },
            upperLabel: { show: true, height: 18, color: p.text, fontSize: 11 },
          },
          { itemStyle: { borderColor: p.bg, borderWidth: 1, gapWidth: 1 }, upperLabel: { show: false } },
        ],
      },
    ],
  } as EChartsOption;
}

export interface GridData {
  rows: string[];
  dates: string[];
  /** Column labels for week / month / quarter / N-day-bar columns (the date is used when absent). */
  labels?: string[];
  /** [dateIndex, rowIndex, value] */
  cells: [number, number, number | null][];
}

/** Group x day heat grid on the diverging scale: values are clamped to +-limit. */
export function gridOption(
  g: GridData,
  p: Palette,
  limit: number,
  unit: string,
  mobile: boolean,
): EChartsOption {
  return {
    textStyle: { color: p.text },
    tooltip: {
      ...tooltipBase(p),
      formatter: (e: unknown) => {
        const v = (e as { value: [number, number, number | null] }).value;
        return `${g.rows[v[1]]}<br/>${g.labels ? g.labels[v[0]] : fmtDate(g.dates[v[0]])}<br/>${v[2] === null ? 'no data' : unit === 'pp' ? fmtPp(v[2]) : fmtRatio(v[2])}`;
      },
    },
    grid: { left: mobile ? 104 : 190, right: 12, top: 8, bottom: 56 },
    xAxis: {
      type: 'category',
      data: g.labels ?? g.dates,
      axisLabel: {
        color: p.muted,
        formatter: (v: string) => (g.labels ? v : fmtDate(v).slice(0, -5)),
        interval: 'auto',
      },
      axisTick: { show: false },
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      data: g.rows,
      inverse: true,
      axisLabel: { color: p.muted, width: mobile ? 96 : 180, overflow: 'truncate' },
      axisTick: { show: false },
    },
    visualMap: {
      min: unit === 'pp' ? -limit : Math.log2(0.25),
      max: unit === 'pp' ? limit : Math.log2(4),
      dimension: 3,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 140,
      text: [unit === 'pp' ? `+${limit} pp` : '4×', unit === 'pp' ? `−${limit} pp` : '0.25×'],
      textStyle: { color: p.muted },
      inRange: { color: [p.divNeg, p.divMid, p.divPos] },
    },
    series: [
      {
        type: 'heatmap',
        data: g.cells.map(([x, y, v]) => [
          x,
          y,
          v,
          v === null
            ? null
            : unit === 'pp'
              ? Math.max(-limit, Math.min(limit, v))
              : Math.log2(Math.max(0.25, Math.min(4, v))),
        ]),
        itemStyle: { borderColor: p.bg, borderWidth: 1 },
      },
    ],
  };
}

export interface TrendSeries {
  name: string;
  values: (number | null)[];
}

export interface TrendOpts {
  /** X labels for periods and bars; the date is used when absent. */
  labels?: readonly string[];
  /** Points still in progress: drawn dashed and labelled. */
  partial?: readonly boolean[];
  /** Draw the 20-day average (daily points only). */
  ma?: boolean;
}

const isoLabel = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v).slice(0, -5) : v);

/** Delivery % of several groups; for daily points each also gets its 20-day average (thicker line). */
export function trendOption(
  dates: readonly string[],
  series: readonly TrendSeries[],
  p: Palette,
  opts: TrendOpts = {},
): EChartsOption {
  const ma = opts.ma ?? !opts.labels;
  const partial = opts.partial ?? [];
  const out: unknown[] = [];
  series.forEach((s, i) => {
    const color = p.cat[i % p.cat.length]!;
    const sp = splitPartial(s.values, partial);
    out.push({
      name: s.name,
      type: 'line',
      showSymbol: !ma,
      symbolSize: 5,
      data: sp.full,
      lineStyle: { color, width: ma ? 1 : 2, opacity: ma ? 0.55 : 1 },
      itemStyle: { color },
    });
    if (sp.hasPartial) {
      out.push({
        name: `${s.name} in progress`,
        type: 'line',
        showSymbol: true,
        symbolSize: 6,
        data: sp.dashed,
        lineStyle: { color, width: 2, type: 'dashed', opacity: 0.6 },
        itemStyle: { color, opacity: 0.6 },
      });
    }
    if (ma) {
      out.push({
        name: `${s.name} 20D avg`,
        type: 'line',
        showSymbol: false,
        data: movingAvg(s.values, 20),
        lineStyle: { color, width: 2.5 },
        itemStyle: { color },
      });
    }
  });
  return {
    textStyle: { color: p.text },
    legend: {
      top: 0,
      type: 'scroll',
      data: series.flatMap((x) => (ma ? [x.name, `${x.name} 20D avg`] : [x.name])),
      textStyle: { color: p.muted },
      itemHeight: 8,
    },
    tooltip: {
      ...tooltipBase(p),
      trigger: 'axis',
      valueFormatter: (v: unknown) => (typeof v === 'number' ? fmtPct(v) : '—'),
    },
    grid: { left: 48, right: 12, top: 40, bottom: 28 },
    xAxis: {
      type: 'category',
      data: (opts.labels ?? dates) as string[],
      axisLabel: { color: p.muted, formatter: isoLabel },
      axisLine: { lineStyle: { color: p.grid } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      name: 'Delivery % (value-weighted)',
      nameTextStyle: { color: p.muted, align: 'left' },
      ...axisStyle(p),
      axisLabel: { color: p.muted, formatter: (v: number) => `${v}%` },
    },
    series: out,
  } as EChartsOption;
}

/** Bars whose in-progress points are lighter and outlined with a dashed border. */
function barData(values: readonly (number | null)[], partial: readonly boolean[], color: string) {
  return values.map((v, i) => ({
    value: v,
    itemStyle: partial[i]
      ? { color, opacity: 0.4, borderColor: color, borderType: 'dashed' as const, borderWidth: 1 }
      : { color },
  }));
}

/** Delivery value and turnover per period (bars, ₹ Cr) with an optional index close on the right axis. */
export function flowsOption(
  labels: readonly string[],
  partial: readonly boolean[],
  data: {
    turnoverCr: readonly (number | null)[];
    delivValCr: readonly (number | null)[];
    index: { name: string; values: readonly (number | null)[] } | null;
  },
  p: Palette,
): EChartsOption {
  const series: unknown[] = [
    {
      name: 'Turnover',
      type: 'bar',
      data: barData(data.turnoverCr, partial, p.nonDelivered),
      barMaxWidth: 18,
    },
    { name: 'Delivery value', type: 'bar', data: barData(data.delivValCr, partial, p.inc), barMaxWidth: 18 },
  ];
  if (data.index) {
    series.push({
      name: data.index.name,
      type: 'line',
      yAxisIndex: 1,
      showSymbol: false,
      connectNulls: true,
      data: data.index.values,
      lineStyle: { color: p.dec, width: 2 },
      itemStyle: { color: p.dec },
    });
  }
  return {
    textStyle: { color: p.text },
    legend: { top: 0, type: 'scroll', textStyle: { color: p.muted }, itemHeight: 8 },
    tooltip: {
      ...tooltipBase(p),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v: unknown) => (typeof v === 'number' ? fmtNum(v, 0) : '—'),
    },
    grid: { left: 64, right: data.index ? 56 : 12, top: 40, bottom: 28 },
    xAxis: {
      type: 'category',
      data: labels as string[],
      axisLabel: { color: p.muted, formatter: isoLabel },
      axisLine: { lineStyle: { color: p.grid } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: '₹ Cr',
        nameTextStyle: { color: p.muted, align: 'left' },
        ...axisStyle(p),
        axisLabel: { color: p.muted, formatter: (v: number) => fmtNum(v, 0) },
      },
      {
        type: 'value',
        scale: true,
        show: !!data.index,
        name: data.index?.name ?? '',
        nameTextStyle: { color: p.muted, align: 'right' },
        axisLine: { lineStyle: { color: p.grid } },
        axisLabel: { color: p.muted },
        splitLine: { show: false },
      },
    ],
    series,
  } as EChartsOption;
}

/** Advancing and declining stocks (stacked bars) and the count of delivery spikes of 2x or more (line, right axis). */
export function breadthOption(
  labels: readonly string[],
  partial: readonly boolean[],
  data: {
    adv: readonly (number | null)[];
    dec: readonly (number | null)[];
    spikes: readonly (number | null)[];
  },
  p: Palette,
): EChartsOption {
  return {
    textStyle: { color: p.text },
    legend: { top: 0, type: 'scroll', textStyle: { color: p.muted }, itemHeight: 8 },
    tooltip: { ...tooltipBase(p), trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 52, right: 52, top: 40, bottom: 28 },
    xAxis: {
      type: 'category',
      data: labels as string[],
      axisLabel: { color: p.muted, formatter: isoLabel },
      axisLine: { lineStyle: { color: p.grid } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Stock-days',
        nameTextStyle: { color: p.muted, align: 'left' },
        ...axisStyle(p),
      },
      {
        type: 'value',
        name: 'Spikes ≥ 2×',
        nameTextStyle: { color: p.muted, align: 'right' },
        axisLine: { lineStyle: { color: p.grid } },
        axisLabel: { color: p.muted },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Advancing',
        type: 'bar',
        stack: 'ad',
        data: barData(data.adv, partial, p.up),
        barMaxWidth: 18,
      },
      {
        name: 'Declining',
        type: 'bar',
        stack: 'ad',
        data: barData(data.dec, partial, p.down),
        barMaxWidth: 18,
      },
      {
        name: 'Spikes ≥ 2×',
        type: 'line',
        yAxisIndex: 1,
        showSymbol: false,
        data: data.spikes,
        lineStyle: { color: p.inc, width: 2 },
        itemStyle: { color: p.inc },
      },
    ],
  } as EChartsOption;
}

/** Histogram of delivery % in 5 pp bins, with the median marked. */
export function histogramOption(values: readonly number[], median: number | null, p: Palette): EChartsOption {
  const bins = histogram(values, 5, 100);
  const mIdx = median === null ? -1 : Math.min(bins.length - 1, Math.floor(median / 5));
  return {
    textStyle: { color: p.text },
    tooltip: { ...tooltipBase(p), trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 48, right: 12, top: 28, bottom: 40 },
    xAxis: {
      type: 'category',
      data: bins.map((b) => `${b.lo}–${b.hi}`),
      name: 'Delivery %',
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { color: p.muted },
      axisLabel: { color: p.muted, interval: 1 },
      axisLine: { lineStyle: { color: p.grid } },
    },
    yAxis: {
      type: 'value',
      name: 'Stocks',
      nameTextStyle: { color: p.muted, align: 'left' },
      ...axisStyle(p),
    },
    series: [
      {
        type: 'bar',
        data: bins.map((b) => b.count),
        itemStyle: { color: p.inc },
        markLine:
          mIdx >= 0
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: p.dec, type: 'dashed' },
                label: { color: p.text, formatter: `median ${fmtPct(median)}` },
                data: [{ xAxis: mIdx }],
              }
            : undefined,
      },
    ],
  };
}

/** Delivery % vs the day's price change, one dot per stock. */
export function retScatterOption(
  points: readonly { sym: string; x: number; y: number }[],
  p: Palette,
  mobile: boolean,
): EChartsOption {
  const rx = axisRange(points.map((d) => d.x));
  return {
    textStyle: { color: p.text },
    tooltip: {
      ...tooltipBase(p),
      trigger: 'item',
      formatter: (e: unknown) => {
        const d = (e as { data: { sym: string; real: [number, number] } }).data;
        return `<b>${d.sym}</b><br/>Change ${fmtPctChg(d.real[0], 2)}<br/>Delivery ${fmtPct(d.real[1])}<br/>Click to open`;
      },
    },
    grid: { left: mobile ? 44 : 52, right: 12, top: 12, bottom: 44 },
    xAxis: {
      type: 'value',
      min: rx[0],
      max: rx[1],
      name: 'Price change, %',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: p.muted },
      ...axisStyle(p),
      axisLabel: { color: p.muted, formatter: (v: number) => String(Math.round(v * 10) / 10) },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      name: 'Delivery %',
      nameTextStyle: { color: p.muted, align: 'left' },
      ...axisStyle(p),
    },
    series: [
      {
        type: 'scatter',
        symbolSize: 4,
        itemStyle: { color: p.inc, opacity: 0.45 },
        data: points.map((d) => ({ value: [pin(d.x, rx).value, d.y], sym: d.sym, real: [d.x, d.y] })),
      },
    ],
  };
}

/** Delivery value by sector (bars) and delivery % vs its 20-day average (dots, right axis). */
export function sectorBarsOption(
  rows: readonly { name: string; delivVal: number | null; diffPp: number | null }[],
  p: Palette,
  mobile: boolean,
): EChartsOption {
  const names = rows.map((r) => r.name);
  return {
    textStyle: { color: p.text },
    legend: { top: 0, textStyle: { color: p.muted }, itemHeight: 8 },
    tooltip: { ...tooltipBase(p), trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: mobile ? 130 : 190, right: 56, top: 32, bottom: 28 },
    yAxis: {
      type: 'category',
      data: names,
      inverse: true,
      axisLabel: { color: p.muted, width: mobile ? 120 : 180, overflow: 'truncate' },
      axisTick: { show: false },
    },
    xAxis: [
      {
        type: 'value',
        name: 'Delivery value, ₹ Cr',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: p.muted },
        ...axisStyle(p),
        axisLabel: { color: p.muted, formatter: (v: number) => fmtNum(v, 0) },
      },
      {
        type: 'value',
        name: 'vs 20D avg, pp',
        position: 'top',
        nameTextStyle: { color: p.muted },
        axisLine: { lineStyle: { color: p.grid } },
        axisLabel: { color: p.muted },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Delivery value',
        type: 'bar',
        data: rows.map((r) => r.delivVal),
        itemStyle: { color: p.inc },
        barMaxWidth: 14,
      },
      {
        name: 'Delivery % vs 20D avg (pp)',
        type: 'scatter',
        xAxisIndex: 1,
        data: rows.flatMap((r, i) => (r.diffPp === null ? [] : [[r.diffPp, i]])),
        symbolSize: 8,
        itemStyle: { color: p.dec },
      },
    ],
  };
}
