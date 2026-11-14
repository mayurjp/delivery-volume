import type { BarSpec, PeriodRow, PeriodsConfig } from '../lib/aggregate';
import { partialText } from '../lib/aggregate';
import {
  fmtDate,
  fmtInt,
  fmtNum,
  fmtPct,
  fmtPctChg,
  fmtPp,
  fmtPrice,
  fmtQty,
  fmtRatio,
  MONTH_NAMES,
} from '../lib/format';
import { periodLabel } from '../lib/timeframe';
import type { EChartsOption } from './echarts';
import type { Palette } from './theme';

/** Stock-page charts for weekly, monthly, quarterly and N-day bars (08 sections 5 and 5A). */

const nn = (v: number | null | undefined): number | '-' => (v === null || v === undefined ? '-' : v);

/** Delivery balance is capped at this value in the bar pane so one near-empty down side does not flatten the axis. */
export const BALANCE_CAP = 10;

export const isNBars = (tf: BarSpec): tf is { kind: 'n'; n: number } => typeof tf === 'object';

/** Short axis label of a bar: "13 Nov" (weekly, N-day), "Nov 26" (monthly), "Q4 26" (quarterly). */
export function axisLabel(tf: BarSpec, r: Pick<PeriodRow, 'key' | 'end'>): string {
  if (isNBars(tf) || tf === 'w') return fmtDate(r.end).slice(0, -5);
  if (tf === 'm') return `${MONTH_NAMES[Number(r.key.slice(5, 7)) - 1] ?? ''} ${r.key.slice(2, 4)}`;
  return `${r.key.slice(5)} ${r.key.slice(2, 4)}`;
}

/** Full label of a bar: "w/e 13 Nov 2026", "Nov 2026", "Q4 2026", "3 Nov 2026 to 13 Nov 2026". */
export function periodTitle(tf: BarSpec, r: Pick<PeriodRow, 'key' | 'start' | 'end'>): string {
  if (isNBars(tf)) return `${fmtDate(r.start)} to ${fmtDate(r.end)}`;
  return periodLabel(tf, r);
}

/** Wording of the baseline ("10-week average", "prior 10 bars"). */
export function baselineLabel(tf: BarSpec, cfg: PeriodsConfig): string {
  if (isNBars(tf)) return `prior ${cfg.periods.w.base}-bar average`;
  const n = cfg.periods[tf].base;
  return `${n}-${tf === 'w' ? 'week' : tf === 'm' ? 'month' : 'quarter'} average`;
}

export interface PeriodSeries {
  keys: string[];
  axisLabels: string[];
  titles: string[];
  /** ECharts candle order: open, close, low, high. */
  candles: (number | '-')[][];
  delivered: (number | null)[];
  nonDelivered: (number | null)[];
  delivPct: (number | null)[];
  base: (number | null)[];
  spike: (number | null)[];
  /** Delivery balance, capped at BALANCE_CAP. */
  balance: (number | null)[];
  partial: boolean[];
  adjusted: boolean[];
}

/** The mapping from PeriodRow[] to chart series. */
export function periodSeries(rows: readonly PeriodRow[], tf: BarSpec): PeriodSeries {
  return {
    keys: rows.map((r) => r.key),
    axisLabels: rows.map((r) => axisLabel(tf, r)),
    titles: rows.map((r) => periodTitle(tf, r)),
    candles: rows.map((r) => [nn(r.open), nn(r.close), nn(r.low), nn(r.high)]),
    delivered: rows.map((r) => r.delivQty),
    nonDelivered: rows.map((r) => (r.vol !== null && r.delivQty !== null ? r.vol - r.delivQty : null)),
    delivPct: rows.map((r) => r.delivPct),
    base: rows.map((r) => r.delivPctAvgN),
    spike: rows.map((r) => r.spike),
    balance: rows.map((r) => (r.delivBalance === null ? null : Math.min(r.delivBalance, BALANCE_CAP))),
    partial: rows.map((r) => r.partial),
    adjusted: rows.map((r) => r.adjusted === 1),
  };
}

/** Bars shown by default: 1 year of weeks, everything for months and quarters, about 1 year of trading days for N-day bars. */
export function defaultBars(tf: BarSpec): number {
  if (isNBars(tf)) return Math.max(12, Math.ceil(252 / tf.n));
  return tf === 'w' ? 52 : Number.POSITIVE_INFINITY;
}

/** dataZoom window in percent for `nBars` bars. */
export function defaultZoom(tf: BarSpec, nBars: number): { start: number; end: number } {
  const show = defaultBars(tf);
  if (nBars <= 0 || nBars <= show) return { start: 0, end: 100 };
  return { start: (1 - show / nBars) * 100, end: 100 };
}

/** Bars whose period had a split or bonus: a warning marker sits on their high. */
export function splitMarkers(rows: readonly PeriodRow[]): { key: string; y: number }[] {
  return rows.flatMap((r) => (r.adjusted === 1 ? [{ key: r.key, y: r.high ?? r.close ?? 0 }] : []));
}

/** Lines of the bar tooltip (04 section 7 formats). */
export function periodTooltipLines(r: PeriodRow, tf: BarSpec, cfg: PeriodsConfig): string[] {
  const title = periodTitle(tf, r);
  const part = partialText(r);
  const base = baselineLabel(tf, cfg);
  const lines = [
    `<b>${title}</b>${part ? ` (${part})` : ''}`,
    `Close ${fmtPrice(r.close)} (${fmtPctChg(r.ret, 2)})`,
    `O ${fmtPrice(r.open)}  H ${fmtPrice(r.high)}  L ${fmtPrice(r.low)}`,
    `Volume ${fmtQty(r.vol)}, delivered ${fmtQty(r.delivQty)}`,
    `Delivery ${fmtPct(r.delivPct)} (${base} ${fmtPct(r.delivPctAvgN)}, ${fmtPp(r.delivPctDiff)})`,
    `Delivery value ${fmtNum(r.delivValCr)} Cr, spike ${fmtRatio(r.spike)}`,
    `Delivery balance ${fmtRatio(r.delivBalance)} (delivery value on up days / down days)`,
  ];
  if (r.adjusted === 1) lines.push('⚠ Prices are split-adjusted in this period; quantities are plain sums');
  return lines;
}

interface ChartOpts {
  mobile: boolean;
  cfg: PeriodsConfig;
  /** Overrides the default zoom (for example a single bar). */
  zoom?: { start: number; end: number };
}

/** Candles, delivered / not delivered quantity, delivery % with its baseline, and spike with delivery balance (bars). */
export function periodChartOption(
  rows: readonly PeriodRow[],
  tf: BarSpec,
  p: Palette,
  o: ChartOpts,
): EChartsOption {
  const s = periodSeries(rows, tf);
  const byKey = new Map(s.keys.map((k, i) => [k, s.axisLabels[i]!]));
  const zoom = o.zoom ?? defaultZoom(tf, rows.length);
  const dim = (i: number) => (s.partial[i] ? { opacity: 0.45 } : {});
  const markers = splitMarkers(rows);
  const axisBase = {
    axisLine: { lineStyle: { color: p.grid } },
    axisLabel: { color: p.muted },
    splitLine: { lineStyle: { color: p.grid } },
  };
  const xAxis = (gi: number, show: boolean) => ({
    type: 'category' as const,
    gridIndex: gi,
    data: s.keys,
    boundaryGap: true,
    axisLabel: {
      show,
      color: p.muted,
      hideOverlap: true,
      formatter: (v: string) => byKey.get(v) ?? v,
    },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: p.grid } },
    axisPointer: {
      show: true,
      label: {
        show: gi === 3,
        formatter: (x: { value: unknown }) => byKey.get(String(x.value)) ?? String(x.value),
      },
    },
  });
  const yName = (name: string) => ({
    name,
    nameTextStyle: { color: p.muted, align: 'left' as const },
    nameGap: 6,
  });
  const axes = [0, 1, 2, 3];
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
        const i = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
        const r = rows[i];
        return r ? periodTooltipLines(r, tf, o.cfg).join('<br/>') : '';
      },
    },
    grid: [
      { left: 52, right: 12, top: 18, height: '33%' },
      { left: 52, right: 12, top: '49%', height: '12%' },
      { left: 52, right: 12, top: '66%', height: '11%' },
      { left: 52, right: 12, top: '82%', height: '9%' },
    ],
    xAxis: [xAxis(0, false), xAxis(1, false), xAxis(2, false), xAxis(3, true)],
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
      {
        gridIndex: 3,
        min: 0,
        ...axisBase,
        ...yName('Ratio (×)'),
        splitNumber: 2,
        axisLabel: { color: p.muted, formatter: (v: number) => `${v}×` },
      },
    ],
    dataZoom: [
      o.mobile
        ? {
            type: 'slider',
            xAxisIndex: axes,
            start: zoom.start,
            end: zoom.end,
            height: 18,
            bottom: 4,
            borderColor: p.grid,
          }
        : {
            type: 'inside',
            xAxisIndex: axes,
            start: zoom.start,
            end: zoom.end,
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
        data: s.candles.map((c, i) => ({ value: c, itemStyle: dim(i) })),
        itemStyle: { color: p.up, color0: p.down, borderColor: p.up, borderColor0: p.down },
        markPoint: markers.length
          ? {
              symbol: 'triangle',
              symbolSize: 11,
              silent: true,
              itemStyle: { color: '#d97706' },
              label: { show: false },
              data: markers.map((m) => ({ name: 'Split-adjusted', coord: [m.key, m.y] })),
            }
          : undefined,
      },
      {
        name: 'Delivered',
        type: 'bar',
        stack: 'vol',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: s.delivered.map((v, i) => ({ value: v, itemStyle: { color: p.delivered, ...dim(i) } })),
      },
      {
        name: 'Not delivered',
        type: 'bar',
        stack: 'vol',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: s.nonDelivered.map((v, i) => ({ value: v, itemStyle: { color: p.nonDelivered, ...dim(i) } })),
      },
      {
        name: 'Delivery %',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        showSymbol: rows.length < 3,
        data: s.delivPct,
        lineStyle: { color: p.inc, width: 1.5 },
        itemStyle: { color: p.inc },
      },
      {
        name: `Delivery %, ${baselineLabel(tf, o.cfg)}`,
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        showSymbol: false,
        data: s.base,
        lineStyle: { color: p.muted, width: 1, type: 'dashed' },
        itemStyle: { color: p.muted },
      },
      {
        name: 'Spike (delivery value vs baseline)',
        type: 'bar',
        xAxisIndex: 3,
        yAxisIndex: 3,
        data: s.spike.map((v, i) => ({ value: v, itemStyle: { color: p.inc, ...dim(i) } })),
        markLine: {
          symbol: 'none',
          silent: true,
          data: [{ yAxis: 1 }],
          lineStyle: { color: p.muted, type: 'dashed' },
          label: { show: false },
        },
      },
      {
        name: 'Delivery balance (up-day / down-day delivery value)',
        type: 'bar',
        xAxisIndex: 3,
        yAxisIndex: 3,
        data: s.balance.map((v, i) => ({ value: v, itemStyle: { color: p.line2, ...dim(i) } })),
      },
    ],
  };
}

/** The bar spec of the Stock page's timeframe: weeks, months, quarters, N-day bars. Null for d and the custom range. */
export function barSpecOf(s: { tf: string; n: number }): BarSpec | null {
  if (s.tf === 'w' || s.tf === 'm' || s.tf === 'q') return s.tf;
  if (s.tf === 'c') return { kind: 'n', n: s.n };
  return null;
}

/** The bar holding `date`; the last bar ending before it when the date falls in a gap; the newest bar when the date is before all. */
export function barHolding(rows: readonly PeriodRow[], date: string | null): PeriodRow | null {
  if (rows.length === 0) return null;
  if (!date) return rows[rows.length - 1]!;
  let found: PeriodRow | null = null;
  for (const r of rows) {
    if (r.start <= date && date <= r.end) return r;
    if (r.end < date) found = r;
  }
  return found ?? rows[rows.length - 1]!;
}
