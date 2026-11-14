import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import EChart from '../charts/EChart';
import {
  breadthOption,
  flowsOption,
  histogramOption,
  retScatterOption,
  sectorBarsOption,
  trendOption,
} from '../charts/phase3';
import { palette } from '../charts/theme';
import { CsvButton, Empty, ErrorBox, Skeleton } from '../components/ui';
import { exportCsv } from '../lib/csv';
import { applyFilters, applyRangeFilters } from '../lib/filters';
import { fmtCr, fmtDate, fmtInt, fmtPct, fmtPctChg, fmtPp } from '../lib/format';
import { median } from '../lib/heat';
import {
  useApp,
  useDaily,
  useGlobalState,
  useMarket,
  usePeriods,
  usePeriodSignalPerf,
  usePeriodSnapshot,
  useSignalPerf,
  useTimeframe,
} from '../lib/hooks';
import { partialText } from '../lib/aggregate';
import { marketSeries } from '../lib/marketBars';
import { periodRowToDaily } from '../lib/periodAdapter';
import { periodFor, periodLabel, periodsOf, type TimeframeState } from '../lib/timeframe';
import {
  MEDIAN_NOTE,
  NORMAL_PERIODS,
  pointLabels,
  POINT_WORD,
  priorMean,
  sectorTotals,
  selectedPoint,
} from '../lib/statsSeries';
import { useEffectiveRange, useRangeRows } from '../lib/useRange';
import {
  buildPeriodTable,
  ENTRY_LABEL,
  GROUP_LABEL,
  PERF_DISCLAIMER,
  perfCell,
  PERIOD_THIN_NOTE,
  usable,
  type Entry,
  type PerfIndex,
} from '../lib/signalPerf';
import { useDark } from '../lib/theme';
import { useWatchlist } from '../lib/watchlist';
import { dataClient } from '../lib/dataClient';
import { useAsync } from '../lib/hooks';
import type { Market } from '../types/data';

const DEFAULT_GROUPS = ['ALL', 'ETF', 'MC:L', 'MC:U'];
const CAP_NAME: Record<string, string> = { L: 'Large', M: 'Mid', S: 'Small', U: 'Micro' };

function groupLabel(k: string, indices: readonly string[]): string {
  if (k === 'ALL') return 'All stocks';
  if (k === 'ETF') return 'ETFs';
  if (k.startsWith('MC:')) return `${CAP_NAME[k.slice(3)] ?? k.slice(3)} caps`;
  if (k.startsWith('IDX:')) return indices.includes(k.slice(4)) ? k.slice(4) : k.slice(4);
  return k.slice(4);
}

function useMobile(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
}

function Section({ title, children, label }: { title: string; children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="card min-w-0 p-3">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Trend({ market, tfs }: { market: Market; tfs: TimeframeState }) {
  const { meta } = useApp();
  const dark = useDark();
  const [params, setParams] = useSearchParams();
  const keys = Object.keys(market.groups);
  const gParam = params.get('g');
  const chosen = useMemo(
    () => (gParam?.split(',') ?? DEFAULT_GROUPS).filter((g) => g in market.groups).slice(0, 6),
    [gParam, market.groups],
  );
  const set = (next: string[]) => {
    const n = new URLSearchParams(params);
    if (next.join(',') === DEFAULT_GROUPS.join(',')) n.delete('g');
    else n.set('g', next.join(','));
    setParams(n, { replace: true });
  };
  const series = useMemo(
    () => chosen.map((g) => ({ g, s: marketSeries(market, g, tfs) })).filter((x) => x.s !== null),
    [market, chosen, tfs],
  );
  const first = series[0]?.s ?? marketSeries(market, 'ALL', tfs);
  const daily = tfs.tf === 'd' || tfs.tf === 'r';
  const option = useMemo(
    () =>
      trendOption(
        first?.ends ?? [],
        series.map(({ g, s }) => ({ name: groupLabel(g, meta.indices), values: s!.group.delivPctW })),
        palette(dark),
        {
          labels: daily || !first ? undefined : pointLabels(tfs.tf, first),
          partial: first?.partial,
          ma: daily,
        },
      ),
    [series, first, daily, tfs.tf, dark, meta.indices],
  );
  const groups = (prefix: string) => keys.filter((k) => k === prefix || k.startsWith(prefix));
  return (
    <Section title={`Delivery % trend by group, per ${POINT_WORD[tfs.tf]}`} label="Delivery % trend by group">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-sm">
        {chosen.map((g) => (
          <button
            key={g}
            type="button"
            className="chip"
            aria-label={`Remove ${groupLabel(g, meta.indices)}`}
            onClick={() => set(chosen.filter((x) => x !== g))}
          >
            {groupLabel(g, meta.indices)} ✕
          </button>
        ))}
        <select
          aria-label="Add a group"
          className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          value=""
          onChange={(e) => e.target.value && chosen.length < 6 && set([...chosen, e.target.value])}
        >
          <option value="">Add a group…</option>
          {(
            [
              ['Market', [...groups('ALL'), ...groups('ETF')]],
              ['Cap buckets', groups('MC:')],
              ['Indices', groups('IDX:')],
              ['Sectors', groups('SEC:')],
            ] as [string, string[]][]
          ).map(([label, list]) => (
            <optgroup key={label} label={label}>
              {list
                .filter((k) => !chosen.includes(k))
                .map((k) => (
                  <option key={k} value={k}>
                    {groupLabel(k, meta.indices)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <EChart option={option} height={340} ariaLabel="Delivery percent over time for the chosen groups" />
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Value-weighted delivery %
        {daily ? ', thin line = daily, thick line = 20-day average' : ` per ${POINT_WORD[tfs.tf]}`}. Every
        group except &ldquo;ETFs&rdquo; counts stocks only. Up to 6 lines.
        {first?.partial.some(Boolean) && ' A dashed line and a light point mark a period still in progress.'}
      </p>
    </Section>
  );
}

function Flows({ market, tfs }: { market: Market; tfs: TimeframeState }) {
  const dark = useDark();
  const [params, setParams] = useSearchParams();
  const s = useMemo(() => marketSeries(market, 'ALL', tfs), [market, tfs]);
  const idxNames = useMemo(() => Object.keys(s?.indexClose ?? {}), [s]);
  const ix = idxNames.includes(params.get('ix') ?? '') ? (params.get('ix') as string) : (idxNames[0] ?? null);
  const pal = palette(dark);
  const labels = useMemo(() => (s ? pointLabels(tfs.tf, s) : []), [s, tfs.tf]);
  const flows = useMemo(
    () =>
      s
        ? flowsOption(
            labels,
            s.partial,
            {
              turnoverCr: s.group.turnoverCr,
              delivValCr: s.group.delivValCr,
              index: ix ? { name: ix, values: s.indexClose[ix] ?? [] } : null,
            },
            pal,
          )
        : null,
    [s, labels, ix, pal],
  );
  const breadth = useMemo(
    () =>
      s
        ? breadthOption(
            labels,
            s.partial,
            { adv: s.group.adv, dec: s.group.dec, spikes: s.group.spikeCount2x },
            pal,
          )
        : null,
    [s, labels, pal],
  );
  if (!s || !flows || !breadth) return <Empty>No market series for this timeframe.</Empty>;
  const word = POINT_WORD[tfs.tf];
  const sums = tfs.tf !== 'd' && tfs.tf !== 'r';
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Section title={`Turnover and delivery value per ${word}`} label="Turnover and delivery value">
        {idxNames.length > 0 && (
          <label className="mb-2 flex items-center gap-1.5 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Index overlay</span>
            <select
              aria-label="Index overlay"
              className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
              value={ix ?? ''}
              onChange={(e) => {
                const n = new URLSearchParams(params);
                if (e.target.value && e.target.value !== idxNames[0]) n.set('ix', e.target.value);
                else n.delete('ix');
                setParams(n, { replace: true });
              }}
            >
              {idxNames.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        )}
        <EChart option={flows} height={300} ariaLabel="Turnover and delivery value with an index overlay" />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Stocks only.{' '}
          {sums
            ? `Each bar is the sum over the ${word}; the index line is its close at the end of the ${word}.`
            : 'Daily values; the index line is the daily close.'}
          {s.partial.some(Boolean) && ' Light dashed bars are still in progress.'}
        </p>
      </Section>
      <Section title={`Advance / decline and spikes per ${word}`} label="Advance decline and spikes">
        <EChart
          option={breadth}
          height={300}
          ariaLabel="Advancing and declining stocks and delivery spike counts"
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {sums ? `Counts are stock-days summed over the ${word}.` : 'Daily counts.'} Spikes are stocks whose
          delivery value was at least twice its average.
          {s.partial.some(Boolean) && ' Light dashed bars are still in progress.'}
        </p>
      </Section>
    </div>
  );
}

interface StatRow {
  sym: string;
  sector: string;
  delivPct: number;
  ret: number | null;
  delivVal: number | null;
}

/** What the stock-level charts show: the day, the week / month snapshot, or the range from cum/ (tf=q, c, r). */
function Distribution({ market, tfs }: { market: Market; tfs: TimeframeState }) {
  const { meta, bySym } = useApp();
  const { filters, date } = useGlobalState();
  const watch = useWatchlist();
  const nav = useNavigate();
  const dark = useDark();
  const mobile = useMobile();
  const periods = usePeriods();
  const eff = useEffectiveRange();
  const periodTf = tfs.tf === 'w' || tfs.tf === 'm' ? tfs.tf : null;
  const rangeMode = eff.fromTimeframe;
  const info = useMemo(
    () => (periodTf && periods.data ? periodFor(periodsOf(periods.data, periodTf), date) : null),
    [periodTf, periods.data, date],
  );
  const daily = useDaily(tfs.tf === 'd' ? date : null, meta.latestDate);
  const snap = usePeriodSnapshot(periodTf ?? 'w', info);
  const rng = useRangeRows(eff.resolved, rangeMode && !eff.pending);
  const ctx = useMemo(() => ({ indices: meta.indices, watchlist: new Set(watch) }), [meta.indices, watch]);
  const loading = rangeMode
    ? rng.loading || eff.pending
    : periodTf
      ? snap.loading || periods.loading
      : daily.loading;
  const error = rangeMode ? rng.error : periodTf ? (snap.error ?? periods.error) : daily.error;
  const rangeDays = eff.resolved.range.days;

  const rows: StatRow[] = useMemo(() => {
    const f = { ...filters, hideEtfs: true };
    if (rangeMode) {
      return applyRangeFilters(rng.data ?? [], bySym, f, ctx)
        .filter((r) => !r.excluded && r.delivPctWR !== null)
        .map((r) => ({
          sym: r.sym,
          sector: r.sector,
          delivPct: r.delivPctWR as number,
          ret: r.caWarn ? null : r.ret, // a split or bonus in the range leaves the return unadjusted
          delivVal: r.avgDelivValR === null ? null : r.avgDelivValR * rangeDays,
        }));
    }
    const src = periodTf ? (snap.data?.rows ?? []).map(periodRowToDaily) : (daily.data ?? []);
    return applyFilters(src, bySym, f, ctx)
      .filter((r) => r.series === 'EQ' && r.delivPct !== null)
      .map((r) => ({
        sym: r.sym,
        sector: bySym.get(r.sym)?.sector ?? '',
        delivPct: r.delivPct as number,
        ret: r.ret1,
        delivVal: r.delivValCr,
      }));
  }, [rangeMode, rng.data, rangeDays, periodTf, snap.data, daily.data, bySym, filters, ctx]);

  const pal = palette(dark);
  const dp = useMemo(() => rows.map((r) => r.delivPct), [rows]);
  const med = useMemo(() => median(dp), [dp]);
  const hist = useMemo(() => histogramOption(dp, med, pal), [dp, med, pal]);
  const scatter = useMemo(
    () =>
      retScatterOption(
        rows.filter((r) => r.ret !== null).map((r) => ({ sym: r.sym, x: r.ret as number, y: r.delivPct })),
        pal,
        mobile,
      ),
    [rows, pal, mobile],
  );

  // the market point (day, week, month, quarter, bar or the whole custom range) the tables read
  const normal = NORMAL_PERIODS[tfs.tf];
  const point = (group: string) => selectedPoint(market, group, tfs, date);
  const sectors = useMemo(() => {
    const secKeys = Object.keys(market.groups).filter((k) => k.startsWith('SEC:'));
    const dot = (name: string): number | null => {
      const p = selectedPoint(market, `SEC:${name}`, tfs, date);
      if (!p || tfs.tf === 'r') return null;
      const v = p.series.group.delivPctW;
      const now = v[p.i] ?? null;
      const avg = priorMean(v, p.i, normal);
      return now !== null && avg !== null ? now - avg : null;
    };
    if (tfs.tf === 'd') {
      return secKeys
        .map((k) => {
          const p = selectedPoint(market, k, tfs, date);
          return {
            name: k.slice(4),
            delivVal: p?.series.group.delivValCr[p.i] ?? null,
            diffPp: dot(k.slice(4)),
          };
        })
        .filter((r) => r.delivVal !== null)
        .sort((a, b) => (b.delivVal as number) - (a.delivVal as number));
    }
    return sectorTotals(rows).map((t) => ({ name: t.name, delivVal: t.delivVal, diffPp: dot(t.name) }));
  }, [market, tfs, date, rows, normal]);
  const bars = useMemo(() => sectorBarsOption(sectors, pal, mobile), [sectors, pal, mobile]);
  const caps = ['L', 'M', 'S', 'U'].map((b) => {
    const p = point(`MC:${b}`);
    const g = p?.series.group;
    const i = p?.i ?? 0;
    const now = g?.delivPctW[i] ?? null;
    const avg = g ? priorMean(g.delivPctW, i, normal) : null;
    return { b, g, i, now, avg };
  });
  const word = POINT_WORD[tfs.tf];
  const what =
    tfs.tf === 'd'
      ? fmtDate(date)
      : tfs.tf === 'r'
        ? 'the custom range'
        : rangeMode
          ? `${eff.resolved.range.a} to ${eff.resolved.range.b}`
          : info
            ? periodLabel(periodTf!, info)
            : `the ${word}`;
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title={`Delivery % across stocks, ${what}`} label="Delivery % across stocks">
          {error ? (
            <ErrorBox message={error} />
          ) : loading ? (
            <Skeleton height={280} />
          ) : (
            <EChart option={hist} height={280} ariaLabel="Histogram of delivery percent across stocks" />
          )}
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {fmtInt(rows.length)} stocks in 5-point bins; dashed line is the median ({fmtPct(med)}). Follows
            the global filters; ETFs excluded.
            {rangeMode &&
              ' Delivery % is value-weighted over the range; stocks excluded by the range rules are left out.'}
          </p>
        </Section>
        <Section title={`Delivery % vs price change, ${what}`} label="Delivery % vs price change">
          {loading ? (
            <Skeleton height={280} />
          ) : (
            <EChart
              option={scatter}
              height={280}
              ariaLabel="Scatter of delivery percent against price change"
              onItemClick={(d) => {
                const sym = (d as { sym?: string } | undefined)?.sym;
                if (sym) nav(`/stock/${encodeURIComponent(sym)}`);
              }}
            />
          )}
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Price change is the return over the {tfs.tf === 'd' ? 'day' : tfs.tf === 'r' ? 'range' : word}.
            {rangeMode && ' Stocks with a split or bonus in the range are left out of this chart.'}
          </p>
        </Section>
      </div>
      <Section title={`Delivery value by sector, ${what}`} label="Delivery value by sector">
        {sectors.length === 0 ? (
          <Empty>{loading ? 'Loading…' : 'No data for this selection.'}</Empty>
        ) : (
          <EChart
            option={bars}
            height={Math.max(300, sectors.length * 24 + 70)}
            ariaLabel="Delivery value by sector"
          />
        )}
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Bars: delivery value{tfs.tf === 'd' ? '' : ` summed over the ${tfs.tf === 'r' ? 'range' : word}`}.
          Dots: the sector&rsquo;s value-weighted delivery % minus its mean over the previous {normal}{' '}
          {tfs.tf === 'd' || tfs.tf === 'r' ? 'days' : `${word}s`}, in percentage points
          {tfs.tf === 'r' ? ' (not shown for a custom range)' : ''}. Stocks only.
        </p>
      </Section>
      <Section title="Cap buckets" label="Cap-bucket comparison">
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="num w-full min-w-[520px] text-sm">
            <thead className="text-xs text-slate-500 dark:text-slate-400">
              <tr className="text-right">
                <th className="py-1 text-left font-medium">Bucket</th>
                <th className="font-medium">Delivery %</th>
                <th className="font-medium">vs prior {normal}</th>
                <th className="font-medium">Median stock</th>
                <th className="font-medium">Turnover</th>
                <th className="font-medium">Adv / Dec</th>
                <th className="font-medium">Spikes ≥ 2×</th>
              </tr>
            </thead>
            <tbody>
              {caps.map(({ b, g, i, now, avg }) => (
                <tr key={b} className="border-t border-slate-100 text-right dark:border-slate-800">
                  <td className="py-1 text-left">{CAP_NAME[b]} caps</td>
                  <td>{fmtPct(now)}</td>
                  <td>{now !== null && avg !== null ? fmtPp(now - avg) : '—'}</td>
                  <td>{fmtPct(g?.medianDelivPct[i] ?? null)}</td>
                  <td>{fmtCr(g?.turnoverCr[i] ?? null)}</td>
                  <td>
                    {fmtInt(g?.adv[i] ?? null)} / {fmtInt(g?.dec[i] ?? null)}
                  </td>
                  <td>{fmtInt(g?.spikeCount2x[i] ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {tfs.tf === 'd'
            ? 'The day picked at the top, against its prior 20 days.'
            : `The ${tfs.tf === 'r' ? 'whole custom range (one bar; no earlier bars to compare with)' : word + ' holding the date picked at the top'}, against its previous ${normal} ${word}s. Turnover, advances, declines and spikes are sums over the ${word}.`}
          {tfs.tf === 'c' && ` ${MEDIAN_NOTE}`}
        </p>
      </Section>
    </>
  );
}

function PerfCell({
  idx,
  event,
  group,
  entry,
  horizon,
}: {
  idx: PerfIndex;
  event: string;
  group: string;
  entry: Entry;
  horizon: number;
}) {
  const r = perfCell(idx, event, group, entry, horizon);
  if (!usable(r))
    return (
      <td className="px-2 text-right text-slate-600 dark:text-slate-400" title="Fewer than 30 observations">
        —
      </td>
    );
  return (
    <td
      className="px-2 text-right"
      title={`n=${r.n.toLocaleString('en-IN')} on ${r.days} days. Mean excess ${fmtPctChg(r.meanExcess, 2)}.`}
    >
      <span className="font-medium">{fmtPctChg(r.medianExcess, 2)}</span>{' '}
      <span className="text-xs text-slate-500 dark:text-slate-400">({Math.round(r.hitRate)}%)</span>
    </td>
  );
}

export function SignalPerfTable() {
  const perf = useSignalPerf();
  const doc = useAsync('signalPerfDoc', () => dataClient.signalPerfDoc());
  const [params, setParams] = useSearchParams();
  const horizon = [1, 5, 20].includes(Number(params.get('h'))) ? Number(params.get('h')) : 20;
  const entry: Entry = params.get('en') === 't0' ? 't0' : 't1';
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  return (
    <Section title="Signal performance: what followed each event" label="Signal performance">
      <p className="mb-2 text-sm" data-testid="perf-label">
        {PERF_DISCLAIMER}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <div role="group" aria-label="Horizon" className="flex gap-1">
          {[1, 5, 20].map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={horizon === h}
              className={`chip ${horizon === h ? 'bg-blue-600 text-white' : ''}`}
              onClick={() => set('h', h === 20 ? null : String(h))}
            >
              {h} {h === 1 ? 'day' : 'days'}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Entry" className="flex gap-1">
          {(['t1', 't0'] as Entry[]).map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={entry === e}
              className={`chip ${entry === e ? 'bg-blue-600 text-white' : ''}`}
              onClick={() => set('en', e === 't1' ? null : e)}
            >
              {e === 't1' ? 'Next-day close (default)' : 'Same-day close'}
            </button>
          ))}
        </div>
      </div>
      {perf.error || doc.error ? (
        <ErrorBox message={(perf.error ?? doc.error) as string} />
      ) : !perf.data || !doc.data ? (
        <Skeleton height={300} />
      ) : (
        <div className="overflow-x-auto" tabIndex={0}>
          <div className="mb-1 flex justify-end">
            <CsvButton
              onClick={() => {
                const d = doc.data!;
                const cells = (ev: string) =>
                  d.groups.flatMap((g) => {
                    const r = perfCell(perf.data!, ev, g, entry, horizon);
                    return usable(r) ? [r.medianExcess, r.hitRate, r.n] : [null, null, null];
                  });
                exportCsv(
                  `signal-performance-${entry}-${horizon}d`,
                  'table',
                  [
                    'Event',
                    ...d.groups.flatMap((g) => {
                      const name = GROUP_LABEL[g] ?? g;
                      return [`${name} median excess %`, `${name} hit rate %`, `${name} n`];
                    }),
                  ],
                  d.events.map((ev) => [ev.label, ...cells(ev.id)]),
                );
              }}
            />
          </div>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-1 text-left font-medium">Event</th>
                {doc.data.groups.map((g) => (
                  <th key={g} className="px-2 text-right font-medium">
                    {GROUP_LABEL[g] ?? g}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.data.events.map((ev) => (
                <tr key={ev.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-2">{ev.label}</td>
                  {doc.data!.groups.map((g) => (
                    <PerfCell
                      key={g}
                      idx={perf.data!}
                      event={ev.id}
                      group={g}
                      entry={entry}
                      horizon={horizon}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Each cell: median return minus the same group&rsquo;s median that day (hit rate: share beating it).
        Entry at the {ENTRY_LABEL[entry]}. Hover a cell for n and the mean; cells with fewer than 30 cases are
        hidden. Sample {doc.data ? `${fmtDate(doc.data.window.from)} to ${fmtDate(doc.data.window.to)}` : ''}.
        Events overlap in time, so treat small differences as noise.
      </p>
    </Section>
  );
}

function PeriodSignalPerf({ tf }: { tf: 'w' | 'm' }) {
  const rows = usePeriodSignalPerf();
  const doc = useAsync('signalPerfPeriodsDoc', () => dataClient.signalPerfPeriodsDoc());
  const [params, setParams] = useSearchParams();
  const info = doc.data?.timeframes[tf];
  const hi = Number(params.get('ph')) === 1 ? 1 : 0;
  const horizon = info?.horizons[hi] ?? info?.horizons[0] ?? 0;
  const table = useMemo(
    () =>
      rows.data && doc.data
        ? buildPeriodTable(
            rows.data,
            tf,
            horizon,
            doc.data.events.map((e) => e.id),
            doc.data.groups,
            doc.data.minN,
          )
        : null,
    [rows.data, doc.data, tf, horizon],
  );
  const noun = tf === 'w' ? 'Weekly' : 'Monthly';
  return (
    <Section
      title={`Signal performance: what followed each ${tf === 'w' ? 'weekly' : 'monthly'} event`}
      label="Signal performance"
    >
      <p className="mb-2 text-sm" data-testid="perf-label">
        {doc.data?.label ?? PERF_DISCLAIMER}
      </p>
      {info && (
        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
          <div role="group" aria-label="Horizon" className="flex gap-1">
            {info.horizonLabels.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-pressed={hi === i}
                className={`chip ${hi === i ? 'bg-blue-600 text-white' : ''}`}
                onClick={() => {
                  const n = new URLSearchParams(params);
                  if (i === 0) n.delete('ph');
                  else n.set('ph', String(i));
                  setParams(n, { replace: true });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {rows.error || doc.error ? (
        <ErrorBox message={(rows.error ?? doc.error) as string} />
      ) : !table || !doc.data ? (
        <Skeleton height={260} />
      ) : (
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-1 text-left font-medium">Event</th>
                {doc.data.groups.map((g) => (
                  <th key={g} className="px-2 text-right font-medium">
                    {GROUP_LABEL[g] ?? g}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr key={row.event} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-2">
                    {doc.data!.events.find((e) => e.id === row.event)?.label ?? row.event}
                  </td>
                  {row.cells.map((c) =>
                    c.shown ? (
                      <td
                        key={c.group}
                        className="px-2 text-right"
                        title={`n=${c.n.toLocaleString('en-IN')} events in ${c.periods} periods`}
                      >
                        <span className="font-medium">{fmtPctChg(c.medianExcess, 2)}</span>{' '}
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          ({Math.round(c.hitRate as number)}%)
                        </span>
                      </td>
                    ) : (
                      <td
                        key={c.group}
                        className="px-2 text-right text-xs text-slate-600 dark:text-slate-400"
                        title={`Fewer than ${doc.data!.minN} events (n=${c.n})`}
                      >
                        too few events
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Each cell: median return minus the same group&rsquo;s median over the same horizon (hit rate: share
        beating it), {horizon > 0 && info ? `${info.horizonLabels[hi] ?? ''} after` : 'after'} the period
        ends. Hover a cell for n and the number of periods; cells with fewer than {doc.data?.minN ?? 30}{' '}
        events are hidden.{' '}
        {doc.data ? `Sample ${fmtDate(doc.data.window.from)} to ${fmtDate(doc.data.window.to)}. ` : ''}
        Periods in progress are not counted as events.
      </p>
      {tf === 'm' && (
        <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300" data-testid="perf-thin">
          {PERIOD_THIN_NOTE}
        </p>
      )}
      <span className="sr-only">{noun} signals</span>
    </Section>
  );
}

function SignalPerfSection({ tfs }: { tfs: TimeframeState }) {
  if (tfs.tf === 'w' || tfs.tf === 'm') return <PeriodSignalPerf tf={tfs.tf} />;
  return (
    <>
      {tfs.tf !== 'd' && (
        <p className="card p-3 text-sm" data-testid="perf-tf-note">
          Signal performance is measured for daily, weekly and monthly signals. The table below is the daily
          one; switch the timeframe to W or M for the weekly and monthly tables.
        </p>
      )}
      <SignalPerfTable />
    </>
  );
}

function Scope({ tfs }: { tfs: TimeframeState }) {
  const { date } = useGlobalState();
  const periods = usePeriods();
  const tf = tfs.tf;
  if (tf === 'd')
    return <p className="text-sm text-slate-500 dark:text-slate-400">Daily, {fmtDate(date)}.</p>;
  if (tf === 'c')
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="stats-scope">
        Bars of {tfs.n} trading days, ending on the latest date. The first bar may be shorter and is marked in
        progress. {MEDIAN_NOTE}
      </p>
    );
  if (tf === 'r')
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="stats-scope">
        Daily points inside the custom range {tfs.from ? fmtDate(tfs.from) : '…'} to{' '}
        {tfs.to ? fmtDate(tfs.to) : '…'}. Set the range with the timeframe control.
      </p>
    );
  const info = periods.data ? periodFor(periodsOf(periods.data, tf), date) : null;
  const partial = info ? partialText(info) : null;
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="stats-scope">
      {tf === 'w' ? 'Weekly' : tf === 'm' ? 'Monthly' : 'Quarterly'}
      {info ? `, ${periodLabel(tf, info)}` : ''}
      {partial ? <span className="ml-1 text-amber-700 dark:text-amber-400">{partial}</span> : null}. Flows are
      sums over the period.
    </p>
  );
}

export default function Stats() {
  const market = useMarket();
  const { state: tfs } = useTimeframe();
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Market Statistics</h1>
      <Scope tfs={tfs} />
      {market.error ? (
        <ErrorBox message={market.error} />
      ) : !market.data ? (
        <>
          <Skeleton height={340} />
          <Skeleton height={280} />
        </>
      ) : (
        <>
          <Trend market={market.data} tfs={tfs} />
          <Flows market={market.data} tfs={tfs} />
          <Distribution market={market.data} tfs={tfs} />
        </>
      )}
      <SignalPerfSection tfs={tfs} />
    </div>
  );
}
