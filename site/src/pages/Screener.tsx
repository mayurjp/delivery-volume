import type { SortingState } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DataTable, { type ExtraColumn } from '../components/DataTable';
import { Empty, ErrorBox, Skeleton, Sparkline } from '../components/ui';
import RangeControls from '../components/RangeControls';
import {
  COLS_KEY,
  COLUMNS,
  COLUMN_BY_KEY,
  DEFAULT_COLUMNS,
  OLD_COLS_KEY,
  migrateColumns,
  toCsv,
  type ColumnSpec,
  type ScreenRow,
} from '../lib/columns';
import { DEFAULT_RANGE_COLUMNS, RANGE_COLUMNS, RANGE_COLUMN_BY_KEY } from '../lib/rangeColumns';
import { applyRangeFilters } from '../lib/filters';
import { useRangeRows, useRangeState } from '../lib/useRange';
import type { RangeScreenRow } from '../lib/range';
import { PERF_DISCLAIMER, historyLine, type PerfIndex } from '../lib/signalPerf';
import { dataClient } from '../lib/dataClient';
import { fmtDate } from '../lib/format';
import { applyFilters } from '../lib/filters';
import { saveLastFilters, useApp, useDaily, useGlobalState, useSignalPerf } from '../lib/hooks';
import {
  DAILY_WATCH_NOTE,
  PRESET_BY_ID,
  PRESET_EVENT,
  PRESET_GROUPS,
  dailyWatchParams,
  runPreset,
} from '../lib/presets';
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

function useRangeColumns(): [string[], (c: string[]) => void] {
  const [cols, setCols] = useState<string[]>(
    () =>
      validCols(readJson<unknown>(RANGE_COLS_KEY, null), (k) => RANGE_COLUMN_BY_KEY.has(k)) ??
      DEFAULT_RANGE_COLUMNS,
  );
  return [
    cols,
    (c) => {
      setCols(c);
      writeJson(RANGE_COLS_KEY, c);
    },
  ];
}

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

function PresetHistory({ id, perf }: { id: string; perf: PerfIndex | null }) {
  const m = PRESET_EVENT[id];
  const line = m ? historyLine(perf, m.event, m.group ?? 'ALL') : undefined;
  return (
    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400" data-testid={`history-${id}`}>
      {line ??
        (m
          ? 'Historically: not enough history for this list yet.'
          : 'Historically: a ranking, not an event, so no follow-through is measured.')}
    </p>
  );
}

export default function Screener({ mode = 'screener' }: { mode?: 'screener' | 'watchlist' }) {
  const { meta, bySym } = useApp();
  const { filters, defaults, date, activeCount } = useGlobalState();
  const watch = useWatchlist();
  const [params, setParams] = useSearchParams();
  const watchlistMode = mode === 'watchlist';
  const rangeMode = !watchlistMode && params.get('rng') === '1';
  const daily = useDaily(rangeMode ? null : date, meta.latestDate);
  const rangeState = useRangeState();
  const rangeRows = useRangeRows(rangeState.resolved, rangeMode);
  const perf = useSignalPerf();
  const [dayCols, setDayCols] = useColumns();
  const [rangeCols, setRangeCols] = useRangeColumns();
  const [chooser, setChooser] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const cols = rangeMode ? rangeCols : dayCols;
  const setCols = rangeMode ? setRangeCols : setDayCols;
  const showExcluded = params.get('ex') === '1';

  const presetId = params.get('p');
  const preset = presetId && !rangeMode ? PRESET_BY_ID.get(presetId) : undefined;
  const q = params.get('q') ?? '';
  const explicit = parseSort(params.get('s'), (id) =>
    (rangeMode ? RANGE_COLUMN_BY_KEY : COLUMN_BY_KEY).has(id),
  );
  const sorting: SortingState =
    explicit ??
    (rangeMode
      ? [{ id: 'delivValChgPct', desc: true }]
      : preset
        ? [{ id: preset.sort as string, desc: preset.dir === 'desc' }]
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
  const rows: ScreenRow[] = useMemo(() => {
    if (!daily.data) return [];
    const eff = watchlistMode ? { ...filters, u: 'WATCHLIST' } : filters;
    let list = applyFilters(daily.data, bySym, eff, ctx);
    if (preset) list = runPreset(preset, list, bySym);
    return list
      .map((r) => {
        const u = bySym.get(r.sym)!;
        return {
          ...r,
          name: u.name,
          sector: u.sector,
          mcapCr: u.mcapCr,
          bucket: u.bucket,
          chg:
            r.close !== null && r.prevClose !== null ? Math.round((r.close - r.prevClose) * 100) / 100 : null,
        };
      })
      .filter(
        (r) => !needle || r.sym.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle),
      );
  }, [daily.data, filters, bySym, ctx, preset, needle, watchlistMode]);

  const rRows: RangeScreenRow[] = useMemo(() => {
    if (!rangeRows.data) return [];
    return applyRangeFilters(rangeRows.data, bySym, filters, ctx).filter(
      (r) =>
        (showExcluded || !r.excluded) &&
        (!needle || r.sym.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)),
    );
  }, [rangeRows.data, bySym, filters, ctx, showExcluded, needle]);

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

  const download = () => {
    const registry = (rangeMode ? RANGE_COLUMN_BY_KEY : COLUMN_BY_KEY) as unknown as ReadonlyMap<
      string,
      ColumnSpec<Record<string, unknown>>
    >;
    const specs = cols.map((c) => registry.get(c)!).filter(Boolean);
    const sorted = [...(rangeMode ? rRows : rows)] as unknown as Record<string, unknown>[];
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
    a.download = rangeMode
      ? `delivery-range-${rangeState.resolved.range.a}_${rangeState.resolved.range.b}.csv`
      : `delivery-${watchlistMode ? 'watchlist' : 'screener'}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const applyWatch = () => {
    const next = dailyWatchParams(params, defaults.minTurn);
    saveLastFilters(parseFilters(next, defaults.minTurn, meta.indices), defaults.minTurn);
    setParams(next);
  };

  const count = rangeMode ? rRows.length : rows.length;
  const active = rangeMode ? rangeRows : daily;
  const onSort = (u: SortingState | ((o: SortingState) => SortingState)) => {
    const next = typeof u === 'function' ? u(sorting) : u;
    setParam('s', next.length ? serializeSort(next) : null);
  };

  const presetBlock = (id: string) => {
    const p = PRESET_BY_ID.get(id);
    if (!p) return null;
    const on = preset?.id === id;
    return (
      <div key={id} className="min-w-0">
        <button
          type="button"
          aria-pressed={on}
          className={`chip whitespace-nowrap ${on ? 'bg-blue-600 text-white' : ''}`}
          onClick={() => {
            const n = new URLSearchParams(params);
            n.set('p', id);
            n.delete('s');
            setParams(n);
          }}
        >
          {p.label}
        </button>
        <PresetHistory id={id} perf={perf.data} />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{watchlistMode ? 'Watchlist' : 'Screener'}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {rangeMode
            ? `${fmtDate(rangeState.resolved.range.a)} to ${fmtDate(rangeState.resolved.range.b)}`
            : fmtDate(date)}{' '}
          &middot; {count.toLocaleString('en-IN')} stocks
          {activeCount > 0 ? ` (${activeCount} filter${activeCount > 1 ? 's' : ''} active)` : ''}
        </p>
      </div>

      {!watchlistMode && (
        <div role="group" aria-label="Mode" className="flex gap-1">
          <button
            type="button"
            aria-pressed={!rangeMode}
            className={`chip ${!rangeMode ? 'bg-blue-600 text-white' : ''}`}
            onClick={() => setParam('rng', null)}
          >
            Day
          </button>
          <button
            type="button"
            aria-pressed={rangeMode}
            className={`chip ${rangeMode ? 'bg-blue-600 text-white' : ''}`}
            onClick={() => setParam('rng', '1')}
          >
            Range
          </button>
        </div>
      )}

      {rangeMode && <RangeControls state={rangeState} />}

      {!watchlistMode && !rangeMode && (
        <div className="space-y-3">
          <div>
            <button
              type="button"
              className="btn border-blue-700 bg-blue-600 font-semibold text-white hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-700"
              onClick={applyWatch}
              data-testid="daily-watch"
            >
              Daily delivery watch
            </button>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{DAILY_WATCH_NOTE}</p>
          </div>
          <div role="group" aria-label="Presets" className="space-y-2">
            <button
              type="button"
              className={`chip ${!preset ? 'bg-blue-600 text-white' : ''}`}
              onClick={() => setParam('p', null)}
            >
              All stocks
            </button>
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
            <p className="text-xs text-slate-500 dark:text-slate-400">{PERF_DISCLAIMER}</p>
          </div>
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
        {rangeMode && (
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
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setCols(rangeMode ? DEFAULT_RANGE_COLUMNS : DEFAULT_COLUMNS)}
              >
                Reset to default
              </button>
              {(rangeMode ? RANGE_COLUMNS : COLUMNS).map((c) => (
                <label key={c.key as string} className="flex items-center gap-1.5" title={c.tip}>
                  <input
                    type="checkbox"
                    checked={cols.includes(c.key as string)}
                    disabled={c.key === 'sym'}
                    onChange={() => {
                      const k = c.key as string;
                      setCols(
                        cols.includes(k)
                          ? cols.filter((x) => x !== k)
                          : (rangeMode ? RANGE_COLUMNS : COLUMNS)
                              .map((x) => x.key as string)
                              .filter((x) => x === k || cols.includes(x)),
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
      ) : count === 0 ? (
        <Empty>
          {watchlistMode && watch.length === 0
            ? 'Your watchlist is empty. Open a stock and tap the star to add it.'
            : 'No stocks match the current filters.'}
        </Empty>
      ) : rangeMode ? (
        <DataTable<RangeScreenRow>
          rows={rRows}
          columns={cols}
          registry={RANGE_COLUMN_BY_KEY}
          dim={(r) => r.excluded}
          sorting={sorting}
          onSortingChange={onSort}
        />
      ) : (
        <DataTable rows={rows} columns={cols} sorting={sorting} onSortingChange={onSort} extra={extra} />
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Click a column header to sort; shift-click adds a second sort. Signals describe what happened over the
        period and do not predict anything.
        {rangeMode
          ? ' A ⚠ marks a split or bonus ex-date inside the range: the price return is not adjusted. "Hide event-driven rows" does not apply in Range mode.'
          : ''}
        {watchlistMode
          ? ' Global filters apply to the watchlist too (for example the minimum turnover).'
          : ''}
      </p>
    </div>
  );
}
