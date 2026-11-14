import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import EChart from '../charts/EChart';
import { quadrantOption, type QuadPoint } from '../charts/phase3';
import { deliveryClass, palette, priceClass } from '../charts/theme';
import RangeControls from '../components/RangeControls';
import { AppLink, CsvButton, Empty, ErrorBox, EtfBadge, Skeleton } from '../components/ui';
import { exportCsv } from '../lib/csv';
import { applyRangeFilters } from '../lib/filters';
import { fmtDate, fmtNum, fmtPctChg, fmtPp, fmtRatio } from '../lib/format';
import { useApp, useGlobalState } from '../lib/hooks';
import { metricValue, type RangeMetric as Metric, type RangeScreenRow } from '../lib/range';
import { SIGNAL_LABEL } from '../lib/signals';
import { useDark } from '../lib/theme';
import { useEffectiveRange, useRangeRows } from '../lib/useRange';
import { useWatchlist } from '../lib/watchlist';
import type { SignalCode } from '../types/data';

const CODES: SignalCode[] = ['ACC', 'DIS', 'SPU', 'SPD'];
const TOP = 25;

const METRICS: { id: Metric; label: string }[] = [
  { id: 'val', label: 'Delivery value' },
  { id: 'pct', label: 'Delivery %' },
  { id: 'bal', label: 'Delivery balance' },
  { id: 'ats', label: 'Avg trade size' },
];
const HEAD: Record<Metric, string> = {
  val: 'Deliv value',
  pct: 'Deliv %',
  bal: 'Balance chg',
  ats: 'Trade size',
};

function fmtMetric(v: number | null, m: Metric): string {
  if (m === 'val') return fmtPctChg(v, 0);
  if (m === 'pct') return fmtPp(v);
  if (m === 'bal') return v === null ? '—' : `${v > 0 ? '+' : ''}${fmtNum(v, 2)}`;
  return fmtRatio(v, 2);
}

function RankTable({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: readonly RangeScreenRow[];
  metric: Metric;
}) {
  return (
    <section aria-label={title} className="card min-w-0 p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <CsvButton
          disabled={rows.length === 0}
          onClick={() =>
            exportCsv(
              `compare-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${metric}`,
              'range',
              ['Symbol', HEAD[metric], 'Return %', 'Balance', 'Size vs base', 'Signal'],
              rows.map((r) => [
                r.sym,
                metricValue(r, metric),
                r.ret,
                r.delivBalanceR,
                r.tradeSizeRatio,
                r.signal,
              ]),
            )
          }
        />
      </div>
      <div className="overflow-x-auto" tabIndex={0}>
        <table className="num w-full min-w-[420px] text-sm">
          <thead className="text-xs text-slate-500 dark:text-slate-400">
            <tr className="text-right">
              <th className="py-1 text-left font-medium">Symbol</th>
              <th className="font-medium">{HEAD[metric]}</th>
              <th className="font-medium">Return</th>
              <th
                className="font-medium"
                title="Delivery value on up days divided by delivery value on down days, in the range"
              >
                Balance
              </th>
              <th
                className="font-medium"
                title="Average trade size in the range relative to the baseline (turnover per trade)"
              >
                Size vs base
              </th>
              <th className="pl-2 text-left font-medium">Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = metricValue(r, metric);
              return (
                <tr key={r.sym} className="border-t border-slate-100 text-right dark:border-slate-800">
                  <td className="py-1 text-left">
                    <AppLink
                      to={`/stock/${encodeURIComponent(r.sym)}`}
                      className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
                    >
                      {r.sym}
                    </AppLink>{' '}
                    <EtfBadge show={r.etf} />
                    {r.caWarn && (
                      <span
                        role="img"
                        aria-label="Corporate action in range"
                        title="Corporate action in range: price return not adjusted"
                        className="text-amber-600 dark:text-amber-400"
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className={deliveryClass(v)}>{fmtMetric(v, metric)}</td>
                  <td className={priceClass(r.ret)}>{fmtPctChg(r.ret, 1)}</td>
                  <td>{r.delivBalanceR === null ? '�' : fmtNum(r.delivBalanceR, 2)}</td>
                  <td>{fmtRatio(r.tradeSizeRatio, 2)}</td>
                  <td className="pl-2 text-left text-xs">{r.signal ? SIGNAL_LABEL[r.signal] : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Compare() {
  const { meta, bySym } = useApp();
  const { filters } = useGlobalState();
  const watch = useWatchlist();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const dark = useDark();
  const state = useEffectiveRange();
  const res = useRangeRows(state.resolved, !state.pending);
  const cm = params.get('cm');
  const metric: Metric = METRICS.some((m) => m.id === cm) ? (cm as Metric) : 'val';
  const sig = CODES.includes(params.get('sg') as SignalCode) ? (params.get('sg') as SignalCode) : null;
  const showExcluded = params.get('ex') === '1';
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };

  const ctx = useMemo(() => ({ indices: meta.indices, watchlist: new Set(watch) }), [meta.indices, watch]);
  const all = useMemo(
    () => (res.data ? applyRangeFilters(res.data, bySym, filters, ctx) : []),
    [res.data, bySym, filters, ctx],
  );
  const ranked = useMemo(() => all.filter((r) => !r.excluded), [all]);
  const excluded = useMemo(() => all.filter((r) => r.excluded), [all]);
  const counts = useMemo(() => {
    const c: Record<SignalCode, number> = { ACC: 0, DIS: 0, SPU: 0, SPD: 0, ABS: 0 };
    for (const r of ranked) if (r.signal) c[r.signal]++;
    return c;
  }, [ranked]);
  const shown = useMemo(() => (sig ? ranked.filter((r) => r.signal === sig) : ranked), [ranked, sig]);
  const sorted = useMemo(
    () =>
      shown
        .filter((r) => metricValue(r, metric) !== null)
        .sort((a, b) => (metricValue(b, metric) as number) - (metricValue(a, metric) as number)),
    [shown, metric],
  );
  const up = sorted.slice(0, TOP);
  const down = sorted.slice(-TOP).reverse();

  const sectors = useMemo(() => [...new Set(ranked.map((r) => r.sector))].sort(), [ranked]);
  // rows with a split/bonus in range have unadjusted returns, so they leave the return-based scatter
  const points: QuadPoint[] = useMemo(
    () =>
      shown
        .filter((r) => !r.caWarn && r.ret !== null && r.delivPctChgPp !== null && !r.etf)
        .map((r) => ({
          sym: r.sym,
          name: r.name,
          sector: r.sector,
          x: r.ret as number,
          y: r.delivPctChgPp as number,
          size: r.avgTurnoverR ?? 0,
        })),
    [shown],
  );
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  const option = useMemo(
    () =>
      quadrantOption(
        points,
        palette(dark),
        sectors,
        { x: 'Price return over the range, %', y: 'Delivery % change, pp' },
        mobile,
      ),
    [points, dark, sectors, mobile],
  );

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Period Compare</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        How delivery in a date range compares with a baseline period, per stock. Value-based fields only;
        delivery balance is delivery value on up days over down days. The range ends on the date picked at the
        top ({fmtDate(state.resolved.range.b)}).
      </p>
      {state.fromTimeframe ? (
        <section aria-label="Range from the timeframe" className="card space-y-1 p-3">
          <p className="text-sm font-medium" data-testid="tf-range-note">
            Range set by the timeframe control
          </p>
          <p className="text-sm" data-testid="range-text">
            {state.pending ? 'Resolving the range�' : state.resolved.text}
          </p>
        </section>
      ) : (
        <RangeControls state={state} quick />
      )}

      {state.pending ? (
        <Skeleton height={44} />
      ) : res.error ? (
        <ErrorBox message={res.error} />
      ) : res.loading ? (
        <>
          <Skeleton height={44} />
          <Skeleton height={420} />
        </>
      ) : state.resolved.baseline === null ? (
        <Empty>
          There is no earlier data for a baseline before this range. Pick a shorter range or a custom
          baseline.
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div role="group" aria-label="Rank by" className="flex gap-1">
              {METRICS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={metric === m.id}
                  className={`chip ${metric === m.id ? 'bg-blue-600 text-white' : ''}`}
                  onClick={() => set('cm', m.id === 'val' ? null : m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Range signal" className="flex flex-wrap gap-1">
              {CODES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={sig === c}
                  className={`chip ${sig === c ? 'bg-blue-600 text-white' : ''}`}
                  onClick={() => set('sg', sig === c ? null : c)}
                >
                  {SIGNAL_LABEL[c]} ({counts[c]})
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showExcluded}
                onChange={() => set('ex', showExcluded ? null : '1')}
              />
              Show excluded ({excluded.length})
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <RankTable title="Delivery increased" rows={up} metric={metric} />
            <RankTable title="Delivery decreased" rows={down} metric={metric} />
          </div>

          <section aria-label="Quadrant scatter" className="card min-w-0 p-3">
            <h2 className="mb-1 text-sm font-semibold">Price return vs change in delivery %</h2>
            {points.length === 0 ? (
              <Empty>No stocks to plot.</Empty>
            ) : (
              <EChart
                option={option}
                height={mobile ? 340 : 460}
                ariaLabel="Scatter of price return against change in delivery percent"
                onItemClick={(d) => {
                  const sym = (d as { sym?: string } | undefined)?.sym;
                  if (sym) nav(`/stock/${encodeURIComponent(sym)}`);
                }}
              />
            )}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Dot size is turnover, colour is sector. Diamonds sit beyond the plotted range and are pinned to
              the edge. Stocks with a split or bonus in the range are left out because their price return is
              not adjusted.
            </p>
          </section>

          {showExcluded && (
            <section aria-label="Excluded rows" className="card p-3">
              <h2 className="mb-1 text-sm font-semibold">Excluded from the rankings</h2>
              {excluded.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">None.</p>
              ) : (
                <ul className="max-h-72 space-y-0.5 overflow-auto text-sm text-slate-500 dark:text-slate-400">
                  {excluded.slice(0, 300).map((r) => (
                    <li key={r.sym}>
                      <b>{r.sym}</b>: {r.excludedReasons.join('; ')}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Excluded: fewer than 60% of range or baseline days traded, a baseline delivery value or turnover
            below the floor. Range signals describe what happened and do not predict anything.
          </p>
        </>
      )}
    </div>
  );
}
