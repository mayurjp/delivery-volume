import { useMemo, useState } from 'react';
import EChart from '../charts/EChart';
import { runsChartOption } from '../charts/runs';
import type { Palette } from '../charts/theme';
import { footprintIndicators, footprintSeries } from '../lib/footprints';
import { DASH, fmtDate, fmtInt, fmtPctChg, fmtRatio } from '../lib/format';
import { useRunFootprints } from '../lib/hooks';
import {
  NO_RUNS_TEXT,
  NOT_ENOUGH_RUNS_TEXT,
  RUN_CSV_HEADERS,
  SHORT_HISTORY_TEXT,
  bigPlayerLines,
  fmtCrSigned,
  fmtFeature,
  fmtPpSigned,
  footprintCardLines,
  parseRuns,
  parseSummary,
  patternEnough,
  runCsvRows,
  runsState,
  type RunRec,
  type SummaryRow,
  type WindowId,
} from '../lib/runs';
import { exportCsv } from '../lib/csv';
import type { SymbolFile, SymbolRow } from '../types/data';
import { CsvButton, Empty, Skeleton, Tip } from './ui';

interface Props {
  sym: string;
  bucket: string | null;
  file: SymbolFile;
  rows: SymbolRow[];
  pal: Palette;
  mobile: boolean;
  dark: boolean;
}

const WINDOW_NAME: Record<WindowId, string> = {
  pre: 'Pre (20 days before the start)',
  early: 'Early (first 5 days of the run)',
  full: 'Full run (start to end)',
  post: 'Post (20 days after the end)',
};
const SHOWN_WINDOWS: WindowId[] = ['pre', 'early', 'full'];

export const RUNS_CAVEAT =
  'NSE does not publish who took delivery of a stock on a given day. These are footprints: delivery value vs normal, delivery on up days vs down days, trade size, named deals and holdings. Historical and descriptive. Evidence, not advice.';

function PatternCard({ title, row, dir }: { title: string; row: SummaryRow | null; dir: 'UP' | 'DOWN' }) {
  const enough = patternEnough(row);
  return (
    <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-800/60">
      <div className="text-xs font-semibold">
        {title}{' '}
        <span className="font-normal text-slate-600 dark:text-slate-400">({row?.runs ?? 0} runs)</span>
      </div>
      {enough && row ? (
        <dl className="num mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-slate-600 dark:text-slate-400">Delivery value vs normal, pre</dt>
          <dd className="text-right">{fmtRatio(row.preDelivValRatio, 2)}</dd>
          <dt className="text-slate-600 dark:text-slate-400">Delivery % change, pre</dt>
          <dd className="text-right">{fmtPpSigned(row.preDelivPctChgPp)}</dd>
          <dt className="text-slate-600 dark:text-slate-400">Delivery balance, pre</dt>
          <dd className="text-right">{fmtRatio(row.preDelivBalance, 2)}</dd>
          <dt className="text-slate-600 dark:text-slate-400">Trade size vs normal, pre</dt>
          <dd className="text-right">{fmtRatio(row.preTradeSizeRatio, 2)}</dd>
          <dt className="text-slate-600 dark:text-slate-400">Price change, pre</dt>
          <dd className="text-right">{fmtPctChg(row.prePriceChgPct, 1)}</dd>
        </dl>
      ) : (
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          {NOT_ENOUGH_RUNS_TEXT} ({row?.runs ?? 0} {dir === 'UP' ? 'up' : 'down'} runs; at least 3 are
          needed).
        </p>
      )}
    </div>
  );
}

function FootprintCard({
  run,
  index,
  summary,
  medians,
  bucket,
}: {
  run: RunRec;
  index: number;
  summary: ReturnType<typeof parseSummary>;
  medians: ReturnType<typeof useRunFootprints>['data'];
  bucket: string | null;
}) {
  const big = bigPlayerLines(run);
  return (
    <section aria-label="Footprint card" data-testid="footprint-card" className="card min-w-0 space-y-3 p-3">
      <h3 className="text-sm font-semibold">
        Footprint card: {run.dir === 'UP' ? 'up' : 'down'} run {fmtDate(run.start)} to {fmtDate(run.end)} (
        {fmtPctChg(run.movePct, 1)} over {run.days} days)
      </h3>
      {SHOWN_WINDOWS.map((w) => (
        <div key={w}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            {WINDOW_NAME[w]}
          </h4>
          <div className="overflow-x-auto" tabIndex={0}>
            <table className="num w-full min-w-[460px] text-xs" data-window={w} data-run={index}>
              <thead className="text-slate-600 dark:text-slate-400">
                <tr className="text-right">
                  <th className="py-1 text-left font-medium">Feature</th>
                  <th className="font-medium">This run</th>
                  <th className="font-medium" title="Stored for the pre window only">
                    Stock&rsquo;s ordinary days
                  </th>
                  <th className="font-medium">Market median ({run.dir === 'UP' ? 'up' : 'down'} runs)</th>
                </tr>
              </thead>
              <tbody>
                {footprintCardLines(run, w, summary, medians, bucket).map((l) => (
                  <tr key={l.feature} className="border-t border-slate-100 text-right dark:border-slate-800">
                    <td className="py-1 text-left">{l.label}</td>
                    <td data-field={`${w}.${l.feature}`}>{fmtFeature(l.feature, l.run)}</td>
                    <td>{fmtFeature(l.feature, l.ordinary)}</td>
                    <td>{fmtFeature(l.feature, l.market)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Named deals, Rs Cr (FII / DII / Other)
          </h4>
          <dl className="num grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-slate-600 dark:text-slate-400">Pre window</dt>
            <dd data-field="deals.pre">
              {fmtCrSigned(big.deals.pre.FII)} / {fmtCrSigned(big.deals.pre.DII)} /{' '}
              {fmtCrSigned(big.deals.pre.Other)}
            </dd>
            <dt className="text-slate-600 dark:text-slate-400">Full run</dt>
            <dd data-field="deals.full">
              {fmtCrSigned(big.deals.full.FII)} / {fmtCrSigned(big.deals.full.DII)} /{' '}
              {fmtCrSigned(big.deals.full.Other)}
            </dd>
          </dl>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Deal history starts 2025-11-03; a dash means the window is not covered.
          </p>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Holdings and futures
          </h4>
          <dl className="num grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
            {big.holdings.map((h) => (
              <div key={h.label} className="contents">
                <dt className="text-slate-600 dark:text-slate-400">{h.label}</dt>
                <dd>{fmtPpSigned(h.value)}</dd>
              </div>
            ))}
            {big.fo.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-slate-600 dark:text-slate-400">{f.label}</dt>
                <dd>
                  {f.value === null
                    ? DASH
                    : f.label.includes('days')
                      ? fmtInt(f.value)
                      : fmtPctChg(f.value, 1)}
                </dd>
              </div>
            ))}
            <div className="contents">
              <dt className="text-slate-600 dark:text-slate-400">Results dates in the run</dt>
              <dd>{big.results === null ? DASH : fmtInt(big.results)}</dd>
            </div>
          </dl>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Holdings change is over the last two quarters; F&amp;O fields apply to F&amp;O stocks only.
          </p>
        </div>
      </div>
    </section>
  );
}

export default function RunsTab({ sym, bucket, file, rows, pal, mobile, dark }: Props) {
  const runs = useMemo(() => parseRuns(file.runs), [file.runs]);
  const summary = useMemo(() => parseSummary(file.runSummary), [file.runSummary]);
  const medians = useRunFootprints();
  const [selected, setSelected] = useState<number | null>(null);
  const foot = useMemo(() => footprintSeries(rows), [rows]);
  const latest = useMemo(() => footprintIndicators(rows), [rows]);
  const state = runsState(runs.length, rows.length);
  const chart = useMemo(
    () =>
      state === 'ok'
        ? runsChartOption(
            {
              rows,
              runs,
              selected,
              deals: file.deals,
              resultsDates: file.resultsDates ?? [],
              corp: file.corpActions,
              foot,
            },
            pal,
            mobile,
            dark,
          )
        : null,
    [state, rows, runs, selected, file.deals, file.resultsDates, file.corpActions, foot, pal, mobile, dark],
  );

  if (state === 'short') {
    return (
      <section aria-label="Runs" className="card p-3">
        <Empty>{SHORT_HISTORY_TEXT}</Empty>
      </section>
    );
  }
  if (state === 'none') {
    return (
      <section aria-label="Runs" className="card p-3">
        <Empty>{NO_RUNS_TEXT}</Empty>
      </section>
    );
  }

  const order = runs.map((_, i) => i).reverse();
  const sel = selected !== null ? (runs[selected] ?? null) : null;

  return (
    <div className="space-y-3">
      <section aria-label="Runs chart" className="card min-w-0 p-3">
        <h2 className="mb-1 flex flex-wrap items-center gap-1 text-sm font-semibold">
          Price with runs shaded
          <Tip label={<span className="chip">?</span>}>
            Runs are moves of 20% or more over at least 5 trading days, found on the back-adjusted close
            (never shown as the price). Teal shading is an UP run, orange a DOWN run. Markers: triangles are
            named deals, solid lines results dates, dashed lines corporate-action ex-dates, dotted lines
            quarter ends.
          </Tip>
        </h2>
        {chart ? (
          <EChart
            option={chart}
            height={mobile ? 460 : 520}
            ariaLabel={`${sym} price with runs shaded and the footprint pane`}
          />
        ) : (
          <Skeleton height={mobile ? 460 : 520} />
        )}
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Bottom pane: delivery balance over 60 days (blue; above 1 means more delivery value on up days) and
          delivery value over 20 days vs the prior 60 (orange; 1 is normal). Latest: balance{' '}
          <span className="num">{fmtRatio(latest.delivBal60, 2)}</span>, value{' '}
          <span className="num">{fmtRatio(latest.delivValRatio60, 2)}</span>. Shaded window of the selected
          run: pre grey, early violet, full run amber. Drag the slider or Ctrl + scroll to zoom.
        </p>
      </section>

      <section aria-label="Runs table" className="card min-w-0 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Runs ({runs.length}), newest first</h2>
          <CsvButton
            disabled={runs.length === 0}
            onClick={() =>
              exportCsv(
                `stock-${sym}-runs`,
                runs[runs.length - 1]?.end ?? 'none',
                RUN_CSV_HEADERS,
                runCsvRows(runs),
              )
            }
          />
        </div>
        <div className="max-h-[420px] overflow-auto" tabIndex={0}>
          <table className="num w-full min-w-[720px] text-xs" data-testid="runs-table">
            <thead className="sticky top-0 bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-400">
              <tr className="text-right">
                <th className="py-1 text-left font-medium">Direction</th>
                <th className="text-left font-medium">Start</th>
                <th className="text-left font-medium">End</th>
                <th className="font-medium">Move</th>
                <th className="font-medium">Days</th>
                <th className="font-medium" title="Pre window delivery value vs normal">
                  Pre deliv. value
                </th>
                <th className="font-medium" title="Pre window delivery % change, pp">
                  Pre deliv. %
                </th>
                <th className="font-medium" title="Pre window delivery balance (up vs down days)">
                  Pre balance
                </th>
                <th className="font-medium" title="Pre window trade size vs normal">
                  Pre trade size
                </th>
                <th className="font-medium">Results</th>
              </tr>
            </thead>
            <tbody>
              {order.map((i) => {
                const r = runs[i]!;
                const on = selected === i;
                return (
                  <tr
                    key={i}
                    data-testid="run-row"
                    aria-selected={on}
                    className={`border-t border-slate-100 text-right dark:border-slate-800 ${on ? 'bg-blue-50 dark:bg-blue-950/40' : ''}`}
                  >
                    <td className="py-1 text-left">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelected(on ? null : i)}
                        className="rounded px-1 text-left underline-offset-2 hover:underline"
                      >
                        {r.dir === 'UP' ? (
                          <span className="text-teal-700 dark:text-teal-300">UP</span>
                        ) : (
                          <span className="text-orange-700 dark:text-orange-300">DOWN</span>
                        )}
                      </button>
                    </td>
                    <td className="text-left">{fmtDate(r.start)}</td>
                    <td className="text-left">{fmtDate(r.end)}</td>
                    <td>{fmtPctChg(r.movePct, 1)}</td>
                    <td>{r.days}</td>
                    <td>{fmtFeature('delivValRatio', r.pre.delivValRatio)}</td>
                    <td>{fmtPpSigned(r.pre.delivPctChgPp)}</td>
                    <td>{fmtFeature('delivBalance', r.pre.delivBalance)}</td>
                    <td>{fmtFeature('tradeSizeRatio', r.pre.tradeSizeRatio)}</td>
                    <td>{r.results === null ? DASH : fmtInt(r.results)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Select a run to shade its windows on the chart and open its footprint card. {RUNS_CAVEAT}
        </p>
      </section>

      {sel !== null && selected !== null && (
        <FootprintCard run={sel} index={selected} summary={summary} medians={medians.data} bucket={bucket} />
      )}

      <section aria-label="This stock's pattern" className="card min-w-0 p-3">
        <h2 className="mb-1 text-sm font-semibold">This stock&rsquo;s pattern</h2>
        <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
          Median footprints in the pre window (the 20 days before the start) of this stock&rsquo;s runs,
          against its ordinary days. Needs at least 3 runs in a direction.
        </p>
        <div className="grid gap-2 md:grid-cols-3">
          <PatternCard title="Up runs" row={summary.UP} dir="UP" />
          <PatternCard title="Down runs" row={summary.DOWN} dir="DOWN" />
          <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-800/60">
            <div className="text-xs font-semibold">
              Ordinary days{' '}
              <span className="font-normal text-slate-600 dark:text-slate-400">
                ({summary.ORDINARY?.runs ?? 0} days)
              </span>
            </div>
            <dl className="num mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-slate-600 dark:text-slate-400">Delivery value vs normal</dt>
              <dd className="text-right">{fmtRatio(summary.ORDINARY?.preDelivValRatio ?? null, 2)}</dd>
              <dt className="text-slate-600 dark:text-slate-400">Delivery % change</dt>
              <dd className="text-right">{fmtPpSigned(summary.ORDINARY?.preDelivPctChgPp ?? null)}</dd>
              <dt className="text-slate-600 dark:text-slate-400">Delivery balance</dt>
              <dd className="text-right">{fmtRatio(summary.ORDINARY?.preDelivBalance ?? null, 2)}</dd>
              <dt className="text-slate-600 dark:text-slate-400">Trade size vs normal</dt>
              <dd className="text-right">{fmtRatio(summary.ORDINARY?.preTradeSizeRatio ?? null, 2)}</dd>
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
