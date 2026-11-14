import { DisclosedHoldings } from '../components/Ownership';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import EChart from '../charts/EChart';
import { entityTimelineOption } from '../charts/deals';
import { palette } from '../charts/theme';
import { AppLink, CsvButton, Empty, ErrorBox, Skeleton, Tip } from '../components/ui';
import { exportCsv } from '../lib/csv';
import {
  CATEGORIES,
  DEALS_CAVEAT,
  DEFAULT_DEAL_FILTER,
  HISTORY_GAP_NOTE,
  SIDE_OPTIONS,
  type Category,
  type DealFilter,
  dealChip,
  entityDeals,
  filterDeals,
  fiiDiiLists,
  flowTotals,
  stockFlows,
  topEntitiesInRange,
} from '../lib/deals';
import { fmtCr, fmtDate, fmtNum, fmtSigned } from '../lib/format';
import { useDealFlows, useDeals, useEntities } from '../lib/hooks';
import { useDark } from '../lib/theme';
import type { EntityRow } from '../types/data';

/** The deals list shows at most this many rows (the filters narrow it further). */
const ROW_CAP = 200;

/** Read the deal filter from the URL (shareable state, 05 section 1). */
function filterFromParams(p: URLSearchParams): DealFilter {
  const num = Number(p.get('min') ?? 0);
  return {
    ...DEFAULT_DEAL_FILTER,
    from: p.get('from') || null,
    to: p.get('to') || null,
    type: (p.get('type') as DealFilter['type']) || 'all',
    side: (p.get('side') as DealFilter['side']) || 'all',
    category: (p.get('cat') as DealFilter['category']) || 'all',
    minValueCr: Number.isFinite(num) && num > 0 ? num : 0,
    hideRoundTrips: p.get('rt') !== '0',
    sym: p.get('sym')?.toUpperCase() || null,
  };
}

export default function Deals() {
  const [params, setParams] = useSearchParams();
  const deals = useDeals();
  const flows = useDealFlows();
  const filter = filterFromParams(params);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const [topCat, setTopCat] = useState<Category | 'all'>('FII');

  const rows = useMemo(() => (deals.data ? filterDeals(deals.data, filter) : []), [deals.data, filter]);
  const dateRange = useMemo(() => {
    const ds = deals.data ?? [];
    return { min: ds[0]?.date ?? null, max: ds[ds.length - 1]?.date ?? null };
  }, [deals.data]);
  if (deals.error) return <ErrorBox message={deals.error} />;
  if (flows.error) return <ErrorBox message={flows.error} />;
  if (!deals.data || !flows.data) return <Skeleton height={480} />;

  const totals = flowTotals(flows.data, filter.from, filter.to);
  const table = stockFlows(flows.data, filter.from, filter.to);
  const lists = fiiDiiLists(table);
  const topBought = topEntitiesInRange(deals.data, filter.from, filter.to, topCat, 'bought');
  const topSold = topEntitiesInRange(deals.data, filter.from, filter.to, topCat, 'sold');
  const shown = rows.slice(0, ROW_CAP);

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-xl font-semibold">Bulk and block deals</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Named trades of 0.5% or more of a company's shares (bulk) and negotiated block trades. Stored from{' '}
          {dateRange.min ? fmtDate(dateRange.min) : '—'} to {dateRange.max ? fmtDate(dateRange.max) : '—'}.
        </p>
      </header>
      <p role="note" className="card p-3 text-sm">
        {DEALS_CAVEAT} {HISTORY_GAP_NOTE}
      </p>

      <section aria-label="Deal filters" className="card grid grid-cols-2 gap-2 p-3 text-sm md:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-400">From</span>
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={filter.from ?? ''}
            onChange={(e) => set('from', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-400">To</span>
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={filter.to ?? ''}
            onChange={(e) => set('to', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-400">Deal type</span>
          <select
            className="rounded border px-2 py-1"
            value={filter.type}
            onChange={(e) => set('type', e.target.value === 'all' ? '' : e.target.value)}
          >
            <option value="all">Bulk and block</option>
            <option value="bulk">Bulk</option>
            <option value="block">Block</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-400">Side</span>
          <select
            className="rounded border px-2 py-1"
            value={filter.side}
            onChange={(e) => set('side', e.target.value === 'all' ? '' : e.target.value)}
          >
            {SIDE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-400">Category</span>
          <select
            className="rounded border px-2 py-1"
            value={filter.category}
            onChange={(e) => set('cat', e.target.value === 'all' ? '' : e.target.value)}
          >
            <option value="all">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-400">Minimum value, Rs Cr</span>
          <input
            type="number"
            min={0}
            step={1}
            className="rounded border px-2 py-1"
            value={filter.minValueCr || ''}
            onChange={(e) => set('min', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-400">Symbol</span>
          <input
            className="rounded border px-2 py-1 uppercase"
            value={filter.sym ?? ''}
            onChange={(e) => set('sym', e.target.value.trim())}
            placeholder="e.g. RELIANCE"
          />
        </label>
        <label className="flex items-center gap-2 pt-4">
          <input
            type="checkbox"
            checked={filter.hideRoundTrips}
            onChange={(e) => set('rt', e.target.checked ? '' : '0')}
          />
          <span>Hide round trips</span>
          <Tip label={<span className="chip">?</span>}>
            A round trip is the same entity buying and selling about the same quantity in the same stock on
            the same day (net within 10%). It is usually arbitrage or proprietary trading, not conviction.
          </Tip>
        </label>
      </section>

      <section aria-label="Totals by category" className="card p-3">
        <h2 className="mb-1 text-sm font-semibold">Net via deals in this range (Rs Cr)</h2>
        <div className="num grid grid-cols-3 gap-2 text-sm">
          {CATEGORIES.map((c) => (
            <div key={c}>
              <div className="text-xs text-slate-600 dark:text-slate-400">{c}</div>
              <div className="font-semibold">{fmtSigned(totals[c].netValueCr, 2)}</div>
              <div className="text-xs text-slate-600 dark:text-slate-400">
                bought {fmtNum(totals[c].buyValueCr, 2)}, sold {fmtNum(totals[c].sellValueCr, 2)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Top entities" className="card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <h2 className="mr-2 text-sm font-semibold">Top entities by net value</h2>
          {(['all', ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={topCat === c}
              onClick={() => setTopCat(c)}
              className={`chip ${topCat === c ? 'bg-blue-600 text-white' : ''}`}
            >
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <EntityList title="Top bought" rows={topBought} side="bought" />
          <EntityList title="Top sold" rows={topSold} side="sold" />
        </div>
      </section>

      <section aria-label="FII vs DII by stock" className="card p-3">
        <h2 className="mb-1 flex items-center gap-1 text-sm font-semibold">
          FII vs DII by stock, this range
          <Tip label={<span className="chip">?</span>}>{DEALS_CAVEAT}</Tip>
        </h2>
        <div className="grid gap-3 lg:grid-cols-3">
          <StockFlowTable
            title={`FII selling to DII (${lists.fiiSellDiiBuy.length})`}
            rows={lists.fiiSellDiiBuy}
          />
          <StockFlowTable
            title={`FII buying from DII (${lists.fiiBuyDiiSell.length})`}
            rows={lists.fiiBuyDiiSell}
          />
          <StockFlowTable
            title={`All stocks (${table.length})`}
            rows={[...table]
              .sort(
                (a, b) =>
                  Math.abs(b.fiiNetCr) + Math.abs(b.diiNetCr) - Math.abs(a.fiiNetCr) - Math.abs(a.diiNetCr),
              )
              .slice(0, 25)}
          />
        </div>
      </section>

      <section aria-label="Deal list" className="card overflow-x-auto p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Deals ({rows.length}){rows.length > ROW_CAP ? `, first ${ROW_CAP} shown` : ''}
          </h2>
          <CsvButton
            disabled={shown.length === 0}
            onClick={() =>
              exportCsv(
                'deals',
                `${filter.from || 'start'}_${filter.to || 'end'}`,
                [
                  'Date',
                  'Stock',
                  'Entity',
                  'Entity category',
                  'Entity type',
                  'Type',
                  'Side',
                  'Qty',
                  'Price',
                  'Value Cr',
                  'Round trip',
                ],
                shown.map((r) => [
                  r.date,
                  r.sym,
                  r.entityName,
                  r.entityCategory,
                  r.entityType,
                  r.type,
                  r.side,
                  r.qty,
                  r.price,
                  r.valueCr,
                  r.roundTrip ? 'yes' : 'no',
                ]),
              )
            }
          />
        </div>
        {rows.length === 0 ? (
          <Empty>No deals match these filters.</Empty>
        ) : (
          <table className="num w-full min-w-[720px] text-sm">
            <thead className="text-xs text-slate-600 dark:text-slate-400">
              <tr className="text-left">
                <th className="py-1 font-medium">Date</th>
                <th className="font-medium">Stock</th>
                <th className="font-medium">Entity</th>
                <th className="font-medium">Deal</th>
                <th className="text-right font-medium">Qty</th>
                <th className="text-right font-medium">Price</th>
                <th className="text-right font-medium">Value Cr</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr
                  key={`${r.date}-${r.sym}-${r.client}-${r.side}-${i}`}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="py-1">{fmtDate(r.date)}</td>
                  <td>
                    <Link
                      className="text-blue-700 underline dark:text-blue-300"
                      to={`/stock/${encodeURIComponent(r.sym)}`}
                    >
                      {r.sym}
                    </Link>
                  </td>
                  <td>
                    <Link
                      className="text-blue-700 underline dark:text-blue-300"
                      to={`/entity/${encodeURIComponent(r.entityId)}`}
                    >
                      {r.entityName}
                    </Link>{' '}
                    <span className="chip">{r.entityCategory}</span>
                    {r.entityType === 'Promoter' && <span className="chip">Promoter</span>}
                    {r.entityTypeInferred && (
                      <span className="text-xs text-slate-600 dark:text-slate-400"> (inferred)</span>
                    )}
                    {r.roundTrip && (
                      <span className="text-xs text-slate-600 dark:text-slate-400"> round trip</span>
                    )}
                  </td>
                  <td>
                    <span className="chip">{dealChip(r)}</span>
                  </td>
                  <td className="text-right">{fmtNum(r.qty, 0)}</td>
                  <td className="text-right">{fmtNum(r.price, 2)}</td>
                  <td className="text-right">{fmtNum(r.valueCr, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Source: NSE bulk and block deal files. Entity names are grouped by config/entities.json (the seed list
        is reviewed by hand). Category FII, DII or Other is the entity's type; "inferred" marks a type read
        from the name.
      </p>
    </div>
  );
}

function EntityList({
  title,
  rows,
  side,
}: {
  title: string;
  rows: { entityId: string; entityName: string; entityCategory: Category; netValueCr: number }[];
  side: 'bought' | 'sold';
}) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No entity {side} net in this range.</p>
      ) : (
        <ol className="space-y-0.5 text-sm">
          {rows.map((r) => (
            <li key={r.entityId} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <Link
                  className="text-blue-700 underline dark:text-blue-300"
                  to={`/entity/${encodeURIComponent(r.entityId)}`}
                >
                  {r.entityName}
                </Link>{' '}
                <span className="chip">{r.entityCategory}</span>
              </span>
              <span className="num">{fmtCr(Math.abs(r.netValueCr))}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function StockFlowTable({
  title,
  rows,
}: {
  title: string;
  rows: { sym: string; fiiNetCr: number; diiNetCr: number }[];
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {title}
        </h3>
        {rows.length > 0 && (
          <CsvButton
            onClick={() =>
              exportCsv(
                title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                'range',
                ['Stock', 'FII net Cr', 'DII net Cr'],
                rows.map((r) => [r.sym, r.fiiNetCr, r.diiNetCr]),
              )
            }
          />
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">None in this range.</p>
      ) : (
        <table className="num w-full text-sm">
          <thead className="text-xs text-slate-600 dark:text-slate-400">
            <tr className="text-right">
              <th className="py-1 text-left font-medium">Stock</th>
              <th className="font-medium">FII net</th>
              <th className="font-medium">DII net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sym} className="border-t border-slate-100 text-right dark:border-slate-800">
                <td className="py-1 text-left">
                  <Link
                    className="text-blue-700 underline dark:text-blue-300"
                    to={`/stock/${encodeURIComponent(r.sym)}`}
                  >
                    {r.sym}
                  </Link>
                </td>
                <td>{fmtSigned(r.fiiNetCr, 2)}</td>
                <td>{fmtSigned(r.diiNetCr, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** One entity: totals, the stocks it dealt in, every deal of every alias, and the timeline (P7, 05 section 4). */
export function EntityPage() {
  const { id = '' } = useParams();
  const deals = useDeals();
  const entities = useEntities();
  const dark = useDark();
  const p = palette(dark);
  const entityId = decodeURIComponent(id);
  if (deals.error) return <ErrorBox message={deals.error} />;
  if (entities.error) return <ErrorBox message={entities.error} />;
  if (!deals.data || !entities.data) return <Skeleton height={420} />;
  const ent: EntityRow | undefined = entities.data.find((e) => e.entityId === entityId);
  if (!ent) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">No entity found</h1>
        <p className="text-sm">No deal entity has the id {entityId}.</p>
        <AppLink to="/deals">Back to the deals page</AppLink>
      </div>
    );
  }
  const mine = entityDeals(deals.data, entityId);
  const bySym = new Map<string, { sym: string; net: number; n: number }>();
  for (const d of mine) {
    if (d.roundTrip) continue;
    const r = bySym.get(d.sym) ?? { sym: d.sym, net: 0, n: 0 };
    r.net += d.side === 'BUY' ? d.valueCr : -d.valueCr;
    r.n++;
    bySym.set(d.sym, r);
  }
  const perStock = [...bySym.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return (
    <div className="space-y-3">
      <header>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          <Link to="/deals" className="underline">
            Deals
          </Link>{' '}
          / Entity
        </p>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          {ent.entityName}
          <span className="chip">{ent.entityCategory}</span>
          <span className="chip">{ent.entityType}</span>
          {mine.some((d) => d.entityTypeInferred) && (
            <span className="text-xs text-slate-600 dark:text-slate-400">type inferred from the name</span>
          )}
        </h1>
      </header>
      <p role="note" className="card p-3 text-sm">
        {DEALS_CAVEAT} {HISTORY_GAP_NOTE}
      </p>
      <section
        aria-label="Entity totals"
        className="card num grid grid-cols-2 gap-2 p-3 text-sm md:grid-cols-4"
      >
        <div>
          <div className="text-xs text-slate-600 dark:text-slate-400">Bought via deals</div>
          <div className="font-semibold">{fmtCr(ent.buyValueCr)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-600 dark:text-slate-400">Sold via deals</div>
          <div className="font-semibold">{fmtCr(ent.sellValueCr)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-600 dark:text-slate-400">Net</div>
          <div className="font-semibold">{fmtSigned(ent.netValueCr, 2)} Cr</div>
        </div>
        <div>
          <div className="text-xs text-slate-600 dark:text-slate-400">Deals, first and last</div>
          <div>
            {ent.dealCount} ({fmtDate(ent.firstDate)} to {fmtDate(ent.lastDate)})
          </div>
        </div>
      </section>
      <DisclosedHoldings entityId={entityId} />
      <section aria-label="Per-stock net" className="card overflow-x-auto p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Net via deals, by stock (round trips excluded)</h2>
          <CsvButton
            disabled={perStock.length === 0}
            onClick={() =>
              exportCsv(
                `entity-${entityId}-by-stock`,
                ent.lastDate,
                ['Stock', 'Deals', 'Net Cr'],
                perStock.map((r) => [r.sym, r.n, r.net]),
              )
            }
          />
        </div>
        {perStock.length === 0 ? (
          <Empty>No non-round-trip deals for this entity.</Empty>
        ) : (
          <table className="num w-full min-w-[320px] text-sm">
            <thead className="text-xs text-slate-600 dark:text-slate-400">
              <tr className="text-right">
                <th className="py-1 text-left font-medium">Stock</th>
                <th className="font-medium">Deals</th>
                <th className="font-medium">Net Cr</th>
              </tr>
            </thead>
            <tbody>
              {perStock.map((r) => (
                <tr key={r.sym} className="border-t border-slate-100 text-right dark:border-slate-800">
                  <td className="py-1 text-left">
                    <Link
                      className="text-blue-700 underline dark:text-blue-300"
                      to={`/stock/${encodeURIComponent(r.sym)}`}
                    >
                      {r.sym}
                    </Link>
                  </td>
                  <td>{r.n}</td>
                  <td>{fmtSigned(r.net, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section aria-label="Deal timeline" className="card p-3">
        <h2 className="mb-1 text-sm font-semibold">Deal timeline (bought above zero, sold below)</h2>
        {mine.length === 0 ? (
          <Empty>No deals.</Empty>
        ) : (
          <EChart
            option={entityTimelineOption(
              mine.map((d) => ({ date: d.date, side: d.side, valueCr: d.valueCr, sym: d.sym })),
              p,
            )}
            height={260}
            ariaLabel="Deal timeline"
          />
        )}
      </section>
      <section aria-label="Aliases" className="card p-3 text-sm">
        <h2 className="mb-1 font-semibold">Names grouped into this entity</h2>
        <ul className="list-disc pl-5">
          {ent.aliases.map((a) => (
            <li key={a} className="break-words">
              {a}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          Names are matched by config/entities.json (see its README block in the repository). Editing that
          file and rebuilding regroups the deals.
        </p>
      </section>
    </div>
  );
}
