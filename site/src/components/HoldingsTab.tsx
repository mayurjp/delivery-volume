import { useSearchParams } from 'react-router-dom';
import type { HoldingsAggregateRow, HoldingsFiling } from '../types/data';
import { fmtDate, fmtPct } from '../lib/format';
import { useHoldingsAggregates, useHoldingsLatest, useHoldingsQuarters } from '../lib/hooks';
import { aggregateTrend, coverageLine, fmtChangePp, movers, type MoverKey } from '../lib/ownership';
import { AppLink, CsvButton, Empty, ErrorBox, Skeleton } from './ui';
import { exportCsv } from '../lib/csv';

/** The group switch: all stocks, then the market-cap buckets (03 5.10). */
const GROUPS = [
  { id: 'ALL', label: 'All stocks', key: 'ALL' },
  { id: 'L', label: 'Large', key: 'MC:L' },
  { id: 'M', label: 'Mid', key: 'MC:M' },
  { id: 'S', label: 'Small', key: 'MC:S' },
  { id: 'U', label: 'Micro', key: 'MC:U' },
] as const;

const MOVER_SETS: { key: MoverKey; label: string }[] = [
  { key: 'fiiChgPp', label: 'FII' },
  { key: 'diiChgPp', label: 'DII' },
  { key: 'mfChgPp', label: 'MF' },
  { key: 'promoterChgPp', label: 'Promoter' },
];

const TREND_ROWS = [
  { key: 'promoterPct', label: 'Promoter' },
  { key: 'fiiPct', label: 'FII' },
  { key: 'diiPct', label: 'DII (incl. MF)' },
  { key: 'mfPct', label: 'MF' },
  { key: 'retailPct', label: 'Retail' },
] as const;

/** Institutions → Holdings tab (05 section 4, P6 tab 4; Phase 4B). Quarterly, descriptive, all from the holdings files. */
export default function HoldingsTab() {
  const [params, setParams] = useSearchParams();
  const quarters = useHoldingsQuarters();
  const aggs = useHoldingsAggregates();
  const latest = useHoldingsLatest();
  const group = GROUPS.find((g) => g.id === params.get('hg')) ?? GROUPS[0]!;
  const setGroup = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('hg', id);
    setParams(next, { replace: true });
  };
  if (quarters.error) return <ErrorBox message={quarters.error} />;
  if (aggs.error) return <ErrorBox message={aggs.error} />;
  if (latest.error) return <ErrorBox message={latest.error} />;
  if (!quarters.data || !aggs.data || !latest.data) return <Skeleton height={420} />;
  const qs = [...quarters.data].sort((a, b) => a.quarter.localeCompare(b.quarter));
  const lastQ = qs[qs.length - 1] ?? null;
  return (
    <div className="space-y-3" data-testid="holdings-tab">
      <section aria-label="Holdings coverage" className="card p-3 text-sm">
        <h2 className="text-sm font-semibold">Coverage</h2>
        {lastQ ? (
          <>
            <p className="mt-1" data-testid="holdings-coverage">
              {coverageLine(lastQ.filedCount, lastQ.universeCount, lastQ.quarter)}
            </p>
            {!lastQ.complete && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                This quarter is still in progress, so the count will rise as more companies file.
              </p>
            )}
          </>
        ) : (
          <Empty>No shareholding quarter is stored yet.</Empty>
        )}
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Named holders are only disclosed above 1%. Shareholding patterns are filed quarterly, so these
          figures lag the quarter they describe.
        </p>
      </section>

      <section aria-label="Group trend" className="card min-w-0 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Market-cap-weighted holdings by quarter</h2>
          <div role="group" aria-label="Market-cap group" className="flex flex-wrap gap-1">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={group.id === g.id}
                onClick={() => setGroup(g.id)}
                className={`chip ${group.id === g.id ? 'bg-blue-600 text-white' : ''}`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <TrendTable rows={aggregateTrend(aggs.data, group.key)} />
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          Weighted by market capitalisation on the last trading day of each quarter, across the stocks with a
          filing in that quarter. Large, Mid, Small and Micro are the cap buckets of the Screener.
        </p>
      </section>

      <section aria-label="Biggest changes" className="card min-w-0 p-3">
        <h2 className="text-sm font-semibold">Biggest changes against the previous quarter</h2>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Percentage points of total shares, across stocks. Stocks whose share count changed by more than 2%
          are left out, because their changes are not pure buying or selling.
        </p>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {MOVER_SETS.map((m) => (
            <MoverCard key={m.key} label={m.label} mKey={m.key} rows={latest.data ?? []} />
          ))}
        </div>
      </section>
    </div>
  );
}

function TrendTable({ rows }: { rows: HoldingsAggregateRow[] }) {
  if (rows.length === 0) return <Empty>No stocks in this group have a shareholding filing stored yet.</Empty>;
  return (
    <div className="mt-2">
      <div className="flex justify-end">
        <CsvButton
          onClick={() =>
            exportCsv(
              'holdings-trend',
              rows[rows.length - 1]?.quarter ?? 'none',
              ['Group', ...rows.map((r) => r.quarter)],
              TREND_ROWS.map((t) => [t.label, ...rows.map((r) => r[t.key])]),
            )
          }
        />
      </div>
      <div className="mt-2 overflow-x-auto" data-testid="holdings-trend" tabIndex={0}>
        <table className="num w-full min-w-[420px] text-xs" aria-label="Group holdings by quarter">
          <thead className="text-slate-600 dark:text-slate-400">
            <tr className="text-right">
              <th className="py-1 text-left font-medium">Group</th>
              {rows.map((r) => (
                <th key={r.quarter} className="font-medium">
                  {fmtDate(r.quarter)} <span className="font-normal">({r.n})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TREND_ROWS.map((t) => (
              <tr key={t.key} className="border-t border-slate-100 text-right dark:border-slate-800">
                <td className="py-1 text-left">{t.label}</td>
                {rows.map((r) => (
                  <td key={r.quarter}>{fmtPct(r[t.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MoverCard({ label, mKey, rows }: { label: string; mKey: MoverKey; rows: HoldingsFiling[] }) {
  const result = movers(rows, mKey);
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {label}
      </h3>
      <MoverList title="Largest increases" rows={result.up} mKey={mKey} tone="up" />
      <MoverList title="Largest decreases" rows={result.down} mKey={mKey} tone="down" />
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {result.eligible === 0
          ? 'No stocks with a filing yet.'
          : `${result.eligible - result.excludedDilution} of ${result.eligible} stocks with a change; ${result.excludedDilution} left out for a share-count change above 2%.`}
      </p>
    </div>
  );
}

function MoverList({
  title,
  rows,
  mKey,
  tone,
}: {
  title: string;
  rows: HoldingsFiling[];
  mKey: MoverKey;
  tone: 'up' | 'down';
}) {
  return (
    <div className="mt-1">
      <p className="text-xs font-semibold">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-600 dark:text-slate-400">None.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
          {rows.map((r) => (
            <li key={r.sym} className="flex items-center justify-between gap-2 py-0.5">
              <AppLink to={`/stock/${encodeURIComponent(r.sym ?? '')}`}>{r.sym}</AppLink>
              <span
                className={`num ${tone === 'up' ? 'text-up dark:text-up-dark' : 'text-down dark:text-down-dark'}`}
              >
                {fmtChangePp(r[mKey])}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
