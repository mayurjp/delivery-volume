import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, type ReactNode } from 'react';
import { COLUMN_BY_KEY, type ColumnSpec, type RowLike, type ScreenRow } from '../lib/columns';
import { csvFileName, csvText, downloadCsv, type CsvCell } from '../lib/csv';
import { CsvButton, EtfBadge, FlagIcons, AppLink, SignalBadge } from './ui';
import { FLAG, type Bucket, type SignalCode } from '../types/data';

const ROW_H = 36;

export interface ExtraColumn<R = ScreenRow> {
  id: string;
  label: string;
  tip: string;
  width: number;
  render: (r: R) => ReactNode;
}

interface Props<R extends RowLike> {
  rows: readonly R[];
  columns: readonly string[];
  /** Column registry (defaults to the day-mode Screener columns). */
  registry?: ReadonlyMap<string, ColumnSpec<R>>;
  /** Rows that the page greys out (for example excluded range rows). */
  dim?: (r: R) => boolean;
  ariaLabel?: string;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  extra?: ExtraColumn<R>[];
  height?: number;
  /** Replaces the daily "Historically" line of the signal badge tooltip (weekly and monthly views). */
  signalHistory?: (signal: SignalCode, bucket: Bucket | null) => string | undefined;
  /** CSV file name parts: the view (for example `screener`) and the date (`2026-11-13`). */
  csvView: string;
  csvDate: string;
}

/** The CSV value of a cell: the raw field, or the spec's plain `csv` value. Warning markers become yes or blank. */
function csvValue<R extends RowLike>(spec: ColumnSpec<R>, r: R): CsvCell {
  if (spec.csv) return spec.csv(r);
  if (spec.kind === 'warn') return spec.fmt(r) ? 'yes' : '';
  return (r[spec.key] ?? null) as CsvCell;
}

function cell<R extends RowLike>(
  spec: ColumnSpec<R>,
  r: R,
  signalHistory?: (signal: SignalCode, bucket: Bucket | null) => string | undefined,
): ReactNode {
  switch (spec.kind) {
    case 'sym':
      return (
        <span className="inline-flex items-center gap-1.5">
          <AppLink
            to={`/stock/${encodeURIComponent(r.sym)}`}
            className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
          >
            {r.sym}
          </AppLink>
          <EtfBadge show={r.etf === true || ((r.flags ?? 0) & FLAG.etf) !== 0} />
        </span>
      );
    case 'signal':
      return (
        <SignalBadge
          signal={r.signal ?? null}
          bucket={r.bucket ?? null}
          plain
          history={r.signal ? signalHistory?.(r.signal, r.bucket ?? null) : undefined}
        />
      );
    case 'flags':
      return <FlagIcons flags={r.flags ?? 0} plain />;
    case 'warn':
      return spec.fmt(r) ? (
        <span
          role="img"
          aria-label={spec.cellTip?.(r) ?? 'Corporate action in range: price return not adjusted'}
          className="text-amber-700 dark:text-amber-400"
        >
          ⚠
        </span>
      ) : null;
    default:
      return spec.fmt(r);
  }
}

/** Virtualised, sortable table. Click a header to sort, shift-click to add a secondary sort. First column sticks. */
export default function DataTable<R extends RowLike>({
  rows,
  columns,
  registry,
  dim,
  ariaLabel = 'Screener table',
  sorting,
  onSortingChange,
  extra = [],
  height = 560,
  signalHistory,
  csvView,
  csvDate,
}: Props<R>) {
  const reg = (registry ?? COLUMN_BY_KEY) as ReadonlyMap<string, ColumnSpec<R>>;
  const helper = useMemo(() => createColumnHelper<R>(), []);
  const specs = useMemo(
    () => columns.map((k) => reg.get(k)).filter((c): c is ColumnSpec<R> => !!c),
    [columns, reg],
  );
  const defs = useMemo(
    () => [
      ...specs.map((s) =>
        helper.accessor((r) => (r[s.key] ?? undefined) as string | number | undefined, {
          id: s.key,
          header: s.label,
          size: s.width,
          sortUndefined: 'last',
          enableSorting: s.kind !== 'flags' && s.kind !== 'warn',
          meta: { spec: s },
        }),
      ),
      ...extra.map((e) =>
        helper.display({
          id: e.id,
          header: e.label,
          size: e.width,
          enableSorting: false,
          meta: { extra: e },
        }),
      ),
    ],
    [specs, extra, helper],
  );
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows as R[],
    columns: defs,
    state: { sorting },
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
    isMultiSortEvent: (e) => (e as MouseEvent).shiftKey,
    sortDescFirst: true,
  });
  const model = table.getRowModel().rows;
  const parent = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: model.length,
    getScrollElement: () => parent.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });
  const total = table.getVisibleLeafColumns().reduce((s, c) => s + c.getSize(), 0);

  /** Exports the rows as sorted and filtered right now (the table's own sorted model), with the spec columns only. */
  const exportCsv = () => {
    const headers = specs.map((s) => s.label);
    const body = table.getRowModel().rows.map((row) => specs.map((s) => csvValue(s, row.original)));
    downloadCsv(csvFileName(csvView, csvDate), csvText(headers, body));
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <CsvButton
          onClick={exportCsv}
          disabled={model.length === 0}
          label={`Download the ${ariaLabel.toLowerCase()} rows shown as CSV`}
        />
      </div>
      <div
        ref={parent}
        className="card relative overflow-auto"
        style={{ height }}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
      >
        <div style={{ width: total, minWidth: '100%' }}>
          <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-slate-100 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
            {table.getHeaderGroups()[0]!.headers.map((h, i) => {
              const meta = h.column.columnDef.meta as
                { spec?: ColumnSpec<R>; extra?: ExtraColumn<R> } | undefined;
              const sorted = h.column.getIsSorted();
              const right = meta?.spec?.align === 'right';
              return (
                <div
                  key={h.id}
                  style={{ width: h.getSize() }}
                  className={`shrink-0 ${i === 0 ? 'sticky left-0 z-30 bg-slate-100 dark:bg-slate-800' : ''}`}
                >
                  <button
                    type="button"
                    disabled={!h.column.getCanSort()}
                    onClick={h.column.getToggleSortingHandler()}
                    title={meta?.spec?.tip ?? meta?.extra?.tip}
                    className={`flex h-9 w-full items-center gap-1 px-2 ${right ? 'justify-end' : ''}`}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    <span aria-hidden>{sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}</span>
                    <span className="sr-only">
                      {sorted === 'asc'
                        ? ', sorted ascending'
                        : sorted === 'desc'
                          ? ', sorted descending'
                          : ''}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((v) => {
              const row = model[v.index]!;
              return (
                <div
                  key={row.id}
                  className={`absolute left-0 flex w-full items-center border-b border-slate-100 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60 ${dim?.(row.original) ? 'opacity-50' : ''}`}
                  style={{ height: ROW_H, transform: `translateY(${v.start}px)` }}
                >
                  {row.getVisibleCells().map((c, i) => {
                    const meta = c.column.columnDef.meta as { spec?: ColumnSpec<R>; extra?: ExtraColumn<R> };
                    const spec = meta.spec;
                    const r = row.original;
                    return (
                      <div
                        key={c.id}
                        style={{ width: c.column.getSize() }}
                        title={spec?.cellTip?.(r)}
                        className={`num shrink-0 truncate px-2 ${spec?.align === 'right' ? 'text-right' : ''} ${spec?.tone?.(r) ?? ''} ${i === 0 ? 'sticky left-0 z-10 bg-white dark:bg-slate-900' : ''}`}
                      >
                        {spec ? cell(spec, r, signalHistory) : meta.extra?.render(r)}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
