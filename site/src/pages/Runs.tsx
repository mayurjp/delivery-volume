import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import EChart from '../charts/EChart';
import { mediansOption, oddsOption } from '../charts/runsLibrary';
import { palette } from '../charts/theme';
import { CsvButton, Empty, ErrorBox, Skeleton } from '../components/ui';
import { exportCsv } from '../lib/csv';
import { DASH, fmtDate, fmtInt, fmtPctChg } from '../lib/format';
import { useApp, useRunFootprints, useRunsLibrary } from '../lib/hooks';
import {
  BUCKET_CHOICES,
  BUCKET_LABEL,
  DEFAULT_MIN_MOVE,
  DIR_CHOICES,
  LIB_CAVEATS,
  LIB_CSV_HEADERS,
  LIB_PAGE,
  MIN_MOVE_CHOICES,
  ODDS_LABEL,
  WINDOW_CHOICES,
  filterLibrary,
  libCsvRows,
  mediansSeries,
  oddsSeries,
  parseLibQuery,
  writeLibQuery,
  type BucketChoice,
  type DirChoice,
  type LibQuery,
  type OddsHorizon,
} from '../lib/runLibrary';
import { FEATURE_IDS, FEATURE_LABEL, fmtFeature, fmtPpSigned, type WindowId } from '../lib/runs';
import { useWatchlist } from '../lib/watchlist';
import { useDark } from '../lib/theme';
import type { RunFootprintsDoc, RunLibRow } from '../types/data';

/** The statistics' sample window and universe label (untyped in RunFootprintsDoc). */
const sampleWindow = (d: RunFootprintsDoc): { from: string; to: string } =>
  d.window as { from: string; to: string };
const universeLabel = (d: RunFootprintsDoc): string => (d.universe as { label: string }).label;

const DIR_LABEL: Record<DirChoice, string> = { ALL: 'All', UP: 'UP', DOWN: 'DOWN' };
const WINDOW_LABEL: Record<WindowId, string> = {
  pre: 'Pre (20 days before the start)',
  early: 'Early (first 5 days)',
  full: 'Full run',
  post: 'Post (20 days after the end)',
};

const DOT_HELP =
  'Each run is a move of at least 20% over at least 5 trading days, found on back-adjusted closes. Pre, early, full and post are the windows of 07 section 2, each compared with the same stock-days or the market.';

/** The Run library (07 section 7): filters in the URL, the runs table, the footprint medians and the odds. */
export default function Runs() {
  const { meta, universe } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const dark = useDark();
  const pal = palette(dark);
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const lib = useRunsLibrary();
  const stats = useRunFootprints();
  const watch = useWatchlist();
  const watchSet = useMemo(() => new Set(watch), [watch]);

  const q = useMemo(
    () =>
      parseLibQuery(new URLSearchParams(params.toString()), meta.settings.minTurnoverAvg20Cr, meta.indices),
    [params, meta.settings.minTurnoverAvg20Cr, meta.indices],
  );
  const universeMap = useMemo(() => new Map(universe.map((u) => [u.sym, u])), [universe]);
  const matched = useMemo(
    () =>
      lib.data
        ? filterLibrary(lib.data, q, { indices: meta.indices, universe: universeMap, watchlist: watchSet })
        : [],
    [lib.data, q, meta.indices, universeMap, watchSet],
  );
  const [showAll, setShowAll] = useState(false);
  const [window_, setWindow] = useState<WindowId>('pre');
  const [bucket, setBucket] = useState<BucketChoice>('ALL');
  const [horizon, setHorizon] = useState<OddsHorizon>(20);

  const write = (next: LibQuery) => {
    setShowAll(false);
    setParams(writeLibQuery(new URLSearchParams(params.toString()), next), { replace: true });
  };

  const sectors = useMemo(
    () => [...new Set(universe.map((u) => u.sector))].sort((a, b) => a.localeCompare(b)),
    [universe],
  );
  const counts = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const r of matched) {
      if (r.dir === 'UP') up++;
      else down++;
    }
    return { up, down };
  }, [matched]);
  const shown = showAll ? matched : matched.slice(0, LIB_PAGE);
  const medians = useMemo(() => mediansSeries(stats.data, window_, bucket), [stats.data, window_, bucket]);
  const oddsList = useMemo(
    () => (stats.data ? FEATURE_IDS.map((f) => oddsSeries(stats.data, horizon, f)) : []),
    [stats.data, horizon],
  );

  const openRun = (r: RunLibRow) =>
    navigate(`/stock/${encodeURIComponent(r.sym)}?tab=runs&run=${encodeURIComponent(r.start)}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Run library</h1>
        <span className="text-xs text-slate-600 dark:text-slate-400">
          Runs of 20% or more, all stocks in the universe, as of {lib.data ? fmtDate(meta.latestDate) : '…'}
        </span>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Find past big moves, up and down, and the footprints that came before them. {DOT_HELP}
      </p>
      <p className="text-sm font-semibold">Historical, not a prediction. Evidence, not advice.</p>

      <section aria-label="Run filters" className="card space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <fieldset className="space-y-1">
            <legend className="text-xs font-semibold text-slate-600 dark:text-slate-400">Direction</legend>
            <div role="group" aria-label="Direction" className="flex gap-1">
              {DIR_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={q.dir === d}
                  className={`chip ${q.dir === d ? 'bg-blue-600 text-white' : ''}`}
                  onClick={() => write({ ...q, dir: d })}
                >
                  {DIR_LABEL[d]}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="space-y-1 text-xs">
            <span className="block font-semibold text-slate-600 dark:text-slate-400">Minimum move</span>
            <select
              className="btn w-full text-sm"
              value={q.minMove}
              onChange={(e) => write({ ...q, minMove: Number(e.target.value) })}
            >
              {MIN_MOVE_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m === DEFAULT_MIN_MOVE ? '20% or more (all runs)' : `${m}% or more`}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="block font-semibold text-slate-600 dark:text-slate-400">Universe</span>
            <select
              className="btn w-full text-sm"
              value={q.u}
              onChange={(e) => write({ ...q, u: e.target.value })}
            >
              <option value="ALL">All stocks</option>
              <option value="WATCHLIST">Watchlist</option>
              {meta.indices.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs font-semibold text-slate-600 dark:text-slate-400">Cap bucket</legend>
            <div role="group" aria-label="Cap bucket" className="flex flex-wrap gap-1">
              {(['L', 'M', 'S', 'U'] as const).map((b) => {
                const on = q.b.includes(b);
                return (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={on}
                    className={`chip ${on ? 'bg-blue-600 text-white' : ''}`}
                    onClick={() => write({ ...q, b: on ? q.b.filter((x) => x !== b) : [...q.b, b] })}
                  >
                    {BUCKET_LABEL[b]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="space-y-1 text-xs">
            <span className="block font-semibold text-slate-600 dark:text-slate-400">Sector</span>
            <select
              className="btn w-full text-sm"
              value={q.sec[0] ?? ''}
              onChange={(e) => write({ ...q, sec: e.target.value ? [e.target.value] : [] })}
            >
              <option value="">All sectors</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs">
              <span className="block font-semibold text-slate-600 dark:text-slate-400">Start from</span>
              <input
                type="date"
                className="btn w-full text-sm"
                min={meta.firstDate}
                max={meta.latestDate}
                value={q.from ?? ''}
                onChange={(e) => write({ ...q, from: e.target.value || null })}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="block font-semibold text-slate-600 dark:text-slate-400">Start to</span>
              <input
                type="date"
                className="btn w-full text-sm"
                min={meta.firstDate}
                max={meta.latestDate}
                value={q.to ?? ''}
                onChange={(e) => write({ ...q, to: e.target.value || null })}
              />
            </label>
          </div>
        </div>
      </section>

      <section aria-label="Runs table" className="card min-w-0 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" data-testid="lib-count">
            {matched.length} runs match ({counts.up} UP, {counts.down} DOWN)
          </h2>
          <CsvButton
            disabled={matched.length === 0}
            onClick={() => exportCsv('run-library', meta.latestDate, LIB_CSV_HEADERS, libCsvRows(matched))}
          />
        </div>
        {lib.error ? (
          <ErrorBox message={lib.error} />
        ) : !lib.data ? (
          <Skeleton height={320} />
        ) : matched.length === 0 ? (
          <Empty>No runs match these filters.</Empty>
        ) : (
          <>
            <div className="max-h-[480px] overflow-auto" tabIndex={0}>
              <table className="num w-full min-w-[760px] text-xs" data-testid="lib-table">
                <thead className="sticky top-0 bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                  <tr className="text-right">
                    <th className="py-1 text-left font-medium">Symbol</th>
                    <th className="text-left font-medium">Direction</th>
                    <th className="text-left font-medium">Start</th>
                    <th className="text-left font-medium">End</th>
                    <th className="font-medium">Move</th>
                    <th className="font-medium">Days</th>
                    <th className="font-medium">Cap</th>
                    <th className="text-left font-medium">Sector</th>
                    <th className="font-medium" title="Pre window delivery value vs normal">
                      Pre deliv. value
                    </th>
                    <th className="font-medium" title="Pre window delivery % change, pp">
                      Pre deliv. %
                    </th>
                    <th className="font-medium" title="Pre window delivery balance (up vs down days)">
                      Pre balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr
                      key={`${r.sym}-${r.dir}-${r.start}`}
                      data-testid="lib-row"
                      onClick={() => openRun(r)}
                      className="cursor-pointer border-t border-slate-100 text-right hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                    >
                      <td className="py-1 text-left">
                        <Link
                          to={`/stock/${encodeURIComponent(r.sym)}?tab=runs&run=${encodeURIComponent(r.start)}`}
                          className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.sym}
                        </Link>
                      </td>
                      <td className="text-left">
                        {r.dir === 'UP' ? (
                          <span className="text-teal-700 dark:text-teal-300">UP</span>
                        ) : (
                          <span className="text-orange-700 dark:text-orange-300">DOWN</span>
                        )}
                      </td>
                      <td className="text-left">{fmtDate(r.start)}</td>
                      <td className="text-left">{fmtDate(r.end)}</td>
                      <td>{fmtPctChg(r.movePct, 1)}</td>
                      <td>{r.days}</td>
                      <td>{r.bucket ?? DASH}</td>
                      <td className="text-left">{r.sector ?? DASH}</td>
                      <td>{fmtFeature('delivValRatio', r.preDelivValRatio)}</td>
                      <td>{fmtPpSigned(r.preDelivPctChgPp)}</td>
                      <td>{fmtFeature('delivBalance', r.preDelivBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>
                Showing {shown.length} of {matched.length}. Click a row to open that stock&apos;s Runs tab at
                the run.
              </span>
              {!showAll && matched.length > LIB_PAGE && (
                <button type="button" className="btn text-xs" onClick={() => setShowAll(true)}>
                  Show all {fmtInt(matched.length)}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section aria-label="What came before big moves" className="card min-w-0 space-y-2 p-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-semibold">What came before big moves</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <label className="space-y-1">
              <span className="block text-slate-600 dark:text-slate-400">Window</span>
              <select
                className="btn text-xs"
                value={window_}
                onChange={(e) => setWindow(e.target.value as WindowId)}
              >
                {WINDOW_CHOICES.map((w) => (
                  <option key={w} value={w}>
                    {WINDOW_LABEL[w]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-slate-600 dark:text-slate-400">Cap bucket</span>
              <select
                className="btn text-xs"
                value={bucket}
                onChange={(e) => setBucket(e.target.value as BucketChoice)}
              >
                {BUCKET_CHOICES.map((b) => (
                  <option key={b} value={b}>
                    {BUCKET_LABEL[b]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Market-wide medians of each feature for UP runs, DOWN runs and ordinary stock-days, from the
          statistics file. Ordinary days are stored for the pre window only.
          {window_ !== 'pre' && ' Ordinary days are not shown for this window.'}
        </p>
        {stats.error ? (
          <ErrorBox message={stats.error} />
        ) : !stats.data ? (
          <Skeleton height={320} />
        ) : (
          <EChart
            option={mediansOption(medians, pal, mobile, dark)}
            height={mobile ? 360 : 340}
            ariaLabel="Median footprints of UP runs, DOWN runs and ordinary days"
          />
        )}
      </section>

      <section aria-label="Does it raise the odds" className="card min-w-0 space-y-2 p-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-semibold">Does it raise the odds?</h2>
          <div role="group" aria-label="Horizon" className="flex gap-1">
            {([20, 60] as const).map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={horizon === h}
                className={`chip ${horizon === h ? 'bg-blue-600 text-white' : ''}`}
                onClick={() => setHorizon(h)}
              >
                {h === 20 ? '20-day lift' : '60-day, long horizon'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {ODDS_LABEL[horizon]}. Each feature is split into quintiles (Q1 lowest, Q5 highest) of stock-days.
          Bars show the share of those stock-days followed by a move of at least{' '}
          {stats.data?.bigMovePct ?? 15}% up (teal) or down (orange). Dashed lines are the base rates for all
          stock-days. Entry is at the next day&apos;s close, so no later data is used.
        </p>
        {stats.error ? (
          <ErrorBox message={stats.error} />
        ) : !stats.data ? (
          <Skeleton height={320} />
        ) : oddsList.every((o) => o.status !== 'computed') ? (
          <Empty>Needs more history: the long-horizon table needs at least 2 years of data.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {oddsList.map((o) => (
              <figure key={o.feature} className="min-w-0 space-y-1">
                <figcaption className="text-xs font-semibold">{FEATURE_LABEL[o.feature]}</figcaption>
                {o.status === 'computed' && o.cells.length > 0 ? (
                  <EChart
                    option={oddsOption(o, pal, dark, mobile)}
                    height={mobile ? 200 : 180}
                    ariaLabel={`${FEATURE_LABEL[o.feature]}: odds of a big up or down move by quintile`}
                  />
                ) : (
                  <Empty>Needs more history.</Empty>
                )}
              </figure>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Caveats" className="card space-y-2 border-amber-300 p-3 dark:border-amber-800">
        <h2 className="text-sm font-semibold">Caveats</h2>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700 dark:text-slate-300">
          {LIB_CAVEATS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Sample:{' '}
          {stats.data
            ? `${fmtDate(sampleWindow(stats.data).from)} to ${fmtDate(sampleWindow(stats.data).to)}`
            : '…'}
          . Universe: {stats.data ? universeLabel(stats.data) : '…'}.
        </p>
      </section>
    </div>
  );
}
