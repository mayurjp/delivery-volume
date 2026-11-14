import type { SortingState } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DataTable, { type ExtraColumn } from '../components/DataTable';
import { Empty, ErrorBox, Skeleton, Sparkline } from '../components/ui';
import { COLUMNS, DEFAULT_COLUMNS, toCsv, COLUMN_BY_KEY, type ScreenRow } from '../lib/columns';
import { dataClient } from '../lib/dataClient';
import { fmtDate } from '../lib/format';
import { applyFilters } from '../lib/filters';
import { useApp, useDaily, useGlobalState } from '../lib/hooks';
import { PRESETS, PRESET_BY_ID, runPreset } from '../lib/presets';
import { readJson, writeJson } from '../lib/storage';
import { useWatchlist } from '../lib/watchlist';

const COLS_KEY = 'dv.cols';

function parseSort(s: string | null): SortingState | null {
  if (!s) return null;
  const out = s
    .split(',')
    .map((p) => p.split(':'))
    .filter(([id]) => id && COLUMN_BY_KEY.has(id))
    .map(([id, d]) => ({ id: id as string, desc: d !== 'a' }));
  return out.length ? out : null;
}

const serializeSort = (s: SortingState) => s.map((x) => `${x.id}:${x.desc ? 'd' : 'a'}`).join(',');

function useColumns(): [string[], (c: string[]) => void] {
  const [cols, setCols] = useState<string[]>(() => {
    const saved = readJson<unknown>(COLS_KEY, null);
    return Array.isArray(saved) &&
      saved.every((x) => typeof x === 'string' && COLUMN_BY_KEY.has(x)) &&
      saved.length > 0
      ? (saved as string[])
      : DEFAULT_COLUMNS;
  });
  return [
    cols,
    (c) => {
      setCols(c);
      writeJson(COLS_KEY, c);
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

export default function Screener({ mode = 'screener' }: { mode?: 'screener' | 'watchlist' }) {
  const { meta, bySym } = useApp();
  const { filters, date, activeCount } = useGlobalState();
  const watch = useWatchlist();
  const [params, setParams] = useSearchParams();
  const daily = useDaily(date, meta.latestDate);
  const [cols, setCols] = useColumns();
  const [chooser, setChooser] = useState(false);
  const watchlistMode = mode === 'watchlist';

  const presetId = params.get('p');
  const preset = presetId ? PRESET_BY_ID.get(presetId) : undefined;
  const q = params.get('q') ?? '';
  const explicit = parseSort(params.get('s'));
  const sorting: SortingState =
    explicit ??
    (preset
      ? [{ id: preset.sort as string, desc: preset.dir === 'desc' }]
      : [{ id: 'delivValCr', desc: true }]);

  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: k === 'q' });
  };

  const rows: ScreenRow[] = useMemo(() => {
    if (!daily.data) return [];
    const eff = watchlistMode ? { ...filters, u: 'WATCHLIST' } : filters;
    let list = applyFilters(daily.data, bySym, eff, { indices: meta.indices, watchlist: new Set(watch) });
    if (preset) list = runPreset(preset, list, bySym);
    const needle = q.trim().toLowerCase();
    return list
      .map((r) => {
        const u = bySym.get(r.sym)!;
        return { ...r, name: u.name, sector: u.sector, mcapCr: u.mcapCr, bucket: u.bucket };
      })
      .filter(
        (r) => !needle || r.sym.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle),
      );
  }, [daily.data, filters, bySym, meta.indices, watch, preset, q, watchlistMode]);

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
    const specs = cols.map((c) => COLUMN_BY_KEY.get(c)!).filter(Boolean);
    const sorted = [...rows];
    const [s0] = sorting;
    if (s0) {
      const k = s0.id as keyof ScreenRow;
      sorted.sort((a, b) => {
        const x = a[k] as number | string | null;
        const y = b[k] as number | string | null;
        if (x === null) return 1;
        if (y === null) return -1;
        const c = x < y ? -1 : x > y ? 1 : 0;
        return s0.desc ? -c : c;
      });
    }
    const blob = new Blob([toCsv(sorted, specs)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `delivery-${watchlistMode ? 'watchlist' : 'screener'}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{watchlistMode ? 'Watchlist' : 'Screener'}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {fmtDate(date)} &middot; {rows.length.toLocaleString('en-IN')} stocks
          {activeCount > 0 ? ` (${activeCount} filter${activeCount > 1 ? 's' : ''} active)` : ''}
        </p>
      </div>

      {!watchlistMode && (
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1" role="group" aria-label="Presets">
          <button
            type="button"
            className={`chip shrink-0 ${!preset ? 'bg-blue-600 text-white' : ''}`}
            onClick={() => setParam('p', null)}
          >
            All
          </button>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={preset?.id === p.id}
              className={`chip shrink-0 whitespace-nowrap ${preset?.id === p.id ? 'bg-blue-600 text-white' : ''}`}
              onClick={() => {
                const n = new URLSearchParams(params);
                n.set('p', p.id);
                n.delete('s');
                setParams(n);
              }}
            >
              {p.label}
            </button>
          ))}
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
        <div className="relative">
          <button type="button" className="btn" aria-expanded={chooser} onClick={() => setChooser((o) => !o)}>
            Columns
          </button>
          {chooser && (
            <div className="card absolute right-0 top-full z-40 mt-1 max-h-72 w-60 max-w-[85vw] space-y-1 overflow-y-auto p-2 text-sm shadow-lg">
              <button type="button" className="text-xs underline" onClick={() => setCols(DEFAULT_COLUMNS)}>
                Reset to default
              </button>
              {COLUMNS.map((c) => (
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
                          : COLUMNS.map((x) => x.key as string).filter((x) => x === k || cols.includes(x)),
                      );
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn" onClick={download} disabled={rows.length === 0}>
          Export CSV
        </button>
      </div>

      {daily.error ? (
        <ErrorBox message={daily.error} />
      ) : daily.loading ? (
        <Skeleton height={560} />
      ) : rows.length === 0 ? (
        <Empty>
          {watchlistMode && watch.length === 0
            ? 'Your watchlist is empty. Open a stock and tap the star to add it.'
            : 'No stocks match the current filters.'}
        </Empty>
      ) : (
        <DataTable
          rows={rows}
          columns={cols}
          sorting={sorting}
          onSortingChange={(u) => {
            const next = typeof u === 'function' ? u(sorting) : u;
            setParam('s', next.length ? serializeSort(next) : null);
          }}
          extra={extra}
        />
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Click a column header to sort; shift-click adds a second sort. Signals describe what happened on the
        day and do not predict anything.
        {watchlistMode
          ? ' Global filters apply to the watchlist too (for example the minimum turnover).'
          : ''}
      </p>
    </div>
  );
}
