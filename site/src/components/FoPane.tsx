import { useMemo } from 'react';
import EChart from '../charts/EChart';
import type { Palette } from '../charts/theme';
import { fmtNum } from '../lib/format';
import {
  BUILDUP_LABEL,
  BUILDUP_MEANING,
  confluenceLabel,
  foHistory,
  latestLine,
  type FoHistoryRow,
} from '../lib/fo';
import type { SymbolFile, SymbolRow } from '../types/data';

/** Build-up shading colours: long = green, short = red, covering = amber, unwinding = slate (descriptive, not a verdict). */
const CODE_COLOR: Readonly<Record<string, string>> = {
  LB: '#0f9d58',
  SB: '#dc2626',
  SC: '#d9730d',
  LU: '#64748b',
};

/** Runs of the same build-up code, as [startDate, endDate, code] (for the shaded bands). */
export function buildupRuns(hist: readonly FoHistoryRow[]): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const h of hist) {
    if (!h.buildup) continue;
    const last = out[out.length - 1];
    if (last && last[2] === h.buildup && last[1] === prevDate(hist, h.date)) last[1] = h.date;
    else out.push([h.date, h.date, h.buildup]);
  }
  return out;
}

function prevDate(hist: readonly FoHistoryRow[], date: string): string | null {
  const i = hist.findIndex((h) => h.date === date);
  return i > 0 ? hist[i - 1]!.date : null;
}

/** The pane's chart: futures OI (shares, left axis) and the close (right axis), shaded by build-up run. */
export function foOption(
  hist: readonly FoHistoryRow[],
  closeByDate: ReadonlyMap<string, number | null>,
  p: Palette,
  mobile: boolean,
) {
  const dates = hist.map((h) => h.date);
  const runs = buildupRuns(hist);
  return {
    animation: false,
    grid: { left: mobile ? 48 : 64, right: mobile ? 48 : 64, top: 28, bottom: 40 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: p.muted }, data: ['Futures OI (shares)', 'Close (Rs)'] },
    xAxis: { type: 'category', data: dates, axisLabel: { color: p.muted, hideOverlap: true } },
    yAxis: [
      {
        type: 'value',
        name: 'OI (shares)',
        axisLabel: { color: p.muted, formatter: (v: number) => fmtNum(v, 0) },
        splitLine: { lineStyle: { color: p.grid } },
      },
      {
        type: 'value',
        name: 'Close',
        scale: true,
        axisLabel: { color: p.muted },
        splitLine: { show: false },
      },
    ],
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 4 }],
    series: [
      {
        name: 'Futures OI (shares)',
        type: 'line',
        data: hist.map((h) => h.futOi),
        symbol: 'none',
        lineStyle: { width: 2, color: p.line },
        itemStyle: { color: p.line },
        markArea: {
          silent: true,
          data: runs.map(([a, b, code]) => [
            {
              xAxis: a,
              name: BUILDUP_LABEL[code] ?? code,
              itemStyle: { color: CODE_COLOR[code], opacity: 0.12 },
            },
            { xAxis: b },
          ]),
        },
      },
      {
        name: 'Close (Rs)',
        type: 'line',
        yAxisIndex: 1,
        data: dates.map((d) => closeByDate.get(d) ?? null),
        symbol: 'none',
        lineStyle: { width: 1.5, color: p.line2 },
        itemStyle: { color: p.line2 },
        connectNulls: true,
      },
    ],
  };
}

export function FoSection({
  file,
  rows,
  pal,
  mobile,
}: {
  file: SymbolFile;
  rows: readonly SymbolRow[];
  pal: Palette;
  mobile: boolean;
}) {
  const hist = useMemo(() => foHistory(file.fo), [file.fo]);
  const closeByDate = useMemo(() => new Map(rows.map((r) => [r.date, r.close])), [rows]);
  const signalByDate = useMemo(() => new Map(rows.map((r) => [r.date, r.signal])), [rows]);
  const chart = useMemo(
    () => (hist.length ? foOption(hist, closeByDate, pal, mobile) : null),
    [hist, closeByDate, pal, mobile],
  );
  const last = hist[hist.length - 1];
  const badge = last ? confluenceLabel(signalByDate.get(last.date) ?? null, last.buildup) : null;

  return (
    <section aria-label="F&O positioning" className="card min-w-0 p-3" data-testid="fo-pane">
      <h2 className="text-sm font-semibold">F&O positioning (stock futures)</h2>
      {hist.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Not an F&O stock: no stock futures in the NSE F&O bhavcopy, so there is no open-interest history.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm" data-testid="fo-latest">
            {last ? `${last.date}: ${latestLine(last)}` : ''}
            {last?.pcr !== null && last?.pcr !== undefined ? `; put-call ratio ${fmtNum(last.pcr, 2)}` : ''}
          </p>
          {badge && (
            <p className="mt-1">
              <span className="chip" data-testid="fo-confluence">
                {badge}
              </span>
            </p>
          )}
          {chart ? (
            <EChart
              option={chart}
              height={mobile ? 300 : 340}
              ariaLabel="Futures open interest with the close, shaded by build-up"
            />
          ) : null}
          <ul className="mt-2 grid gap-0.5 text-xs text-slate-600 dark:text-slate-300">
            {(['LB', 'SB', 'SC', 'LU'] as const).map((c) => (
              <li key={c}>
                <span className="font-semibold">{BUILDUP_LABEL[c]}</span>: {BUILDUP_MEANING[c]}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            Open interest is in shares, summed over all stock-futures expiries. Build-up describes price and
            open interest on the day; it is not a prediction. Build-up days are shaded in the chart. Put-call
            ratio: put open interest over call open interest, all stock-option expiries.
          </p>
        </>
      )}
    </section>
  );
}
