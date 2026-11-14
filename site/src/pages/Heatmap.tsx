import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import EChart from '../charts/EChart';
import { calendarOption } from '../charts/options';
import { gridOption, treemapOption, type GridData } from '../charts/phase3';
import { divergeColor, palette, type Palette } from '../charts/theme';
import RangeControls from '../components/RangeControls';
import { Empty, ErrorBox, Skeleton } from '../components/ui';
import { dataClient } from '../lib/dataClient';
import { applyFilters, applyRangeFilters } from '../lib/filters';
import { useApp, useDaily, useGlobalState, useMarket, useSymbol } from '../lib/hooks';
import {
  buildTree,
  COLOR_METRICS,
  gridDeviation,
  SIZE_METRICS,
  type ColorMetric,
  type HeatItem,
  type SizeMetric,
} from '../lib/heat';
import { useDark } from '../lib/theme';
import { useRangeRows, useRangeState } from '../lib/useRange';
import { useWatchlist } from '../lib/watchlist';
import { fmtDate } from '../lib/format';

type Tab = 'tree' | 'grid' | 'cal';
const TABS: { id: Tab; label: string }[] = [
  { id: 'tree', label: 'Treemap' },
  { id: 'grid', label: 'Grid (group × day)' },
  { id: 'cal', label: 'Calendar' },
];

function useMobile(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
}

/** Gradient legend with numeric ticks for the diverging scale. */
export function ScaleLegend({ metric, p }: { metric: ColorMetric; p: Palette }) {
  const m = COLOR_METRICS.find((x) => x.id === metric)!;
  const stops = [-1, -0.5, 0, 0.5, 1].map((t) => divergeColor(t, p)).join(',');
  return (
    <div className="max-w-sm text-xs text-slate-600 dark:text-slate-300">
      <div>{m.legend}</div>
      <div className="h-3 rounded" style={{ background: `linear-gradient(90deg,${stops})` }} />
      <div className="num flex justify-between">
        {m.ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function Treemap({ range }: { range: boolean }) {
  const { meta, bySym } = useApp();
  const { filters, date } = useGlobalState();
  const watch = useWatchlist();
  const nav = useNavigate();
  const dark = useDark();
  const [params, setParams] = useSearchParams();
  const state = useRangeState();
  const daily = useDaily(range ? null : date, meta.latestDate);
  const rng = useRangeRows(state.resolved, range);
  const size = (
    SIZE_METRICS.some((s) => s.id === params.get('sz')) ? params.get('sz') : 'turnover'
  ) as SizeMetric;
  const color = (
    COLOR_METRICS.some((s) => s.id === params.get('co')) ? params.get('co') : 'spike'
  ) as ColorMetric;
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };
  const ctx = useMemo(() => ({ indices: meta.indices, watchlist: new Set(watch) }), [meta.indices, watch]);
  // ETFs would dominate the "Unclassified" sector, so the treemap always shows stocks only
  const f = useMemo(() => ({ ...filters, hideEtfs: true }), [filters]);

  const items: HeatItem[] = useMemo(() => {
    const out: HeatItem[] = [];
    if (!range) {
      for (const r of applyFilters(daily.data ?? [], bySym, f, ctx)) {
        const u = bySym.get(r.sym)!;
        const sz = size === 'turnover' ? r.turnoverCr : size === 'mcap' ? u.mcapCr : r.delivValCr;
        const value = color === 'spike' ? r.spike : color === 'diff' ? r.delivPctDiff : r.ret1;
        if (sz === null || sz <= 0) continue;
        out.push({
          sym: r.sym,
          name: u.name,
          sector: u.sector,
          size: sz,
          value,
          dp: r.delivPct,
          dpAvg: r.delivPctAvg20,
          spike: r.spike,
          ret: r.ret1,
        });
      }
    } else {
      for (const r of applyRangeFilters(rng.data ?? [], bySym, f, ctx)) {
        if (r.excluded) continue;
        const sz = size === 'turnover' ? r.avgTurnoverR : size === 'mcap' ? r.mcapCr : r.avgDelivValR;
        const ratio = r.delivValChgPct === null ? null : 1 + r.delivValChgPct / 100;
        const value = color === 'spike' ? ratio : color === 'diff' ? r.delivPctChgPp : r.ret;
        if (sz === null || sz <= 0) continue;
        out.push({
          sym: r.sym,
          name: r.name,
          sector: r.sector,
          size: sz,
          value,
          dp: r.delivPctWR,
          dpAvg: r.delivPctWB,
          spike: ratio,
          ret: r.ret,
        });
      }
    }
    return out;
  }, [range, daily.data, rng.data, bySym, f, ctx, size, color]);

  const pal = palette(dark);
  const tree = useMemo(() => buildTree(items, color), [items, color]);
  const option = useMemo(() => treemapOption(tree, pal), [tree, pal]);
  const mobile = useMobile();
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const start = performance.now();
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setMs(Math.round(performance.now() - start))),
    );
    return () => cancelAnimationFrame(id);
  }, [option]);

  const loading = range ? rng.loading : daily.loading;
  const error = range ? rng.error : daily.error;
  return (
    <div className="space-y-2">
      {range && <RangeControls state={state} />}
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-slate-500">Size</span>
          <select
            aria-label="Size by"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
            value={size}
            onChange={(e) => set('sz', e.target.value === 'turnover' ? null : e.target.value)}
          >
            {SIZE_METRICS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-slate-500">Colour</span>
          <select
            aria-label="Colour by"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
            value={color}
            onChange={(e) => set('co', e.target.value === 'spike' ? null : e.target.value)}
          >
            {COLOR_METRICS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <ScaleLegend metric={color} p={pal} />
      </div>
      {error ? (
        <ErrorBox message={error} />
      ) : loading ? (
        <Skeleton height={mobile ? 460 : 620} />
      ) : tree.length === 0 ? (
        <Empty>No stocks match the current filters.</Empty>
      ) : (
        <EChart
          option={option}
          height={mobile ? 460 : 620}
          ariaLabel="Treemap of stocks grouped by sector"
          onItemClick={(d) => {
            const sym = (d as { sym?: string } | undefined)?.sym;
            if (sym) nav(`/stock/${encodeURIComponent(sym)}`);
          }}
        />
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="tree-ms">
        {items.length.toLocaleString('en-IN')} stocks{ms !== null ? `, drawn in ${ms} ms` : ''}. Tap a sector
        to zoom in, tap a stock to open it. ETFs are not shown.{' '}
        {range ? 'Range mode: colour compares the range with its baseline.' : ''}
      </p>
    </div>
  );
}

type RowMode = 'sector' | 'index' | 'cap' | 'stocks';

function useStockHistories(syms: readonly string[], enabled: boolean) {
  const { bySym } = useApp();
  const [map, setMap] = useState<Map<string, { date: string; spike: number | null }[]>>(new Map());
  const key = enabled ? syms.join('|') : '';
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const todo = syms.slice(0, 50);
    let next = 0;
    const worker = async () => {
      while (live && next < todo.length) {
        const sym = todo[next++]!;
        const u = bySym.get(sym);
        if (!u) continue;
        try {
          const { rows } = await dataClient.symbol(u.f);
          if (live)
            setMap((m) =>
              new Map(m).set(
                sym,
                rows.map((r) => ({ date: r.date, spike: r.spike })),
              ),
            );
        } catch {
          /* a missing symbol file leaves its row empty */
        }
      }
    };
    void Promise.all(Array.from({ length: 6 }, worker)); // at most 6 requests at a time
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, bySym]);
  return map;
}

function GridTab() {
  const { meta, universe } = useApp();
  const { filters } = useGlobalState();
  const market = useMarket();
  const dark = useDark();
  const [params, setParams] = useSearchParams();
  const mobile = useMobile();
  const win = params.get('gw') === '60' ? 60 : 20;
  const bit = filters.u !== 'ALL' && filters.u !== 'WATCHLIST' ? meta.indices.indexOf(filters.u) : -1;
  const members = useMemo(
    () => (bit >= 0 ? universe.filter((u) => (u.idx & (2 ** bit)) !== 0 && !u.etf).map((u) => u.sym) : []),
    [bit, universe],
  );
  const stocksOk = bit >= 0 && members.length <= 50;
  const requested = (params.get('gr') ?? 'sector') as RowMode;
  const mode: RowMode = requested === 'stocks' && !stocksOk ? 'sector' : requested;
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };
  const hist = useStockHistories(members, mode === 'stocks');

  const data: GridData | null = useMemo(() => {
    if (mode === 'stocks') {
      const dates = meta.tradingDays.slice(-win);
      const di = new Map(dates.map((d, i) => [d, i]));
      const rows = members.filter((s) => hist.has(s));
      const cells: GridData['cells'] = [];
      rows.forEach((sym, yi) => {
        const byDate = new Map(hist.get(sym)!.map((r) => [r.date, r.spike]));
        for (const d of dates) cells.push([di.get(d)!, yi, byDate.get(d) ?? null]);
      });
      return { rows, dates, cells };
    }
    const m = market.data;
    if (!m) return null;
    const prefix = mode === 'sector' ? 'SEC:' : mode === 'index' ? 'IDX:' : 'MC:';
    const keys = Object.keys(m.groups).filter((k) => k.startsWith(prefix));
    const from = Math.max(0, m.dates.length - win);
    const dates = m.dates.slice(from);
    const cells: GridData['cells'] = [];
    const names = keys.map((k) => k.slice(prefix.length));
    keys.forEach((k, yi) => {
      gridDeviation(m.groups[k]!.delivPctW, from, 60).forEach((v, xi) => cells.push([xi, yi, v]));
    });
    return { rows: names, dates, cells };
  }, [mode, market.data, win, meta.tradingDays, members, hist]);

  const pp = mode !== 'stocks';
  const option = useMemo(
    () => (data ? gridOption(data, palette(dark), 5, pp ? 'pp' : 'x', mobile) : null),
    [data, dark, pp, mobile],
  );
  const h = data ? Math.max(260, data.rows.length * (mode === 'stocks' ? 18 : 24) + 90) : 300;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div role="group" aria-label="Rows" className="flex flex-wrap gap-1">
          {(['sector', 'index', 'cap', ...(stocksOk ? ['stocks'] : [])] as RowMode[]).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={mode === r}
              className={`chip ${mode === r ? 'bg-blue-600 text-white' : ''}`}
              onClick={() => set('gr', r === 'sector' ? null : r)}
            >
              {r === 'sector'
                ? 'Sectors'
                : r === 'index'
                  ? 'Indices'
                  : r === 'cap'
                    ? 'Cap buckets'
                    : 'Stocks'}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Days" className="flex gap-1">
          {[20, 60].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={win === n}
              className={`chip ${win === n ? 'bg-blue-600 text-white' : ''}`}
              onClick={() => set('gw', n === 20 ? null : String(n))}
            >
              {n} days
            </button>
          ))}
        </div>
      </div>
      {market.error ? (
        <ErrorBox message={market.error} />
      ) : !option ? (
        <Skeleton height={h} />
      ) : data!.rows.length === 0 ? (
        <Empty>{mode === 'stocks' ? 'Loading stock histories…' : 'No groups.'}</Empty>
      ) : (
        <EChart option={option} height={h} ariaLabel="Heat grid of groups by day" />
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {pp
          ? 'Colour is the group’s value-weighted delivery % minus its own 60-day mean, in percentage points (blue above, orange below). Groups are stocks only; ETFs are excluded.'
          : 'Colour is each stock’s delivery spike (delivery value vs its prior 20-day average, log scale).'}{' '}
        {!stocksOk && 'Pick an index with 50 or fewer stocks in the filters to get a per-stock view.'}
      </p>
    </div>
  );
}

function CalendarTab() {
  const { universe, bySym } = useApp();
  const dark = useDark();
  const [params, setParams] = useSearchParams();
  const sym = (params.get('cs') ?? 'RELIANCE').toUpperCase();
  const u = bySym.get(sym) ?? null;
  const [text, setText] = useState(sym);
  const data = useSymbol(u ? u.f : null);
  const option = useMemo(
    () => (data.data ? calendarOption(data.data.rows, palette(dark)) : null),
    [data.data, dark],
  );
  const pick = (v: string) => {
    setText(v);
    const s = v.trim().toUpperCase();
    if (bySym.has(s)) {
      const n = new URLSearchParams(params);
      n.set('cs', s);
      setParams(n, { replace: true });
    }
  };
  return (
    <div className="space-y-2">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Stock
        <input
          list="cal-syms"
          aria-label="Stock symbol"
          value={text}
          onChange={(e) => pick(e.target.value)}
          className="w-44 rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
        />
        <datalist id="cal-syms">
          {universe.slice(0, 3000).map((x) => (
            <option key={x.sym} value={x.sym} />
          ))}
        </datalist>
        {u && <span className="text-slate-500">{u.name}</span>}
      </label>
      {!u ? (
        <Empty>Pick a symbol from the list.</Empty>
      ) : data.error ? (
        <ErrorBox message={data.error} />
      ) : !option ? (
        <Skeleton height={230} />
      ) : (
        <div className="card overflow-x-auto p-3">
          <div style={{ minWidth: 860 }}>
            <EChart
              option={option}
              height={230}
              ariaLabel={`Calendar heat map of ${u.sym} delivery percent`}
            />
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Delivery % per trading day over the stored year.
      </p>
    </div>
  );
}

export default function Heatmap() {
  const { meta } = useApp();
  const { date } = useGlobalState();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('t')) ? params.get('t') : 'tree') as Tab;
  const range = tab === 'tree' && params.get('rng') === '1';
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Heatmaps</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {fmtDate(range ? meta.latestDate : date)}
        </p>
      </div>
      <div role="tablist" aria-label="Heatmap type" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`chip ${tab === t.id ? 'bg-blue-600 text-white' : ''}`}
            onClick={() => set('t', t.id === 'tree' ? null : t.id)}
          >
            {t.label}
          </button>
        ))}
        {tab === 'tree' && (
          <span role="group" aria-label="Mode" className="ml-2 flex gap-1">
            {(['Day', 'Range'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={range === (m === 'Range')}
                className={`chip ${range === (m === 'Range') ? 'bg-blue-600 text-white' : ''}`}
                onClick={() => set('rng', m === 'Range' ? '1' : null)}
              >
                {m}
              </button>
            ))}
          </span>
        )}
      </div>
      {tab === 'tree' && <Treemap range={range} />}
      {tab === 'grid' && <GridTab />}
      {tab === 'cal' && <CalendarTab />}
    </div>
  );
}
