import type { SortingState } from '@tanstack/react-table';
import type { DailyRow } from '../types/data';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DataTable, { type ExtraColumn } from '../components/DataTable';
import { Empty, ErrorBox, PRIMARY_BTN, Skeleton, Sparkline, TrailButton } from '../components/ui';
import RangeControls from '../components/RangeControls';
import {
  COLS_KEY,
  COLUMNS,
  COLUMN_BY_KEY,
  DEFAULT_COLUMNS,
  PERIOD_ONLY_COLUMNS,
  OLD_COLS_KEY,
  migrateColumns,
  toCsv,
  type ColumnSpec,
  type ScreenRow,
} from '../lib/columns';
import { DEFAULT_RANGE_COLUMNS, RANGE_COLUMNS, RANGE_COLUMN_BY_KEY } from '../lib/rangeColumns';
import { applyFilters, applyRangeFilters } from '../lib/filters';
import { useRangeRows, useRangeState } from '../lib/useRange';
import { resolveRange, type RangeScreenRow } from '../lib/range';
import { PERF_DISCLAIMER, historyLine, periodHistoryLine, periodSignalHistory } from '../lib/signalPerf';
import { PERIOD_MISSING, periodRowToDaily } from '../lib/periodAdapter';
import { partialText } from '../lib/aggregate';
import { periodFor, periodLabel, periodsOf, tfToRangeSpec } from '../lib/timeframe';
import {
  PERIOD_DEFAULT_COLUMNS,
  PERIOD_PRESET_EVENT,
  WATCH_NOTE,
  dayColumnList,
  isSlimDay,
  labelIn,
  periodColumnList,
  presetReason,
  registryOf,
  screenerView,
  slimMissingKeys,
  slimReason,
  watchParams,
  PERIOD_MISSING_REASON,
  type WatchTf,
} from '../lib/screenerTf';
import { dataClient } from '../lib/dataClient';
import { fmtDate } from '../lib/format';
import {
  saveLastFilters,
  useApp,
  useAsync,
  useDaily,
  useHoldingsLatest,
  useGlobalState,
  usePeriodSnapshot,
  useSignalPerf,
  useTimeframe,
} from '../lib/hooks';
import { PRESET_BY_ID, PRESET_EVENT, PRESET_GROUPS, runPreset } from '../lib/presets';
import {
  NO_OWNERSHIP,
  OWNERSHIP_BY_ID,
  OWNERSHIP_PRESETS,
  ownershipBySym,
  runOwnershipPreset,
  type OwnershipPreset,
} from '../lib/ownership';
import { parseFilters } from '../lib/urlState';
import { readJson, writeJson } from '../lib/storage';
import { useWatchlist } from '../lib/watchlist';

const RANGE_COLS_KEY = 'dv.cols.range';

function parseSort(s: string | null, has: (id: string) => boolean): SortingState | null {
  if (!s) return null;
  const out = s
    .split(',')
    .map((p) => p.split(':'))
    .filter(([id]) => id && has(id))
    .map(([id, d]) => ({ id: id as string, desc: d !== 'a' }));
  return out.length ? out : null;
}

const serializeSort = (s: SortingState) => s.map((x) => `${x.id}:${x.desc ? 'd' : 'a'}`).join(',');

function validCols(saved: unknown, has: (k: string) => boolean): string[] | null {
  return Array.isArray(saved) && saved.length > 0 && saved.every((x) => typeof x === 'string' && has(x))
    ? (saved as string[])
    : null;
}

/** Saved column set: key dv.cols.v2. A set saved under the old key gets the new price columns merged in, once. */
function useColumns(): [string[], (c: string[]) => void] {
  const [cols, setCols] = useState<string[]>(() => {
    const v2 = validCols(readJson<unknown>(COLS_KEY, null), (k) => COLUMN_BY_KEY.has(k));
    if (v2) return v2;
    const old = validCols(readJson<unknown>(OLD_COLS_KEY, null), (k) => COLUMN_BY_KEY.has(k));
    if (!old) return DEFAULT_COLUMNS;
    const merged = migrateColumns(old);
    writeJson(COLS_KEY, merged);
    return merged;
  });
  return [
    cols,
    (c) => {
      setCols(c);
      writeJson(COLS_KEY, c);
    },
  ];
}

function usePersistedColumns(
  key: string,
  has: (k: string) => boolean,
  fallback: string[],
): [string[], (c: string[]) => void] {
  const [cols, setCols] = useState<string[]>(() => validCols(readJson<unknown>(key, null), has) ?? fallback);
  return [
    cols,
    (c) => {
      setCols(c);
      writeJson(key, c);
    },
  ];
}

const PERIOD_ONLY_KEYS = new Set(PERIOD_ONLY_COLUMNS.map((c) => c.key as string));
const hasPeriodCol = (k: string) => COLUMN_BY_KEY.has(k) || PERIOD_ONLY_KEYS.has(k);
const hasRangeCol = (k: string) => RANGE_COLUMN_BY_KEY.has(k);
const PERIOD_COLS_KEY = 'dv.cols.period';

function useSparks(syms: readonly string[], enabled: boolean): Map<string, (number | null)[]> {
  const { bySym } = useApp();
  const [map, setMap] = useState<Map<string, (number | null)[]>>(new Map());
  const key = syms.join('|');
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
          const vals = rows.slice(-20).map((r) => r.delivPct);
          if (live) setMap((m) => new Map(m).set(sym, vals));
        } catch {
          /* a missing symbol file only leaves its sparkline empty */
        }
      }
    };
    void Promise.all(Array.from({ length: 6 }, worker));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, bySym]);
  return map;
}

function PresetHistory({ id, line }: { id: string; line: string }) {
  return (
    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid={`history-${id}`}>
      {line}
    </p>
  );
}

const RANKING_LINE = 'Historically: a ranking, not an event, so no follow-through is measured.';
const LOADING_LINE = 'Historically: loading the weekly and monthly history.';

export default function Screener({ mode = 'screener' }: { mode?: 'screener' | 'watchlist' }) {
  const { meta, bySym } = useApp();
  const { filters, defaults, date, activeCount } = useGlobalState();
  const { state: tfState } = useTimeframe();
  const watch = useWatchlist();
  const [params, setParams] = useSearchParams();
  const watchlistMode = mode === 'watchlist';
  const view = screenerView(tfState.tf, params.get('rng') === '1', watchlistMode);
  const rangeish = view === 'range' || view === 'rangeTf';
  const periodTf = view === 'period' ? (tfState.tf as 'w' | 'm') : null;

  const periods = useAsync(view === 'period' || tfState.tf === 'q' ? 'periods' : null, () =>
    dataClient.periods(),
  );
  const info = periodTf && periods.data ? periodFor(periodsOf(periods.data, periodTf), date) : null;
  const snap = usePeriodSnapshot(periodTf ?? 'w', info);
  const daily = useDaily(view === 'day' ? date : null, meta.latestDate);
  // Ownership (Phase 4B): the latest shareholding filing per stock, joined onto the day rows
  const holdings = useHoldingsLatest(view === 'day');
  const ownMap = useMemo(() => (holdings.data ? ownershipBySym(holdings.data) : null), [holdings.data]);

  const legacyRange = useRangeState();
  const tfSpec = useMemo(
    () =>
      view === 'rangeTf'
        ? tfToRangeSpec(tfState, date, meta.tradingDays, periods.data?.quarterly ?? [])
        : null,
    [view, tfState, date, meta.tradingDays, periods.data],
  );
  const tfResolved = useMemo(
    () => (tfSpec ? resolveRange(tfSpec, date, meta.tradingDays) : null),
    [tfSpec, date, meta.tradingDays],
  );
  const resolved = view === 'rangeTf' ? tfResolved : legacyRange.resolved;
  const rangeRows = useRangeRows(resolved ?? legacyRange.resolved, rangeish && resolved !== null);

  const perf = useSignalPerf();
  const periodPerf = useAsync(view === 'period' ? 'signalPerfPeriods' : null, () =>
    dataClient.signalPerfPeriods(),
  );
  const [dayCols, setDayCols] = useColumns();
  const [periodCols, setPeriodCols] = usePersistedColumns(
    PERIOD_COLS_KEY,
    hasPeriodCol,
    PERIOD_DEFAULT_COLUMNS,
  );
  const [rangeCols, setRangeCols] = usePersistedColumns(RANGE_COLS_KEY, hasRangeCol, DEFAULT_RANGE_COLUMNS);
  const [chooser, setChooser] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const cols = rangeish ? rangeCols : view === 'period' ? periodCols : dayCols;
  const setCols = rangeish ? setRangeCols : view === 'period' ? setPeriodCols : setDayCols;
  const showExcluded = params.get('ex') === '1';

  // slim days: columns a day before dailyFullFrom does not carry
  const slim = view === 'day' && isSlimDay(date, meta.publish);
  const slimMissing = useMemo(() => slimMissingKeys(meta.publish), [meta.publish]);
  const slimWhy = slimReason(meta.publish.dailyFullFrom);
  const periodWindows = useMemo(() => {
    const c = periods.data?.config.periods[periodTf ?? 'w'];
    const m = periodTf === 'm';
    return { base: c?.base ?? (m ? 6 : 10), long: c?.long ?? (m ? 24 : 52) };
  }, [periods.data, periodTf]);
  const columnList = useMemo(
    () =>
      view === 'period' && periodTf
        ? periodColumnList(periodTf, periodWindows)
        : slim
          ? dayColumnList(slimMissing, slimWhy)
          : COLUMNS,
    [view, periodTf, periodWindows, slim, slimMissing, slimWhy],
  );
  const dayRegistry = useMemo(() => registryOf(columnList), [columnList]);
  const chooserList = (rangeish ? RANGE_COLUMNS : columnList) as readonly {
    key: string;
    label: string;
    tip: string;
  }[];
  const defaultCols = rangeish
    ? DEFAULT_RANGE_COLUMNS
    : view === 'period'
      ? PERIOD_DEFAULT_COLUMNS
      : DEFAULT_COLUMNS;

  // presets that need columns the data does not carry are disabled with a reason
  const presetMissing = useMemo<ReadonlySet<string>>(
    () =>
      view === 'period'
        ? new Set<string>(PERIOD_MISSING as readonly string[])
        : slim
          ? slimMissing
          : new Set<string>(),
    [view, slim, slimMissing],
  );
  const labelOf = useMemo(() => labelIn(COLUMNS), []);
  const reasonOf = (id: string) =>
    presetReason(id, presetMissing, labelOf, view === 'period' ? PERIOD_MISSING_REASON : slimWhy);

  const presetId = params.get('p');
  const presetAny =
    presetId && (view === 'day' || view === 'period') ? PRESET_BY_ID.get(presetId) : undefined;
  const blockedReason = presetAny ? reasonOf(presetAny.id) : null;
  const preset = presetAny && !blockedReason ? presetAny : undefined;
  // ownership presets: day view only (the filings are quarterly)
  const ownPreset: OwnershipPreset | undefined =
    presetId && view === 'day' ? OWNERSHIP_BY_ID.get(presetId) : undefined;
  const q = params.get('q') ?? '';
  const explicit = parseSort(params.get('s'), (id) =>
    rangeish ? RANGE_COLUMN_BY_KEY.has(id) : dayRegistry.has(id),
  );
  const sorting: SortingState =
    explicit ??
    (rangeish
      ? [{ id: 'delivValChgPct', desc: true }]
      : preset
        ? [{ id: preset.sort as string, desc: preset.dir === 'desc' }]
        : ownPreset
          ? [{ id: ownPreset.sort as string, desc: ownPreset.dir === 'desc' }]
          : [{ id: 'delivValCr', desc: true }]);

  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k === 'rng') n.delete('s');
    setParams(n, { replace: k === 'q' });
  };

  const needle = q.trim().toLowerCase();
  const ctx = useMemo(() => ({ indices: meta.indices, watchlist: new Set(watch) }), [meta.indices, watch]);
  const periodRows = useMemo(() => snap.data?.rows.map(periodRowToDaily) ?? null, [snap.data]);
  const source: DailyRow[] | null = view === 'day' ? daily.data : view === 'period' ? periodRows : null;
  const rows: ScreenRow[] = useMemo(() => {
    if (!source) return [];
    const eff = watchlistMode ? { ...filters, u: 'WATCHLIST' } : filters;
    let list = applyFilters(source, bySym, eff, ctx);
    if (preset) list = runPreset(preset, list, bySym);
    const joined: ScreenRow[] = list.map((r) => {
      const u = bySym.get(r.sym)!;
      return {
        ...r,
        name: u.name,
        sector: u.sector,
        mcapCr: u.mcapCr,
        bucket: u.bucket,
        chg:
          r.close !== null && r.prevClose !== null ? Math.round((r.close - r.prevClose) * 100) / 100 : null,
        ...(ownMap?.get(r.sym) ?? NO_OWNERSHIP),
      };
    });
    const ranked = ownPreset ? runOwnershipPreset(ownPreset, joined) : joined;
    return ranked.filter(
      (r) => !needle || r.sym.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle),
    );
  }, [source, filters, bySym, ctx, preset, ownPreset, ownMap, needle, watchlistMode]);

  const rRows: RangeScreenRow[] = useMemo(() => {
    if (!rangeRows.data || !rangeish) return [];
    return applyRangeFilters(rangeRows.data, bySym, filters, ctx).filter(
      (r) =>
        (showExcluded || !r.excluded) &&
        (!needle || r.sym.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)),
    );
  }, [rangeRows.data, rangeish, bySym, filters, ctx, showExcluded, needle]);

  const sparks = useSparks(watchlistMode ? rows.map((r) => r.sym) : [], watchlistMode);
  const extra: ExtraColumn[] = useMemo(
    () =>
      watchlistMode
        ? [
            {
              id: 'spark',
              label: 'Deliv % 20D',
              tip: 'Delivery % over the last 20 trading days',
              width: 110,
              render: (r) => (
                <Sparkline
                  values={sparks.get(r.sym) ?? []}
                  width={90}
                  label={`${r.sym} delivery % over 20 days`}
                />
              ),
            },
          ]
        : [],
    [watchlistMode, sparks],
  );

  const range = resolved?.range;
  const download = () => {
    const registry = (rangeish ? RANGE_COLUMN_BY_KEY : dayRegistry) as unknown as ReadonlyMap<
      string,
      ColumnSpec<Record<string, unknown>>
    >;
    const specs = cols.map((c) => registry.get(c)!).filter(Boolean);
    const sorted = [...(rangeish ? rRows : rows)] as unknown as Record<string, unknown>[];
    const [s0] = sorting;
    if (s0) {
      sorted.sort((a, b) => {
        const x = a[s0.id] as number | string | null | undefined;
        const y = b[s0.id] as number | string | null | undefined;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const c = x < y ? -1 : x > y ? 1 : 0;
        return s0.desc ? -c : c;
      });
    }
    const blob = new Blob([toCsv(sorted, specs)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = rangeish
      ? `delivery-range-${range?.a ?? 'x'}_${range?.b ?? 'x'}.csv`
      : view === 'period'
        ? `delivery-${periodTf === 'w' ? 'weekly' : 'monthly'}-${info?.key ?? date}.csv`
        : `delivery-${watchlistMode ? 'watchlist' : 'screener'}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const applyWatch = (tf: WatchTf) => {
    const next = watchParams(params, defaults.minTurn, tf);
    saveLastFilters(parseFilters(next, defaults.minTurn, meta.indices), defaults.minTurn);
    setParams(next);
  };

  const count = rangeish ? rRows.length : rows.length;
  const active: { error: string | null; loading: boolean } = rangeish
    ? {
        error: rangeRows.error ?? periods.error,
        loading: resolved ? rangeRows.loading : periods.loading,
      }
    : view === 'period'
      ? { error: periods.error ?? snap.error, loading: periods.loading || snap.loading }
      : daily;
  const onSort = (u: SortingState | ((o: SortingState) => SortingState)) => {
    const next = typeof u === 'function' ? u(sorting) : u;
    setParam('s', next.length ? serializeSort(next) : null);
  };

  const presetLine = (id: string): string => {
    if (view === 'period' && periodTf) {
      const m = PERIOD_PRESET_EVENT[id];
      if (!m) return RANKING_LINE;
      return periodHistoryLine(periodPerf.data, periodTf, m.event, m.group ?? 'ALL') ?? LOADING_LINE;
    }
    const m = PRESET_EVENT[id];
    const line = m ? historyLine(perf.data, m.event, m.group ?? 'ALL') : undefined;
    return line ?? (m ? 'Historically: not enough history for this list yet.' : RANKING_LINE);
  };

  const ownershipBlock = (p: OwnershipPreset) => {
    const on = ownPreset?.id === p.id;
    const why = view === 'day' ? null : 'Shareholding is quarterly, so this list is shown in the day view.';
    return (
      <div key={p.id} className="min-w-0">
        <button
          type="button"
          aria-pressed={on}
          disabled={why !== null}
          title={why ?? undefined}
          className={`chip whitespace-nowrap ${on ? 'bg-blue-600 text-white' : ''} ${why ? 'cursor-not-allowed opacity-50' : ''}`}
          onClick={() => {
            const n = new URLSearchParams(params);
            n.set('p', p.id);
            n.delete('s');
            setParams(n);
          }}
        >
          {p.label}
        </button>
        {why ? (
          <p
            className="mt-0.5 text-xs text-amber-700 dark:text-amber-400"
            data-testid={`unavailable-${p.id}`}
          >
            Not available here. {why}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid={`history-${p.id}`}>
            {p.explain}
          </p>
        )}
      </div>
    );
  };

  const presetBlock = (id: string) => {
    const p = PRESET_BY_ID.get(id);
    if (!p) return null;
    const on = preset?.id === id;
    const why = reasonOf(id);
    return (
      <div key={id} className="min-w-0">
        <button
          type="button"
          aria-pressed={on}
          disabled={why !== null}
          title={why ?? undefined}
          className={`chip whitespace-nowrap ${on ? 'bg-blue-600 text-white' : ''} ${why ? 'cursor-not-allowed opacity-50' : ''}`}
          onClick={() => {
            const n = new URLSearchParams(params);
            n.set('p', id);
            n.delete('s');
            setParams(n);
          }}
        >
          {p.label}
        </button>
        {why ? (
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400" data-testid={`unavailable-${id}`}>
            Not available here. {why}
          </p>
        ) : (
          <PresetHistory id={id} line={presetLine(id)} />
        )}
      </div>
    );
  };

  const periodHeader =
    view === 'period' && periodTf && info
      ? `${periodLabel(periodTf, info)}${info.partial ? ` · ${partialText(info)}` : ''}`
      : null;
  const quarter = tfState.tf === 'q' && periods.data ? periodFor(periods.data.quarterly, date) : null;
  const rangeLead =
    tfState.tf === 'q'
      ? quarter
        ? `${periodLabel('q', quarter)}${quarter.partial ? `, ${partialText(quarter)}` : ''}. `
        : ''
      : tfState.tf === 'c'
        ? `Last ${tfState.n} trading days against the ${tfState.n} before. `
        : tfState.tf === 'r'
          ? 'Custom range. '
          : '';
  const watchTf: WatchTf = view === 'period' ? (tfState.tf as 'w' | 'm') : 'd';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{watchlistMode ? 'Watchlist' : 'Screener'}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="screener-heading">
          {rangeish
            ? range
              ? `${fmtDate(range.a)} to ${fmtDate(range.b)}`
              : 'No range set'
            : (periodHeader ?? fmtDate(date))}{' '}
          &middot; {count.toLocaleString('en-IN')} stocks
          {activeCount > 0 ? ` (${activeCount} filter${activeCount > 1 ? 's' : ''} active)` : ''}
        </p>
      </div>

      {!watchlistMode && tfState.tf === 'd' && (
        <div role="group" aria-label="Mode" className="flex gap-1">
          <button
            type="button"
            aria-pressed={view !== 'range'}
            className={`chip ${view !== 'range' ? 'bg-blue-600 text-white' : ''}`}
            onClick={() => setParam('rng', null)}
          >
            Day
          </button>
          <button
            type="button"
            aria-pressed={view === 'range'}
            className={`chip ${view === 'range' ? 'bg-blue-600 text-white' : ''}`}
            onClick={() => setParam('rng', '1')}
          >
            Range
          </button>
        </div>
      )}

      {view === 'range' && <RangeControls state={legacyRange} />}

      {view === 'rangeTf' && (
        <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="range-words">
          {resolved
            ? `${rangeLead}${resolved.text}.`
            : tfState.tf === 'r'
              ? 'Pick a start and end date in the timeframe control to compute a custom range.'
              : 'Loading the range.'}
        </p>
      )}

      {slim && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="slim-note">
          {fmtDate(date)} is before {fmtDate(meta.publish.dailyFullFrom)}: only the slim column set is
          published for this day. Other columns show a dash.
        </p>
      )}

      {!watchlistMode && view !== 'range' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            {(['d', 'w', 'm'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={PRIMARY_BTN}
                onClick={() => applyWatch(t)}
                data-testid={`${t === 'd' ? 'daily' : t === 'w' ? 'weekly' : 'monthly'}-watch`}
              >
                {t === 'd' ? 'Daily' : t === 'w' ? 'Weekly' : 'Monthly'} delivery watch
              </button>
            ))}
            <TrailButton />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">{WATCH_NOTE[watchTf]}</p>
          {view !== 'rangeTf' && (
            <div role="group" aria-label="Presets" className="space-y-2">
              <button
                type="button"
                className={`chip ${!preset ? 'bg-blue-600 text-white' : ''}`}
                onClick={() => setParam('p', null)}
              >
                All stocks
              </button>
              {blockedReason && presetAny && (
                <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="blocked-preset">
                  The list &ldquo;{presetAny.label}&rdquo; is not available here, so all stocks are shown.{' '}
                  {blockedReason}
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-3">
                {PRESET_GROUPS.filter((g) => !g.collapsed).map((g) => (
                  <div key={g.id} role="group" aria-label={g.label} className="min-w-0 space-y-1.5">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {g.label}
                    </h2>
                    {g.ids.map(presetBlock)}
                  </div>
                ))}
              </div>
              {PRESET_GROUPS.filter((g) => g.collapsed).map((g) => {
                const open = moreOpen || (!!preset && g.ids.includes(preset.id));
                return (
                  <div key={g.id} role="group" aria-label={g.label}>
                    <button
                      type="button"
                      className="text-xs font-semibold uppercase tracking-wide text-slate-500 underline dark:text-slate-400"
                      aria-expanded={open}
                      onClick={() => setMoreOpen((o) => !o)}
                    >
                      {g.label} {open ? '▾' : '▸'}
                    </button>
                    {open && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">{g.ids.map(presetBlock)}</div>
                    )}
                  </div>
                );
              })}
              <div role="group" aria-label="Ownership (quarterly filings)" className="min-w-0 space-y-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Ownership (quarterly filings)
                </h2>
                <div className="grid gap-3 md:grid-cols-3">{OWNERSHIP_PRESETS.map(ownershipBlock)}</div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{PERF_DISCLAIMER}</p>
              {view === 'period' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Weekly and monthly history cells with fewer than 30 events are hidden; monthly cells are
                  often thin.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search symbol or name"
          placeholder="Search symbol or name"
          value={q}
          onChange={(e) => setParam('q', e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        {rangeish && (
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={showExcluded}
              onChange={() => setParam('ex', showExcluded ? null : '1')}
            />
            Show excluded
          </label>
        )}
        <div className="relative">
          <button type="button" className="btn" aria-expanded={chooser} onClick={() => setChooser((o) => !o)}>
            Columns
          </button>
          {chooser && (
            <div className="card absolute right-0 top-full z-40 mt-1 max-h-72 w-60 max-w-[85vw] space-y-1 overflow-y-auto p-2 text-sm shadow-lg">
              <button type="button" className="text-xs underline" onClick={() => setCols(defaultCols)}>
                Reset to default
              </button>
              {chooserList.map((c) => (
                <label key={c.key} className="flex items-center gap-1.5" title={c.tip}>
                  <input
                    type="checkbox"
                    checked={cols.includes(c.key)}
                    disabled={c.key === 'sym'}
                    onChange={() => {
                      const k = c.key;
                      setCols(
                        cols.includes(k)
                          ? cols.filter((x) => x !== k)
                          : chooserList.map((x) => x.key).filter((x) => x === k || cols.includes(x)),
                      );
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn" onClick={download} disabled={count === 0}>
          Export CSV
        </button>
      </div>

      {active.error ? (
        <ErrorBox message={active.error} />
      ) : active.loading ? (
        <Skeleton height={560} />
      ) : rangeish && !resolved ? (
        <Empty>Set a start and end date to compute this range.</Empty>
      ) : count === 0 ? (
        <Empty>
          {watchlistMode && watch.length === 0
            ? 'Your watchlist is empty. Open a stock and tap the star to add it.'
            : 'No stocks match the current filters.'}
        </Empty>
      ) : rangeish ? (
        <DataTable<RangeScreenRow>
          rows={rRows}
          columns={cols}
          registry={RANGE_COLUMN_BY_KEY}
          dim={(r) => r.excluded}
          sorting={sorting}
          onSortingChange={onSort}
        />
      ) : (
        <DataTable
          rows={rows}
          columns={cols}
          registry={dayRegistry}
          sorting={sorting}
          onSortingChange={onSort}
          extra={extra}
          signalHistory={
            periodTf
              ? (signal, bucket) =>
                  periodSignalHistory(periodPerf.data, periodTf, signal, bucket) ?? LOADING_LINE
              : undefined
          }
        />
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Click a column header to sort; shift-click adds a second sort. Signals describe what happened over the
        period and do not predict anything.
        {rangeish
          ? ' A ⚠ marks a split or bonus ex-date inside the range: the price return is not adjusted. "Hide event-driven rows" does not apply to ranges.'
          : ''}
        {view === 'period'
          ? ' A ⚠ marks a period with a split or bonus: its prices are split-adjusted, while quantities are plain sums. The minimum-turnover filter reads the average turnover of the prior periods.'
          : ''}
        {watchlistMode
          ? ' Global filters apply to the watchlist too (for example the minimum turnover).'
          : ''}
      </p>
    </div>
  );
}
