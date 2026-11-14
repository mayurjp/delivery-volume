import { fmtDate, fmtInt, fmtNum, fmtPct, fmtPctChg, fmtPrice, fmtQty, fmtRatio } from '../lib/format';
import { rollingBand } from '../lib/metrics';
import type { CorpAction, Market, SymbolRow } from '../types/data';
import type { EChartsOption } from './echarts';
import type { Palette } from './theme';

const nn = (v: number | null | undefined): number | '-' => (v === null || v === undefined ? '-' : v);

function mean20(values: readonly (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  const buf: number[] = [];
  for (const v of values) {
    out.push(buf.length >= 10 ? buf.reduce((s, x) => s + x, 0) / buf.length : null);
    if (v !== null) {
      buf.push(v);
      if (buf.length > 20) buf.shift();
    }
  }
  return out;
}

/** Index of the first date >= `iso` (ISO strings compare correctly as text), or -1. */
export function firstOnOrAfter(dates: readonly string[], iso: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! < iso) lo = mid + 1;
    else hi = mid;
  }
  return lo < dates.length ? lo : -1;
}

/** Index of the last date <= `iso`, or -1. */
export function lastOnOrBefore(dates: readonly string[], iso: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! <= iso) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Main stock chart: candles, delivered vs non-delivered volume, delivery % with a +-1 sigma band. One zoom. */
export function stockChartOption(
  rows: readonly SymbolRow[],
  corp: readonly CorpAction[],
  p: Palette,
  mobile: boolean,
  highlight?: { a: string; b: string },
): EChartsOption {
  const dates = rows.map((r) => r.date);
  const delivered = rows.map((r) => r.delivQty);
  const nonDelivered = rows.map((r) => (r.vol !== null && r.delivQty !== null ? r.vol - r.delivQty : null));
  const dp = rows.map((r) => r.delivPct);
  const band = rollingBand(dp, 60, 30);
  const lower = band.mean.map((m, i) =>
    m === null || band.std[i] === null ? null : m - (band.std[i] as number),
  );
  const spread = band.mean.map((m, i) =>
    m === null || band.std[i] === null ? null : 2 * (band.std[i] as number),
  );
  let start = Math.max(0, 100 - (126 / Math.max(rows.length, 1)) * 100);
  let end = 100;
  // a custom range: shade it and zoom to it with some room on both sides
  const hi = highlight
    ? { a: firstOnOrAfter(dates, highlight.a), b: lastOnOrBefore(dates, highlight.b) }
    : null;
  if (hi && hi.a >= 0 && hi.b >= hi.a) {
    const pad = Math.max(10, Math.round((hi.b - hi.a) / 2));
    const n = Math.max(rows.length, 1);
    start = (Math.max(0, hi.a - pad) / n) * 100;
    end = ((Math.min(rows.length - 1, hi.b + pad) + 1) / n) * 100;
  }

  const markLines = corp
    .map((c) => ({ c, i: firstOnOrAfter(dates, c.exDate) }))
    .filter((x) => x.i >= 0 && dates[x.i]! >= (dates[0] ?? ''))
    .map((x) => ({
      xAxis: dates[x.i]!,
      label: { formatter: x.c.kind.slice(0, 3), color: p.muted, fontSize: 10 },
      lineStyle: { color: p.muted, type: 'dashed' as const, width: 1 },
    }));

  const axisBase = {
    axisLine: { lineStyle: { color: p.grid } },
    axisLabel: { color: p.muted },
    splitLine: { lineStyle: { color: p.grid } },
  };
  const xAxis = (gi: number, show: boolean) => ({
    type: 'category' as const,
    gridIndex: gi,
    data: dates,
    boundaryGap: true,
    axisLabel: { show, color: p.muted, formatter: (v: string) => fmtDate(v).slice(0, -5) },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: p.grid } },
    axisPointer: { show: true, label: { show: gi === 2 } },
  });
  const yName = (name: string) => ({
    name,
    nameTextStyle: { color: p.muted, align: 'left' as const },
    nameGap: 6,
  });

  return {
    textStyle: { color: p.text },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      triggerOn: 'mousemove|click',
      axisPointer: { type: 'cross' },
      confine: true,
      backgroundColor: p.bg,
      borderColor: p.grid,
      textStyle: { color: p.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const i = arr[0]?.dataIndex ?? 0;
        const r = rows[i];
        if (!r) return '';
        const prev = i > 0 ? rows[i - 1] : undefined;
        const ret = prev?.close && r.close ? (r.close / prev.close - 1) * 100 : null;
        return [
          `<b>${fmtDate(r.date)}</b>`,
          `Close ${fmtPrice(r.close)} (${fmtPctChg(ret, 2)})`,
          `O ${fmtPrice(r.open)}  H ${fmtPrice(r.high)}  L ${fmtPrice(r.low)}`,
          `Volume ${fmtQty(r.vol)}, delivered ${fmtQty(r.delivQty)}`,
          `Delivery ${fmtPct(r.delivPct)} (20-day avg ${fmtPct(r.delivPctAvg20)})`,
          `Delivery value ${fmtNum(r.delivValCr)} Cr, spike ${fmtRatio(r.spike)}`,
        ].join('<br/>');
      },
    },
    grid: [
      { left: 52, right: 12, top: 18, height: '40%' },
      { left: 52, right: 12, top: '52%', height: '17%' },
      { left: 52, right: 12, top: '74%', height: '14%' },
    ],
    xAxis: [xAxis(0, false), xAxis(1, false), xAxis(2, true)],
    yAxis: [
      {
        gridIndex: 0,
        scale: true,
        ...axisBase,
        ...yName('₹'),
        axisLabel: { color: p.muted, formatter: (v: number) => fmtInt(v) },
      },
      {
        gridIndex: 1,
        ...axisBase,
        ...yName('Shares'),
        splitNumber: 2,
        axisLabel: { color: p.muted, formatter: (v: number) => fmtQty(v) },
      },
      {
        gridIndex: 2,
        scale: true,
        ...axisBase,
        ...yName('Delivery %'),
        splitNumber: 2,
        axisLabel: { color: p.muted, formatter: (v: number) => `${v}%` },
      },
    ],
    dataZoom: [
      mobile
        ? {
            type: 'slider',
            xAxisIndex: [0, 1, 2],
            start,
            end,
            height: 18,
            bottom: 4,
            borderColor: p.grid,
          }
        : {
            type: 'inside',
            xAxisIndex: [0, 1, 2],
            start,
            end,
            zoomOnMouseWheel: 'ctrl',
            moveOnMouseMove: true,
          },
    ],
    series: [
      {
        name: 'Price',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: rows.map((r) => [nn(r.open), nn(r.close), nn(r.low), nn(r.high)]),
        itemStyle: { color: p.up, color0: p.down, borderColor: p.up, borderColor0: p.down },
        markLine: markLines.length ? { symbol: 'none', silent: true, data: markLines } : undefined,
        markArea:
          hi && hi.a >= 0 && hi.b >= hi.a
            ? {
                silent: true,
                itemStyle: { color: p.band },
                data: [[{ xAxis: dates[hi.a]! }, { xAxis: dates[hi.b]! }]],
              }
            : undefined,
      },
      {
        name: 'Delivered',
        type: 'bar',
        stack: 'vol',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: delivered,
        itemStyle: { color: p.delivered },
      },
      {
        name: 'Not delivered',
        type: 'bar',
        stack: 'vol',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: nonDelivered,
        itemStyle: { color: p.nonDelivered },
      },
      {
        name: 'Delivered qty, 20-day avg',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        showSymbol: false,
        data: mean20(delivered),
        lineStyle: { color: p.dec, width: 1.5 },
        itemStyle: { color: p.dec },
      },
      {
        name: 'band-base',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        stack: 'band',
        showSymbol: false,
        data: lower,
        lineStyle: { opacity: 0 },
        silent: true,
      },
      {
        name: '±1σ (60-day)',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        stack: 'band',
        showSymbol: false,
        data: spread,
        lineStyle: { opacity: 0 },
        areaStyle: { color: p.band },
        silent: true,
      },
      {
        name: 'Delivery %',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        showSymbol: false,
        data: dp,
        lineStyle: { color: p.inc, width: 1.5 },
        itemStyle: { color: p.inc },
      },
      {
        name: '20-day avg',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        showSymbol: false,
        data: rows.map((r) => r.delivPctAvg20),
        lineStyle: { color: p.muted, width: 1, type: 'dashed' },
        itemStyle: { color: p.muted },
      },
    ],
  };
}

/** Calendar heat map of delivery % over the stored history. */
export function calendarOption(rows: readonly SymbolRow[], p: Palette): EChartsOption {
  const data = rows.filter((r) => r.delivPct !== null).map((r) => [r.date, r.delivPct]);
  const vals = data.map((d) => d[1] as number).sort((a, b) => a - b);
  const lo = vals.length ? Math.floor(vals[Math.floor(vals.length * 0.02)]!) : 0;
  const hi = vals.length ? Math.ceil(vals[Math.floor(vals.length * 0.98)]!) : 100;
  const first = rows[0]?.date ?? '';
  const last = rows[rows.length - 1]?.date ?? '';
  return {
    textStyle: { color: p.text },
    tooltip: {
      confine: true,
      triggerOn: 'mousemove|click',
      backgroundColor: p.bg,
      borderColor: p.grid,
      textStyle: { color: p.text, fontSize: 12 },
      formatter: (x: unknown) => {
        const v = (x as { value: [string, number] }).value;
        return `${fmtDate(v[0])}<br/>Delivery ${fmtPct(v[1])}`;
      },
    },
    visualMap: {
      min: lo,
      max: Math.max(hi, lo + 1),
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 140,
      text: ['High', 'Low'],
      textStyle: { color: p.muted },
      formatter: (v: number) => `${Math.round(v)}%`,
      inRange: { color: p.seq },
    },
    calendar: {
      top: 28,
      left: 34,
      right: 10,
      cellSize: [14, 14],
      range: [first, last],
      itemStyle: { color: 'transparent', borderWidth: 2, borderColor: p.bg },
      splitLine: { show: false },
      yearLabel: { show: false },
      dayLabel: { color: p.muted, firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] },
      monthLabel: { color: p.muted },
    },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data }],
  };
}

/** Market delivery % (left axis) with the Nifty 50 close (right axis) over the last `n` days. */
export function marketOption(m: Market, p: Palette, n = 60): EChartsOption {
  const g = m.groups['ALL'];
  const start = Math.max(0, m.dates.length - n);
  const dates = m.dates.slice(start);
  const pct = (g?.delivPctW ?? []).slice(start);
  const nifty = (m.indexClose['Nifty 50'] ?? []).slice(start);
  const axis = {
    axisLine: { lineStyle: { color: p.grid } },
    axisLabel: { color: p.muted },
    splitLine: { lineStyle: { color: p.grid } },
  };
  return {
    textStyle: { color: p.text },
    legend: { top: 0, type: 'scroll', textStyle: { color: p.muted }, itemHeight: 8 },
    tooltip: {
      trigger: 'axis',
      triggerOn: 'mousemove|click',
      confine: true,
      backgroundColor: p.bg,
      borderColor: p.grid,
      textStyle: { color: p.text, fontSize: 12 },
    },
    grid: { left: 44, right: 52, top: 62, bottom: 24 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: p.muted, formatter: (v: string) => fmtDate(v).slice(0, -5) },
      axisLine: { lineStyle: { color: p.grid } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        scale: true,
        name: 'Delivery %',
        nameTextStyle: { color: p.muted, align: 'left' },
        ...axis,
        axisLabel: { color: p.muted, formatter: (v: number) => `${v}%` },
      },
      {
        type: 'value',
        scale: true,
        name: 'Nifty 50',
        nameTextStyle: { color: p.muted, align: 'right' },
        position: 'right',
        ...axis,
        splitLine: { show: false },
        axisLabel: { color: p.muted, formatter: (v: number) => fmtInt(v) },
      },
    ],
    series: [
      {
        name: 'Market delivery % (value-weighted)',
        type: 'line',
        showSymbol: false,
        data: pct,
        lineStyle: { color: p.inc, width: 2 },
        itemStyle: { color: p.inc },
      },
      {
        name: 'Nifty 50 close',
        type: 'line',
        yAxisIndex: 1,
        showSymbol: false,
        data: nifty,
        lineStyle: { color: p.muted, width: 1.5 },
        itemStyle: { color: p.muted },
      },
    ],
  };
}
