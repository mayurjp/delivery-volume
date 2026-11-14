import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import EChart from '../charts/EChart';
import { histogramOption, retScatterOption, sectorBarsOption, trendOption } from '../charts/phase3';
import { palette } from '../charts/theme';
import { Empty, ErrorBox, Skeleton } from '../components/ui';
import { applyFilters } from '../lib/filters';
import { fmtCr, fmtDate, fmtInt, fmtPct, fmtPctChg, fmtPp } from '../lib/format';
import { median } from '../lib/heat';
import { useApp, useDaily, useGlobalState, useMarket, useSignalPerf } from '../lib/hooks';
import {
  ENTRY_LABEL,
  GROUP_LABEL,
  PERF_DISCLAIMER,
  perfCell,
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

function Trend({ market }: { market: Market }) {
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
  const option = useMemo(
    () =>
      trendOption(
        market.dates,
        chosen.map((g) => ({ name: groupLabel(g, meta.indices), values: market.groups[g]!.delivPctW })),
        palette(dark),
      ),
    [market, chosen, dark, meta.indices],
  );
  const groups = (prefix: string) => keys.filter((k) => k === prefix || k.startsWith(prefix));
  return (
    <Section title="Delivery % trend by group">
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
        Value-weighted delivery %, thin line = daily, thick line = 20-day average. Every group except
        &ldquo;ETFs&rdquo; counts stocks only. Up to 6 lines.
      </p>
    </Section>
  );
}

function DayCharts({ market }: { market: Market }) {
  const { meta, bySym } = useApp();
  const { filters, date } = useGlobalState();
  const watch = useWatchlist();
  const nav = useNavigate();
  const dark = useDark();
  const mobile = useMobile();
  const daily = useDaily(date, meta.latestDate);
  const ctx = useMemo(() => ({ indices: meta.indices, watchlist: new Set(watch) }), [meta.indices, watch]);
  const rows = useMemo(
    () =>
      applyFilters(daily.data ?? [], bySym, { ...filters, hideEtfs: true }, ctx).filter(
        (r) => r.series === 'EQ' && r.delivPct !== null,
      ),
    [daily.data, bySym, filters, ctx],
  );
  const pal = palette(dark);
  const dp = useMemo(() => rows.map((r) => r.delivPct as number), [rows]);
  const med = useMemo(() => median(dp), [dp]);
  const hist = useMemo(() => histogramOption(dp, med, pal), [dp, med, pal]);
  const scatter = useMemo(
    () =>
      retScatterOption(
        rows
          .filter((r) => r.ret1 !== null)
          .map((r) => ({ sym: r.sym, x: r.ret1 as number, y: r.delivPct as number })),
        pal,
        mobile,
      ),
    [rows, pal, mobile],
  );
  const di = market.dates.indexOf(date);
  const sectors = useMemo(() => {
    if (di < 0) return [];
    return Object.entries(market.groups)
      .filter(([k]) => k.startsWith('SEC:'))
      .map(([k, g]) => {
        const prior = g.delivPctW.slice(Math.max(0, di - 20), di).filter((v): v is number => v !== null);
        const now = g.delivPctW[di] ?? null;
        const avg = prior.length >= 10 ? prior.reduce((s, x) => s + x, 0) / prior.length : null;
        return {
          name: k.slice(4),
          delivVal: g.delivValCr[di] ?? null,
          diffPp: now !== null && avg !== null ? now - avg : null,
        };
      })
      .filter((r) => r.delivVal !== null)
      .sort((a, b) => (b.delivVal as number) - (a.delivVal as number));
  }, [market, di]);
  const bars = useMemo(() => sectorBarsOption(sectors, pal, mobile), [sectors, pal, mobile]);
  const caps = ['L', 'M', 'S', 'U'].map((b) => {
    const g = market.groups[`MC:${b}`];
    const prior = (g?.delivPctW ?? []).slice(Math.max(0, di - 20), di).filter((v): v is number => v !== null);
    const avg = prior.length >= 10 ? prior.reduce((s, x) => s + x, 0) / prior.length : null;
    return { b, g, now: g?.delivPctW[di] ?? null, avg };
  });
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title={`Delivery % across stocks, ${fmtDate(date)}`}>
          {daily.error ? (
            <ErrorBox message={daily.error} />
          ) : daily.loading ? (
            <Skeleton height={280} />
          ) : (
            <EChart option={hist} height={280} ariaLabel="Histogram of delivery percent across stocks" />
          )}
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {fmtInt(rows.length)} stocks in 5-point bins; dashed line is the median ({fmtPct(med)}). Follows
            the global filters; ETFs excluded.
          </p>
        </Section>
        <Section title="Delivery % vs price change">
          {daily.loading ? (
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
        </Section>
      </div>
      <Section title={`Delivery value by sector, ${fmtDate(date)}`}>
        {sectors.length === 0 ? (
          <Empty>No data for this date.</Empty>
        ) : (
          <EChart
            option={bars}
            height={Math.max(300, sectors.length * 24 + 70)}
            ariaLabel="Delivery value by sector"
          />
        )}
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Bars: delivery value. Dots: today&rsquo;s value-weighted delivery % minus its prior 20-day average,
          in percentage points. Stocks only.
        </p>
      </Section>
      <Section title="Cap buckets" label="Cap-bucket comparison">
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[520px] text-sm">
            <thead className="text-xs text-slate-500">
              <tr className="text-right">
                <th className="py-1 text-left font-medium">Bucket</th>
                <th className="font-medium">Delivery %</th>
                <th className="font-medium">vs 20D avg</th>
                <th className="font-medium">Median stock</th>
                <th className="font-medium">Turnover</th>
                <th className="font-medium">Adv / Dec</th>
                <th className="font-medium">Spikes ≥ 2×</th>
              </tr>
            </thead>
            <tbody>
              {caps.map(({ b, g, now, avg }) => (
                <tr key={b} className="border-t border-slate-100 text-right dark:border-slate-800">
                  <td className="py-1 text-left">{CAP_NAME[b]} caps</td>
                  <td>{fmtPct(now)}</td>
                  <td>{now !== null && avg !== null ? fmtPp(now - avg) : '—'}</td>
                  <td>{fmtPct(g?.medianDelivPct[di] ?? null)}</td>
                  <td>{fmtCr(g?.turnoverCr[di] ?? null)}</td>
                  <td>
                    {fmtInt(g?.adv[di] ?? null)} / {fmtInt(g?.dec[di] ?? null)}
                  </td>
                  <td>{fmtInt(g?.spikeCount2x[di] ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <td className="px-2 text-right text-slate-400" title="Fewer than 30 observations">
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-slate-500">
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

export default function Stats() {
  const market = useMarket();
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Market Statistics</h1>
      {market.error ? (
        <ErrorBox message={market.error} />
      ) : !market.data ? (
        <>
          <Skeleton height={340} />
          <Skeleton height={280} />
        </>
      ) : (
        <>
          <Trend market={market.data} />
          <DayCharts market={market.data} />
        </>
      )}
      <SignalPerfTable />
    </div>
  );
}
