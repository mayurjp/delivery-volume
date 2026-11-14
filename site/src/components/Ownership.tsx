import { useMemo } from 'react';
import type { HolderRow, SymbolFile } from '../types/data';
import { fmtDate, fmtNum, fmtPct } from '../lib/format';
import {
  EMPTY_HOLDINGS,
  ENTITY_DISCLOSURE,
  EXITED_CAVEAT,
  MODEL_NOTE,
  STATUS_LABEL,
  dilutionCaveat,
  disclosedFor,
  fmtChangePp,
  type DisclosedRow,
  filingsOf,
  namedOf,
  segmentsOf,
  type Segment,
} from '../lib/ownership';
import { useHolders, useHoldingsQuarters } from '../lib/hooks';
import { AppLink, CsvButton, Empty, ErrorBox, Skeleton } from './ui';
import { exportCsv } from '../lib/csv';

const SEG_CLASS: Record<Segment['key'], string> = {
  promoter: 'bg-slate-700 dark:bg-slate-300',
  fii: 'bg-teal-600 dark:bg-teal-400',
  mf: 'bg-violet-600 dark:bg-violet-400',
  insurance: 'bg-amber-500 dark:bg-amber-400',
  otherDii: 'bg-indigo-400 dark:bg-indigo-300',
  retail: 'bg-sky-400 dark:bg-sky-300',
  others: 'bg-slate-300 dark:bg-slate-600',
};

const STATUS_CLASS: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100',
  UP: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100',
  DOWN: 'bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100',
  SAME: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  EXITED: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
};

/** Stock page Ownership section (05 section 4, P1 "Ownership"): stacked bars, pp changes, named holders above 1%. */
export function OwnershipSection({ file }: { file: SymbolFile }) {
  const filings = useMemo(() => filingsOf(file), [file]);
  const named = useMemo(() => namedOf(file), [file]);
  const latest = filings[filings.length - 1];
  const lastFour = filings.slice(-4);
  const hasExited = named.some((n) => n.chg === 'EXITED');
  return (
    <section aria-label="Ownership" className="card min-w-0 p-3" data-testid="ownership">
      <h2 className="text-sm font-semibold">Ownership, quarterly shareholding filings</h2>
      {!latest ? (
        <>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{MODEL_NOTE}</p>
          <Empty>{EMPTY_HOLDINGS}</Empty>
        </>
      ) : (
        <>
          <p className="mb-2 mt-1 text-xs text-slate-600 dark:text-slate-300">{MODEL_NOTE}</p>

          <ul className="space-y-2" data-testid="ownership-bars">
            {lastFour.map((f) => {
              const segs = segmentsOf(f);
              return (
                <li key={f.quarter} className="text-xs">
                  <div className="mb-0.5 font-semibold">
                    Quarter {fmtDate(f.quarter)}
                    {f.filedOn && (
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        {' '}
                        · filed {fmtDate(f.filedOn)}
                      </span>
                    )}
                  </div>
                  {segs ? (
                    <div
                      className="flex h-4 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800"
                      role="img"
                      aria-label={`Quarter ${f.quarter}: ${segs.map((s) => `${s.label} ${fmtNum(s.pct, 2)}%`).join(', ')}`}
                    >
                      {segs.map((s) => (
                        <span
                          key={s.key}
                          className={`h-full ${SEG_CLASS[s.key]}`}
                          style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-500 dark:text-slate-400">
                      Group split not available for this filing.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Bar legend">
            {(['promoter', 'fii', 'mf', 'insurance', 'otherDii', 'retail', 'others'] as const).map((k) => (
              <li key={k} className="flex items-center gap-1">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${SEG_CLASS[k]}`} aria-hidden />
                {LEGEND[k]}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex justify-end">
            <CsvButton
              onClick={() =>
                exportCsv(
                  `ownership-${file.sym}-by-quarter`,
                  latest?.quarter ?? 'none',
                  ['Quarter', 'Promoter %', 'FII %', 'DII %', 'MF %', 'Insurance %', 'Retail %', 'Holders'],
                  lastFour.map((f) => [
                    f.quarter,
                    f.promoterPct,
                    f.fiiPct,
                    f.diiPct,
                    f.mfPct,
                    f.insurancePct,
                    f.retailPct,
                    f.holderCount,
                  ]),
                )
              }
            />
          </div>
          <div className="mt-3 overflow-x-auto" data-testid="ownership-table-wrap" tabIndex={0}>
            <table className="num w-full min-w-[520px] text-xs" aria-label="Shares by group per quarter">
              <thead className="text-slate-500 dark:text-slate-400">
                <tr className="text-right">
                  <th className="py-1 text-left font-medium">Quarter</th>
                  <th className="font-medium">Promoter</th>
                  <th className="font-medium">FII</th>
                  <th className="font-medium">DII</th>
                  <th className="font-medium">MF</th>
                  <th className="font-medium">Insurance</th>
                  <th className="font-medium">Retail</th>
                  <th className="font-medium">Holders</th>
                </tr>
              </thead>
              <tbody>
                {lastFour.map((f) => (
                  <tr key={f.quarter} className="border-t border-slate-100 text-right dark:border-slate-800">
                    <td className="py-1 text-left">{fmtDate(f.quarter)}</td>
                    <td>{fmtPct(f.promoterPct)}</td>
                    <td>{fmtPct(f.fiiPct)}</td>
                    <td>{fmtPct(f.diiPct)}</td>
                    <td>{fmtPct(f.mfPct)}</td>
                    <td>{fmtPct(f.insurancePct)}</td>
                    <td>{fmtPct(f.retailPct)}</td>
                    <td>{f.holderCount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3" data-testid="ownership-changes">
            <h3 className="text-xs font-semibold">
              Change against the previous quarter, {fmtDate(latest.quarter)}
              {latest.dilutionFlag && <span className="ml-1 text-amber-700 dark:text-amber-400">⚠</span>}
            </h3>
            <ul className="mt-1 flex flex-wrap gap-2 text-xs">
              {(
                [
                  ['Promoter', latest.promoterChgPp],
                  ['FII', latest.fiiChgPp],
                  ['DII', latest.diiChgPp],
                  ['MF', latest.mfChgPp],
                ] as const
              ).map(([label, v]) => (
                <li key={label} className="chip">
                  {label} {fmtChangePp(v)}
                </li>
              ))}
            </ul>
            {latest.dilutionFlag && latest.sharesChgPct !== null && (
              <p
                role="note"
                className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
              >
                ⚠ {dilutionCaveat(latest.sharesChgPct)}.
              </p>
            )}
          </div>

          <h3 className="mt-3 text-xs font-semibold">Named holders above 1%, {fmtDate(latest.quarter)}</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">{ENTITY_DISCLOSURE}</p>
          {hasExited && (
            <p role="note" className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              EXITED: {EXITED_CAVEAT}.
            </p>
          )}
          {named.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              No named holder above 1% in this filing.
            </p>
          ) : (
            <>
              <div className="mt-1 flex justify-end">
                <CsvButton
                  onClick={() =>
                    exportCsv(
                      `ownership-${file.sym}-named-holders`,
                      latest?.quarter ?? 'none',
                      ['Holder', 'Category', 'Entity id', 'Pct', 'Previous pct', 'Status'],
                      named.map((n) => [n.holder, n.category, n.entityId, n.pct, n.prevPct, n.chg]),
                    )
                  }
                />
              </div>
              <div className="mt-1 overflow-x-auto" data-testid="named-holders-wrap" tabIndex={0}>
                <table className="num w-full min-w-[480px] text-xs" aria-label="Named holders above 1%">
                  <thead className="text-slate-500 dark:text-slate-400">
                    <tr className="text-right">
                      <th className="py-1 text-left font-medium">Holder</th>
                      <th className="text-left font-medium">Category</th>
                      <th className="font-medium">%</th>
                      <th className="font-medium">Change</th>
                      <th className="font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {named.map((n) => (
                      <NamedRow key={`${n.entityId}-${n.holder}-${n.category}`} n={n} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

const LEGEND: Record<Segment['key'], string> = {
  promoter: 'Promoter',
  fii: 'FII',
  mf: 'MF',
  insurance: 'Insurance',
  otherDii: 'Other DII',
  retail: 'Retail',
  others: 'Others',
};

function NamedRow({ n }: { n: HolderRow }) {
  const change =
    n.chg === 'EXITED'
      ? n.prevPct !== null
        ? `was ${fmtNum(n.prevPct, 2)}%`
        : '—'
      : n.pct !== null && n.prevPct !== null
        ? fmtChangePp(n.pct - n.prevPct)
        : '—';
  return (
    <tr className="border-t border-slate-100 text-right dark:border-slate-800">
      <td className="max-w-[220px] py-1 text-left align-top">
        {n.entityId ? (
          <AppLink to={`/entity/${encodeURIComponent(n.entityId)}`}>{n.holder}</AppLink>
        ) : (
          <span>{n.holder}</span>
        )}
      </td>
      <td className="text-left align-top">{n.category}</td>
      <td className="align-top">{n.pct === null ? '—' : fmtNum(n.pct, 2)}</td>
      <td className="align-top">{change}</td>
      <td className="align-top">
        {n.chg && (
          <span className={`rounded px-1.5 py-0.5 font-semibold ${STATUS_CLASS[n.chg] ?? ''}`}>
            {STATUS_LABEL[n.chg] ?? n.chg}
          </span>
        )}
      </td>
    </tr>
  );
}

/** Entity page "Disclosed holdings" (05 section 4, P7): every stock where this entity is a named holder above 1%. */
export function DisclosedHoldings({ entityId }: { entityId: string }) {
  const quarters = useHoldingsQuarters();
  const recent = useMemo(
    () =>
      quarters.data
        ? [...quarters.data]
            .sort((a, b) => b.quarter.localeCompare(a.quarter))
            .slice(0, 2)
            .map((q) => q.quarter)
        : null,
    [quarters.data],
  );
  const holders = useHolders(recent);
  if (quarters.error) return <ErrorBox message={quarters.error} />;
  if (holders.error) return <ErrorBox message={holders.error} />;
  const inProgress = quarters.data?.filter((q) => !q.complete).map((q) => q.quarter) ?? [];
  return (
    <section aria-label="Disclosed holdings" className="card min-w-0 p-3 text-sm">
      <h2 className="mb-1 font-semibold">Disclosed holdings</h2>
      <p className="text-slate-600 dark:text-slate-300">
        {ENTITY_DISCLOSURE} Each row is a stock where this entity is a named holder above 1%, latest quarter
        first.
      </p>
      {inProgress.length > 0 && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Quarter {inProgress.map((q) => fmtDate(q)).join(', ')} is still in progress, so its list may be
          incomplete.
        </p>
      )}
      {!holders.data || !quarters.data ? (
        <div className="mt-2">
          <Skeleton height={120} />
        </div>
      ) : (
        <DisclosedTable
          rows={disclosedFor(entityId, holders.data)}
          empty="No named holding above 1% in the stored filings for this entity."
        />
      )}
    </section>
  );
}

function DisclosedTable({ rows, empty }: { rows: DisclosedRow[]; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="mt-2">
      <div className="flex justify-end">
        <CsvButton
          onClick={() =>
            exportCsv(
              'entity-disclosed-holdings',
              rows[0]?.quarter ?? 'none',
              ['Quarter', 'Stock', 'Category', 'Holder', 'Pct', 'Previous pct', 'Status'],
              rows.map((r) => [r.quarter, r.sym, r.category, r.holder, r.pct, r.prevPct, r.chg]),
            )
          }
        />
      </div>
      <div className="mt-2 overflow-x-auto" data-testid="disclosed-holdings" tabIndex={0}>
        <table className="num w-full min-w-[480px] text-xs" aria-label="Disclosed holdings by stock">
          <thead className="text-slate-500 dark:text-slate-400">
            <tr className="text-right">
              <th className="py-1 text-left font-medium">Quarter</th>
              <th className="text-left font-medium">Stock</th>
              <th className="font-medium">%</th>
              <th className="font-medium">Previous %</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.quarter}-${r.sym}`}
                className="border-t border-slate-100 text-right dark:border-slate-800"
              >
                <td className="py-1 text-left">{fmtDate(r.quarter)}</td>
                <td className="text-left">
                  <AppLink to={`/stock/${encodeURIComponent(r.sym)}`}>{r.sym}</AppLink>
                </td>
                <td>{fmtNum(r.pct, 2)}%</td>
                <td>{r.prevPct === null ? '—' : `${fmtNum(r.prevPct, 2)}%`}</td>
                <td className="text-left">
                  {r.chg && (
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${STATUS_CLASS[r.chg] ?? ''}`}>
                      {STATUS_LABEL[r.chg] ?? r.chg}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
