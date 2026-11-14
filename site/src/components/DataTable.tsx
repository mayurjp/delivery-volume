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
import { COLUMN_BY_KEY, type ColumnSpec, type ScreenRow } from '../lib/columns';
import { FlagIcons, AppLink, SignalBadge } from './ui';

const ROW_H = 36;
const helper = createColumnHelper<ScreenRow>();

export interface ExtraColumn {
  id: string;
  label: string;
  tip: string;
  width: number;
  render: (r: ScreenRow) => ReactNode;
}

interface Props {
  rows: readonly ScreenRow[];
  columns: readonly string[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  extra?: ExtraColumn[];
  height?: number;
}

function cell(spec: ColumnSpec, r: ScreenRow): ReactNode {
  switch (spec.key) {
    case 'sym':
      return (
        <AppLink
          to={`/stock/${encodeURIComponent(r.sym)}`}
          className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
        >
          {r.sym}
        </AppLink>
      );
    case 'signal':
      return <SignalBadge signal={r.signal} plain />;
    case 'flags':
      return <FlagIcons flags={r.flags} plain />;
    default:
      return spec.fmt(r);
  }
}

/** Virtualised, sortable table. Click a header to sort, shift-click to add a secondary sort. First column sticks. */
export default function DataTable({
  rows,
  columns,
  sorting,
  onSortingChange,
  extra = [],
  height = 560,
}: Props) {
  const specs = useMemo(
    () => columns.map((k) => COLUMN_BY_KEY.get(k)).filter((c): c is ColumnSpec => !!c),
    [columns],
  );
  const defs = useMemo(
    () => [
      ...specs.map((s) =>
        helper.accessor((r) => (r[s.key] ?? undefined) as string | number | undefined, {
          id: s.key as string,
          header: s.label,
          size: s.width,
          sortUndefined: 'last',
          enableSorting: s.key !== 'flags',
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
    [specs, extra],
  );
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows as ScreenRow[],
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

  return (
    <div
      ref={parent}
      className="card relative overflow-auto"
      style={{ height }}
      role="region"
      aria-label="Screener table"
      tabIndex={0}
    >
      <div style={{ width: total, minWidth: '100%' }}>
        <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-slate-100 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
          {table.getHeaderGroups()[0]!.headers.map((h, i) => {
            const meta = h.column.columnDef.meta as { spec?: ColumnSpec; extra?: ExtraColumn } | undefined;
            const sorted = h.column.getIsSorted();
            const right = meta?.spec?.align === 'right';
            return (
              <div
                key={h.id}
                style={{ width: h.getSize() }}
                className={`shrink-0 ${i === 0 ? 'sticky left-0 z-30 bg-slate-100 dark:bg-slate-800' : ''}`}
                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
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
                className="absolute left-0 flex w-full items-center border-b border-slate-100 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                style={{ height: ROW_H, transform: `translateY(${v.start}px)` }}
              >
                {row.getVisibleCells().map((c, i) => {
                  const meta = c.column.columnDef.meta as { spec?: ColumnSpec; extra?: ExtraColumn };
                  const spec = meta.spec;
                  const r = row.original;
                  return (
                    <div
                      key={c.id}
                      style={{ width: c.column.getSize() }}
                      className={`num shrink-0 truncate px-2 ${spec?.align === 'right' ? 'text-right' : ''} ${spec?.tone?.(r) ?? ''} ${i === 0 ? 'sticky left-0 z-10 bg-white dark:bg-slate-900' : ''}`}
                    >
                      {spec ? cell(spec, r) : meta.extra?.render(r)}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
