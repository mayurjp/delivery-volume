import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import EChart from '../charts/EChart';
import { palette } from '../charts/theme';
import { sectorBarOption, sectorGridOption, stockTrailOption } from '../charts/trail';
import { AppLink, CsvButton, Empty, ErrorBox, Skeleton } from '../components/ui';
import { exportCsv } from '../lib/csv';
import { corpActionSyms } from '../lib/range';
import { dataClient } from '../lib/dataClient';
import { DEALS_CAVEAT, dealChip, dealsByDate, round2, signedValue } from '../lib/deals';
import { fmtCr, fmtDate, fmtInt, fmtNum, fmtPct, fmtPctChg, fmtPp, fmtRatio } from '../lib/format';
import { useApp, useAsync, useCum, useSymbol, useTrail, useTrailPerf } from '../lib/hooks';
import { useDark } from '../lib/theme';
import {
  INDICATORS,
  WINDOWS,
  holdingsOf,
  foByDate,
  trailForRows,
  windowView,
  type TrailCfg,
  type WindowName,
  type WindowView,
} from '../lib/trail';
import {
  EVIDENCE_LABEL,
  HISTORICAL_LABEL,
  MIN_PERF_DATES,
  TRAIL_UNIVERSES,
  WINDOW_LABEL,
  buildInsights,
  filterEntries,
  historyLine,
  narrative,
  parseTrail,
  perfRow,
  perfThin,
  rankLists,
  sectorGrid,
  sectorMedian,
  sectorRotation,
  type TrailEntry,
} from '../lib/trailView';
import type { Deal, SymbolFile, TrailDoc, TrailPerfRow } from '../types/data';

const CODE_CLASS: Record<string, string> = {
  A: 'bg-blue-600 text-white dark:bg-blue-400 dark:text-slate-900',
  D: 'bg-orange-600 text-white dark:bg-orange-400 dark:text-slate-900',
  N: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  '-': 'border border-dashed border-slate-300 text-slate-600 dark:text-slate-400 dark:border-slate-600',
};
const CODE_WORD: Record<string, string> = {
  A: 'leans accumulation',
  D: 'leans distribution',
  N: 'neutral',
  '-': 'not enough history',
};
const IND_SHORT: Record<string, string> = {
  delivBal: 'Delivery balance',
  delivPctTrend: 'Delivery % trend',
  tradeSizeTrend: 'Trade size trend',
  spikePersist: 'Spike persistence',
  dealsNet: 'Named deals',
  holdInst: 'FII + DII holdings',
  holdPromoter: 'Promoter holdings',
  foTrend: 'F&O build-up days',
};
/** The order of the eight codes in a window's `codes` string (trail/latest.json, 07 6A). */
const CODE_ORDER =
  'Codes in order: delivery balance, delivery % trend, trade size trend, spike persistence, named deals, FII + DII holdings, promoter holdings, F&O build-up';
/** What the F&O footprint says in words: its code only (the record carries no counts). */
const FO_WORD: Record<string, string> = {
  A: 'long build-up days lead the classed F&O days',
  D: 'short build-up days lead the classed F&O days',
  N: 'neither long nor short build-up leads',
  '-': 'no F&O data (not an F&O stock, or too few F&O days in the window)',
};
const STATUS_CLASS: Record<string, string> = {
  NEW: 'bg-blue-600 text-white dark:bg-blue-400 dark:text-slate-900',
  UP: 'bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100',
  DOWN: 'bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-100',
  EXITED: 'bg-orange-600 text-white dark:bg-orange-400 dark:text-slate-900',
  SAME: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

function CodeChip({ code }: { code: string }) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs font-semibold ${CODE_CLASS[code] ?? ''}`}
      title={CODE_WORD[code]}
    >
      {code}
    </span>
  );
}

/** The 52-week mini trail strip: one narrow cell per week, A blue, D orange, N grey, a dashed cell where history is short. */
function Strip({ strip, label }: { strip: string; label: string }) {
  return (
    <span className="inline-flex gap-px align-middle" role="img" aria-label={label}>
      {[...strip].map((c, i) => (
        <span
          key={i}
          className={`inline-block h-3.5 w-[5px] ${c === 'A' ? 'bg-blue-600 dark:bg-blue-400' : c === 'D' ? 'bg-orange-600 dark:bg-orange-400' : c === 'N' ? 'bg-slate-300 dark:bg-slate-600' : 'bg-transparent'}`}
        />
      ))}
    </span>
  );
}

function stripLabel(strip: string): string {
  const n = (c: string) => [...strip].filter((x) => x === c).length;
  return `Weekly trail, last ${strip.length} weeks: ${n('A')} weeks A, ${n('D')} weeks D, ${n('N')} weeks neutral`;
}

function EvidenceNote() {
  return (
    <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="evidence-label">
      <strong>{EVIDENCE_LABEL}</strong> NSE does not publish who took delivery. The trail shows footprints:
      delivery value on up days and down days, delivery % against its own baseline, average trade size and
      delivery-spike persistence. A leans accumulation, D leans distribution, N is neutral. In the 3-year
      study, delivery concentrated on up days came <em>before</em> down-runs, so these conventional readings
      may not hold; see the historical lines beside each list.
    </p>
  );
}

const numOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Stock mode holdings (07 6A, Phase 4B): quarterly FII, DII, MF and promoter bars, the change chips of the latest quarter
 * and the named holders above 1% with their NEW / UP / DOWN / EXITED status. Descriptive only.
 */
function HoldingsCard({ file }: { file: SymbolFile }) {
  const h = file.holdings;
  const rows = h.rows;
  if (rows.length === 0) {
    return (
      <section aria-label="Shareholding" className="card p-3" data-testid="holdings-card">
        <h2 className="text-sm font-semibold">Shareholding, quarterly filings</h2>
        <Empty>No shareholding filings stored for this stock yet.</Empty>
      </section>
    );
  }
  const at = (c: string) => h.columns.indexOf(c);
  const quarters = [...rows].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const last = quarters[quarters.length - 1]!;
  const lastQ = String(last[0]);
  const chips = [
    { label: 'FII', v: numOf(last[at('fiiChgPp')]) },
    { label: 'DII', v: numOf(last[at('diiChgPp')]) },
    { label: 'MF', v: numOf(last[at('mfChgPp')]) },
    { label: 'Promoter', v: numOf(last[at('promoterChgPp')]) },
  ].filter((c): c is { label: string; v: number } => c.v !== null);
  const bars = [
    { key: 'fiiPct', label: 'FII', cls: 'bg-teal-600 dark:bg-teal-400' },
    { key: 'diiPct', label: 'DII', cls: 'bg-indigo-600 dark:bg-indigo-400' },
    { key: 'mfPct', label: 'MF', cls: 'bg-violet-600 dark:bg-violet-400' },
    { key: 'promoterPct', label: 'Promoter', cls: 'bg-slate-700 dark:bg-slate-300' },
  ];
  const named = file.namedHolders.rows
    .filter((r) => String(r[0]) === lastQ)
    .map((r) => ({
      holder: String(r[3]),
      category: String(r[1]),
      pct: numOf(r[6]),
      chg: r[8] === null || r[8] === undefined ? null : String(r[8]),
    }))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
    .slice(0, 12);
  return (
    <section aria-label="Shareholding" className="card min-w-0 p-3" data-testid="holdings-card">
      <h2 className="text-sm font-semibold">Shareholding, quarterly filings</h2>
      <p className="mb-2 text-xs text-slate-600 dark:text-slate-300">
        Percent of shares by group, for the last four stored quarters. Changes are against the previous stored
        quarter.
      </p>
      <ul className="space-y-2" data-testid="holdings-bars">
        {quarters.slice(-4).map((q) => (
          <li key={String(q[0])} className="text-xs">
            <div className="mb-0.5 font-semibold">{fmtDate(String(q[0]))}</div>
            <div className="grid gap-0.5">
              {bars.map((b) => {
                const v = numOf(q[at(b.key)]);
                return (
                  <div key={b.key} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-slate-600 dark:text-slate-300">{b.label}</span>
                    <span
                      className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-slate-800"
                      role="img"
                      aria-label={`${b.label} ${fmtNum(v, 2)}%`}
                    >
                      <span
                        className={`absolute inset-y-0 left-0 rounded ${b.cls}`}
                        style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }}
                      />
                    </span>
                    <span className="num w-14 shrink-0 text-right">{fmtNum(v, 2)}%</span>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs" data-testid="holdings-chips">
          {chips.map((c) => (
            <span key={c.label} className="chip">
              {c.label} {fmtPp(c.v, 1)}
            </span>
          ))}
          <span className="self-center text-slate-600 dark:text-slate-400">
            change in {fmtDate(lastQ)} filing
          </span>
        </div>
      )}
      <h3 className="mt-3 text-xs font-semibold">Named holders above 1%, {fmtDate(lastQ)}</h3>
      {named.length === 0 ? (
        <p className="text-xs text-slate-600 dark:text-slate-400">No named holder above 1% in this filing.</p>
      ) : (
        <ul
          className="mt-1 divide-y divide-slate-100 text-xs dark:divide-slate-800"
          data-testid="named-holders"
        >
          {named.map((n) => (
            <li key={n.holder} className="flex items-center justify-between gap-2 py-1">
              <span className="min-w-0 truncate">
                {n.holder} <span className="text-slate-600 dark:text-slate-400">({n.category})</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="num">{fmtNum(n.pct, 2)}%</span>
                {n.chg && (
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${STATUS_CLASS[n.chg] ?? ''}`}>
                    {n.chg}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Slots({ doc }: { doc: TrailDoc }) {
  if (doc.slots.length === 0) return null; // every footprint is built (Phase 5)
  return (
    <section aria-label="Indicators arriving later" className="card p-3">
      <h2 className="mb-1 text-sm font-semibold">Footprints arriving in later phases</h2>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {doc.slots.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-2 rounded border border-dashed border-slate-300 px-2 py-1 dark:border-slate-700"
          >
            <span>{s.label}</span>
            <span className="chip shrink-0">arrives in {s.arrives}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function pickWindow(v: string | null): WindowName {
  return (WINDOWS as readonly string[]).includes(v ?? '') ? (v as WindowName) : '6M';
}

function WindowChips({ win, onChange }: { win: WindowName; onChange: (w: WindowName) => void }) {
  return (
    <div role="group" aria-label="Window" className="flex gap-1">
      {WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={win === w}
          className={`chip ${win === w ? 'bg-blue-600 text-white' : ''}`}
          onClick={() => onChange(w)}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

// ---- market mode ------------------------------------------------------------------------------------------------------

function valueCells(v: WindowView) {
  return (
    <>
      <td>{fmtRatio(v.delivBal, 2)}</td>
      <td>{fmtPp(v.delivPctTrend, 1)}</td>
      <td>{fmtPctChg(v.tradeSizeTrend, 0)}</td>
    </>
  );
}

function ListTable({
  title,
  id,
  entries,
  win,
  history,
  lean,
  since,
}: {
  title: string;
  id: string;
  entries: TrailEntry[];
  win: WindowName;
  history: string;
  lean: 'A' | 'D' | 'flip';
  since: Map<string, number | null> | null;
}) {
  return (
    <section aria-label={title} className="card min-w-0 p-3" data-testid={`list-${id}`}>
      <h2 className="text-sm font-semibold">
        {title} <span className="font-normal text-slate-600 dark:text-slate-400">({entries.length})</span>
      </h2>
      <p className="mb-2 text-xs text-slate-600 dark:text-slate-300" data-testid={`history-${id}`}>
        {history}
      </p>
      <div className="mb-1 flex justify-end">
        <CsvButton
          disabled={entries.length === 0}
          onClick={() =>
            exportCsv(
              `trail-${id}`,
              `window-${win}`,
              [
                'Stock',
                'A',
                'D',
                'N',
                'Codes',
                'Lean weeks',
                'Balance',
                'Deliv % trend pp',
                'Trade size trend',
                'Flip',
                'Flip since',
                'Since %',
              ],
              entries.map((e) => {
                const v = e.w[win]!;
                return [
                  e.sym,
                  v.A,
                  v.D,
                  v.N,
                  v.codes,
                  lean === 'D' ? v.consD : v.consA,
                  v.delivBal,
                  v.delivPctTrend,
                  v.tradeSizeTrend,
                  lean === 'flip' ? v.flip : null,
                  lean === 'flip' ? v.flipSince : null,
                  since ? (since.get(e.sym) ?? null) : null,
                ];
              }),
            )
          }
        />
      </div>
      {entries.length === 0 ? (
        <p className="py-3 text-center text-sm text-slate-600 dark:text-slate-400">
          No stock matches in this universe and window.
        </p>
      ) : (
        <div className="max-h-[520px] overflow-auto" tabIndex={0}>
          <table className="num w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-white text-xs text-slate-600 dark:text-slate-400 dark:bg-slate-900">
              <tr className="text-right">
                <th className="py-1 text-left font-medium">Stock</th>
                <th className="text-left font-medium">Trail, 52 weeks</th>
                <th className="font-medium">A / D / N</th>
                <th className="font-medium" title={CODE_ORDER}>
                  Codes
                </th>
                <th className="font-medium">{lean === 'D' ? 'D weeks' : 'A weeks'}</th>
                <th className="font-medium">Balance</th>
                <th className="font-medium">Deliv % trend</th>
                <th className="font-medium">Trade size</th>
                {lean === 'flip' && <th className="font-medium">Flip</th>}
                {since && <th className="font-medium">Since</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const v = e.w[win]!;
                return (
                  <tr key={e.sym} className="border-t border-slate-100 text-right dark:border-slate-800">
                    <td className="py-1 text-left">
                      <Link
                        className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
                        to={`/trail/${encodeURIComponent(e.sym)}`}
                      >
                        {e.sym}
                      </Link>
                    </td>
                    <td className="text-left">
                      <Strip strip={e.strip} label={stripLabel(e.strip)} />
                    </td>
                    <td>
                      {v.A} / {v.D} / {v.N}
                    </td>
                    <td className="font-mono text-xs" title={CODE_ORDER} data-testid="window-codes">
                      {v.codes}
                    </td>
                    <td>{lean === 'D' ? fmtPct(v.consD, 0) : fmtPct(v.consA, 0)}</td>
                    {valueCells(v)}
                    {lean === 'flip' && (
                      <td className="whitespace-nowrap">
                        <span className="chip">{v.flip}</span> {fmtDate(v.flipSince)}
                      </td>
                    )}
                    {since && <td>{fmtPctChg(since.get(e.sym) ?? null, 1)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TrackRecord({
  perf,
  win,
  minN,
  asOfDates,
}: {
  perf: readonly TrailPerfRow[];
  win: WindowName;
  minN: number;
  asOfDates: string[];
}) {
  const lists = [
    ['strongA', 'Strongest accumulation trail'],
    ['strongD', 'Strongest distribution trail'],
    ['flip', 'Taste changing, any flip'],
    ['flipAD', 'Flip, A to D'],
    ['flipDA', 'Flip, D to A'],
  ] as const;
  const row = (kind: 'list' | 'indicator', id: string, label: string) => {
    const cells = [60, 120].map((h) => {
      const r = perfRow(perf, kind, id, win, h);
      const thin = perfThin(r, minN);
      return (
        <td key={h} colSpan={1} className="text-right">
          {thin || !r || r.medianExcess === null ? (
            <span className="text-slate-600 dark:text-slate-400" title={thin ?? undefined}>
              n {r?.n ?? 0}
              {r && r.dates < MIN_PERF_DATES ? `, ${r.dates} dates` : ''}
            </span>
          ) : (
            <>
              {fmtPctChg(r.medianExcess, 1)}{' '}
              <span className="text-slate-600 dark:text-slate-400">
                ({fmtPct(r.hitRate, 0)}, n {fmtInt(r.n)})
              </span>
            </>
          )}
        </td>
      );
    });
    return (
      <tr key={`${kind}:${id}`} className="border-t border-slate-100 dark:border-slate-800">
        <td className="py-1">{label}</td>
        {cells}
      </tr>
    );
  };
  return (
    <section aria-label="Track record" className="card min-w-0 p-3" data-testid="track-record">
      <h2 className="text-sm font-semibold">Track record, {WINDOW_LABEL[win]} window</h2>
      <p className="mb-2 text-xs text-slate-600 dark:text-slate-300">
        Median forward excess return against the Nifty 500 eligible-stock median (entry at the next day&apos;s
        close), with the hit rate and the number of stock-dates. {asOfDates.length} month-end dates from{' '}
        {fmtDate(asOfDates[0])} to {fmtDate(asOfDates[asOfDates.length - 1])}; today&apos;s index membership,
        before costs. {HISTORICAL_LABEL}
      </p>
      <div className="overflow-x-auto" tabIndex={0}>
        <table className="num w-full min-w-[520px] text-sm">
          <thead className="text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th className="py-1 text-left font-medium">List or indicator reading</th>
              <th className="text-right font-medium">60 days</th>
              <th className="text-right font-medium">120 days</th>
            </tr>
          </thead>
          <tbody>
            {lists.map(([id, label]) => row('list', id, label))}
            {INDICATORS.flatMap((i) =>
              (['A', 'D', 'N'] as const).map((c) => row('indicator', `${i}:${c}`, `${IND_SHORT[i]}: ${c}`)),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrailMarket() {
  const { meta, bySym } = useApp();
  const dark = useDark();
  const pal = palette(dark);
  const [params, setParams] = useSearchParams();
  const win = pickWindow(params.get('tw'));
  const tu = TRAIL_UNIVERSES.some((x) => x.key === params.get('tu')) ? params.get('tu')! : 'NIFTY500';
  const sec = params.get('ts') && meta.sectors.includes(params.get('ts')!) ? params.get('ts')! : null;
  const insId = params.get('ti');
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const latest = useTrail(null);
  const snapshots = latest.data?.snapshots ?? [];
  const asOfParam = params.get('ta');
  const asOf = asOfParam && snapshots.includes(asOfParam) ? asOfParam : null;
  const doc = useTrail(asOf);
  const perf = useTrailPerf();
  const perfDoc = useAsync('trailPerfDoc', () => dataClient.trailPerfDoc());
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null || v === '') next.delete(k);
    else next.set(k, v);
    if (k !== 'ti') next.delete('ti');
    setParams(next);
  };

  const data = doc.data;
  const entries = useMemo(() => (data ? parseTrail(data) : []), [data]);
  const filtered = useMemo(
    () => filterEntries(entries, bySym, { u: tu, sector: sec }, meta.indices),
    [entries, bySym, tu, sec, meta.indices],
  );
  const size = data?.listSize ?? 25;
  const lists = useMemo(() => rankLists(filtered, win, size), [filtered, win, size]);
  const universeLabel = TRAIL_UNIVERSES.find((x) => x.key === tu)!.label;
  const minN = 30;
  const insights = useMemo(
    () => buildInsights(filtered, bySym, { win, universeLabel, sectorLabel: sec, perf: perf.data, minN }),
    [filtered, bySym, win, universeLabel, sec, perf.data],
  );
  const rot = useMemo(() => sectorRotation(filtered, bySym, win), [filtered, bySym, win]);
  const weeks = data?.config ? (data.config as TrailCfg).windows[win].weeks : 26;
  const grid = useMemo(
    () =>
      sectorGrid(
        filtered,
        bySym,
        weeks,
        rot.map((r) => r.sector),
      ),
    [filtered, bySym, weeks, rot],
  );
  const hist = (kind: 'list' | 'indicator', id: string) => historyLine(perf.data, kind, id, win, minN);

  // what happened after the as-of date: change of the last close since then (cum/ carries lastClose per stock)
  const cumThen = useCum(asOf);
  const cumNow = useCum(asOf ? meta.latestDate : null);
  const splits = useAsync(asOf ? 'splitBonus' : null, () => dataClient.splitBonus());
  const since = useMemo(() => {
    if (!asOf || !cumThen.data || !cumNow.data || !splits.data) return null;
    const skip = corpActionSyms(splits.data, asOf, meta.latestDate);
    const then = new Map(cumThen.data.map((r) => [r.sym, r.lastClose]));
    const out = new Map<string, number | null>();
    for (const r of cumNow.data) {
      const a = then.get(r.sym);
      out.set(r.sym, a && r.lastClose && !skip.has(r.sym) ? (r.lastClose / a - 1) * 100 : null);
    }
    return out;
  }, [asOf, cumThen.data, cumNow.data, splits.data, meta.latestDate]);

  const selected = insights.find((i) => i.id === insId) ?? null;
  const [showAll, setShowAll] = useState(false);

  if (latest.error) return <ErrorBox message={latest.error} />;
  if (doc.error) return <ErrorBox message={doc.error} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Smart Money Trail</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400" data-testid="trail-asof">
          {asOf ? `As of ${fmtDate(asOf)}` : data ? `As of ${fmtDate(data.asOf)}` : ''}
        </p>
      </div>
      <EvidenceNote />

      <section aria-label="Trail controls" className="card flex flex-wrap items-end gap-3 p-3">
        <div>
          <div className="mb-0.5 text-xs text-slate-600 dark:text-slate-400">Window</div>
          <WindowChips win={win} onChange={(w) => set('tw', w === '6M' ? null : w)} />
        </div>
        <label className="text-xs text-slate-600 dark:text-slate-400">
          <span className="mb-0.5 block">Universe</span>
          <select
            className="btn py-1 text-sm"
            value={tu}
            onChange={(e) => set('tu', e.target.value === 'NIFTY500' ? null : e.target.value)}
            aria-label="Universe"
          >
            {TRAIL_UNIVERSES.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-400">
          <span className="mb-0.5 block">Sector</span>
          <select
            className="btn max-w-[12rem] py-1 text-sm"
            value={sec ?? ''}
            onChange={(e) => set('ts', e.target.value || null)}
            aria-label="Sector"
          >
            <option value="">All sectors</option>
            {meta.sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-400">
          <span className="mb-0.5 block">As of</span>
          <select
            className="btn py-1 text-sm"
            value={asOf ?? ''}
            onChange={(e) => set('ta', e.target.value || null)}
            aria-label="As of date"
          >
            <option value="">Latest ({fmtDate(latest.data?.asOf)})</option>
            {[...snapshots].reverse().map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)} (month end)
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {filtered.length} stocks in this universe with a computable trail. Low-liquidity, new and ETF rows
          are left out.
        </p>
      </section>

      {asOf && (
        <p
          className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          data-testid="asof-note"
        >
          This is what the trail said on {fmtDate(asOf)}, using only data up to that day. &quot;Since&quot; is
          the change of the last close from that day to {fmtDate(meta.latestDate)} (blank where a split or
          bonus sits in between). {data?.survivorship}
        </p>
      )}

      {doc.loading || !data ? (
        <Skeleton height={320} />
      ) : (
        <>
          <section aria-label="Insights" className="card p-3" data-testid="insights">
            <h2 className="mb-1 text-sm font-semibold">What stands out ({insights.length})</h2>
            <ul className="space-y-1.5 text-sm">
              {insights.map((i) => (
                <li key={i.id} data-testid={`insight-${i.id}`}>
                  {i.text}{' '}
                  {i.syms.length > 0 && (
                    <button
                      type="button"
                      className="text-blue-700 underline dark:text-blue-300"
                      onClick={() => set('ti', insId === i.id ? null : i.id)}
                    >
                      {insId === i.id ? 'Hide rows' : `Show the ${i.syms.length} rows`}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {selected && (
              <div
                className="mt-2 rounded border border-slate-200 p-2 text-sm dark:border-slate-700"
                data-testid="insight-rows"
              >
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {(showAll ? selected.syms : selected.syms.slice(0, 60)).map((s) => (
                    <Link
                      key={s}
                      className="text-blue-700 hover:underline dark:text-blue-300"
                      to={`/trail/${encodeURIComponent(s)}`}
                    >
                      {s}
                    </Link>
                  ))}
                </div>
                {selected.syms.length > 60 && !showAll && (
                  <button type="button" className="mt-1 text-xs underline" onClick={() => setShowAll(true)}>
                    Show all {selected.syms.length}
                  </button>
                )}
              </div>
            )}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <ListTable
              title="Strongest accumulation trail"
              id="a"
              entries={lists.strongA}
              win={win}
              lean="A"
              history={hist('list', 'strongA')}
              since={since}
            />
            <ListTable
              title="Strongest distribution trail"
              id="d"
              entries={lists.strongD}
              win={win}
              lean="D"
              history={hist('list', 'strongD')}
              since={since}
            />
          </div>
          <ListTable
            title="Taste changing"
            id="flip"
            entries={lists.flips}
            win={win}
            lean="flip"
            history={hist('list', 'flip')}
            since={since}
          />

          <section aria-label="Indicators" className="card min-w-0 p-3" data-testid="indicator-rows">
            <h2 className="text-sm font-semibold">The footprints, {WINDOW_LABEL[win]}</h2>
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {data.indicators.map((ind, j) => {
                const counts = { A: 0, D: 0, N: 0 };
                for (const e of filtered) {
                  const c = e.w[win]?.codes[j];
                  if (c === 'A' || c === 'D' || c === 'N') counts[c]++;
                }
                return (
                  <li key={ind.id} className="py-2 text-sm" data-testid={`indicator-${ind.id}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{ind.label}</span>
                      <span className="num text-xs text-slate-600 dark:text-slate-300">
                        {counts.A} A, {counts.D} D, {counts.N} N
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">{ind.rule}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      A: {hist('indicator', `${ind.id}:A`).replace('Historically: ', 'Historically, ')}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      D: {hist('indicator', `${ind.id}:D`).replace('Historically: ', 'Historically, ')}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="Sector rotation" className="card min-w-0 p-3" data-testid="sector-rotation">
            <h2 className="text-sm font-semibold">Sector rotation, {WINDOW_LABEL[win]}</h2>
            <p className="mb-1 text-xs text-slate-600 dark:text-slate-300">
              Bars: the share of a sector&apos;s stocks leaning A minus the share leaning D. Grid: the same
              measure for each week.
            </p>
            {rot.length === 0 ? (
              <Empty>No sector has a computable trail in this selection.</Empty>
            ) : (
              <>
                <EChart
                  option={sectorBarOption(rot, pal, mobile)}
                  height={Math.max(180, rot.length * 22 + 40)}
                  ariaLabel="Sector rotation bar chart"
                />
                <div className="mt-2 overflow-x-auto" tabIndex={0}>
                  <div style={{ minWidth: 520 }}>
                    <EChart
                      option={sectorGridOption(grid, data.stripWeeks.slice(-weeks), pal, mobile)}
                      height={Math.max(220, grid.sectors.length * 20 + 80)}
                      ariaLabel="Sector by week grid"
                    />
                  </div>
                </div>
                <div className="mt-2 overflow-x-auto" tabIndex={0}>
                  <table className="num w-full min-w-[480px] text-sm">
                    <thead className="text-xs text-slate-600 dark:text-slate-400">
                      <tr className="text-right">
                        <th className="py-1 text-left font-medium">Sector</th>
                        <th className="font-medium">Stocks</th>
                        <th className="font-medium">A</th>
                        <th className="font-medium">D</th>
                        <th className="font-medium">Balance</th>
                        <th className="font-medium">Flips A to D / D to A</th>
                        <th
                          className="font-medium"
                          title="FII net via named bulk and block deals over the window"
                        >
                          FII via deals, Cr
                        </th>
                        <th
                          className="font-medium"
                          title="DII net via named bulk and block deals over the window"
                        >
                          DII via deals, Cr
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rot.map((r) => (
                        <tr
                          key={r.sector}
                          className="border-t border-slate-100 text-right dark:border-slate-800"
                        >
                          <td className="py-1 text-left">
                            <button
                              type="button"
                              className="text-blue-700 hover:underline dark:text-blue-300"
                              onClick={() => set('ts', r.sector)}
                            >
                              {r.sector}
                            </button>
                          </td>
                          <td>{r.n}</td>
                          <td>{r.nA}</td>
                          <td>{r.nD}</td>
                          <td>{fmtRatio(r.balance, 2)}</td>
                          <td>
                            {r.flipsAD} / {r.flipsDA}
                          </td>
                          <td>{fmtNum(r.fiiDeals, 1)}</td>
                          <td>{fmtNum(r.diiDeals, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {perf.data && perf.data.length > 0 ? (
            <TrackRecord perf={perf.data} win={win} minN={minN} asOfDates={perfDoc.data?.asOfDates ?? []} />
          ) : perf.error ? (
            <ErrorBox message={perf.error} />
          ) : (
            <Skeleton height={200} />
          )}
          <Slots doc={data} />
        </>
      )}
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {EVIDENCE_LABEL} {HISTORICAL_LABEL} Delivery balance compares delivery value on up days with down
        days; it does not say who took delivery.
      </p>
    </div>
  );
}

// ---- stock mode ---------------------------------------------------------------------------------------------------------

/** The named deals of the window, with the entity behind each one (Phase 4, 07 6A stock mode). */
function NamedDealsCard({ deals, startDate, win }: { deals: Deal[]; startDate: string; win: WindowName }) {
  const rows = deals
    .filter((d) => !d.roundTrip && d.date >= startDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  const fii = rows.filter((d) => d.entityCategory === 'FII');
  const dii = rows.filter((d) => d.entityCategory === 'DII');
  const net = (xs: Deal[]) => round2(xs.reduce((t, d) => t + signedValue(d), 0));
  return (
    <section aria-label="Named deals" className="card min-w-0 p-3" data-testid="stock-named-deals">
      <h2 className="mb-1 text-sm font-semibold">Named deals, {WINDOW_LABEL[win]}</h2>
      <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
        {DEALS_CAVEAT} Round trips are excluded from the totals. FII net {fmtCr(net(fii))}, DII net{' '}
        {fmtCr(net(dii))}.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No named bulk or block deals in this window.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((d, i) => (
            <li key={`${d.date}-${i}`} className="flex flex-wrap items-center gap-2">
              <span className="num">{fmtDate(d.date)}</span>
              <span className="chip">{dealChip(d)}</span>
              {d.entityId ? (
                <Link
                  className="text-blue-700 underline dark:text-blue-300"
                  to={`/entity/${encodeURIComponent(d.entityId)}`}
                >
                  {d.entityName ?? d.client}
                </Link>
              ) : (
                <span>{d.client}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TrailStock({ sym }: { sym: string }) {
  const { meta, bySym } = useApp();
  const dark = useDark();
  const pal = palette(dark);
  const [params, setParams] = useSearchParams();
  const win = pickWindow(params.get('tw'));
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const u = bySym.get(sym) ?? null;
  const data = useSymbol(u?.f ?? null);
  const latest = useTrail(null);
  const perf = useTrailPerf();
  const cfg = latest.data?.config as TrailCfg | undefined;
  const result = useMemo(
    () =>
      data.data && cfg
        ? trailForRows(
            data.data.rows,
            meta.tradingDays,
            cfg,
            undefined,
            dealsByDate(data.data.file.dealFlows),
            holdingsOf(data.data.file.holdings),
            foByDate(data.data.file.fo),
          )
        : null,
    [data.data, cfg, meta.tradingDays],
  );
  const closes = useMemo(() => {
    if (!data.data || !result) return [];
    const by = new Map(data.data.rows.map((r) => [r.date, r.close]));
    return result.timeline.map((t) => by.get(t.end) ?? null);
  }, [data.data, result]);
  const entries = useMemo(() => (latest.data ? parseTrail(latest.data) : []), [latest.data]);
  const sector = u ? sectorMedian(entries, bySym, u.sector, win) : null;

  if (!u) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">No stock found</h1>
        <p className="text-sm">No stock is listed as {sym}.</p>
        <Link className="text-blue-700 underline dark:text-blue-300" to="/trail">
          Back to the Smart Money Trail
        </Link>
      </div>
    );
  }
  if (data.error || latest.error) return <ErrorBox message={(data.error ?? latest.error)!} />;
  const rec = result?.windows[win] ?? null;
  const view = rec ? windowView(rec) : null;
  const weeks = cfg ? cfg.windows[win].weeks : 26;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">
          {sym}{' '}
          <span className="text-base font-normal text-slate-600 dark:text-slate-400">Smart Money Trail</span>
        </h1>
        <AppLink
          to={`/stock/${encodeURIComponent(sym)}`}
          className="text-sm text-blue-700 hover:underline dark:text-blue-300"
        >
          Back to the stock page
        </AppLink>
      </div>
      <p className="truncate text-sm text-slate-600 dark:text-slate-300">
        {u.name} · {u.sector}
      </p>
      <EvidenceNote />
      {!result ? (
        <Skeleton height={320} />
      ) : (
        <>
          <section aria-label="Window" className="card flex flex-wrap items-center gap-3 p-3">
            <WindowChips
              win={win}
              onChange={(w) => {
                const next = new URLSearchParams(params);
                if (w === '6M') next.delete('tw');
                else next.set('tw', w);
                setParams(next);
              }}
            />
            <span className="text-xs text-slate-600 dark:text-slate-400">
              Computed in your browser from this stock&apos;s daily history, as of {fmtDate(result.asOf)}.
              {!result.eligible &&
                ' The latest day is excluded from trail rules (low liquidity, new listing or ETF).'}
            </span>
          </section>

          <section aria-label="Narrative" className="card p-3" data-testid="narrative">
            <h2 className="mb-1 text-sm font-semibold">In words, {WINDOW_LABEL[win]}</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {narrative(view, win, weeks).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>

          <section aria-label="Footprints" className="card min-w-0 p-3" data-testid="stock-indicators">
            <h2 className="text-sm font-semibold">The footprints</h2>
            {!view ? (
              <p className="py-3 text-sm text-slate-600 dark:text-slate-400">
                Not enough history for this window yet.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
                {INDICATORS.map((id, j) => {
                  const code = view.codes[j] ?? '-';
                  const value =
                    id === 'delivBal'
                      ? fmtRatio(view.delivBal, 2)
                      : id === 'delivPctTrend'
                        ? fmtPp(view.delivPctTrend, 1)
                        : id === 'tradeSizeTrend'
                          ? fmtPctChg(view.tradeSizeTrend, 1)
                          : id === 'holdInst'
                            ? `${fmtPp(view.holdInstPp, 1)} over two quarters`
                            : id === 'holdPromoter'
                              ? `${fmtPp(view.holdPromoterPp, 1)} over two quarters`
                              : id === 'dealsNet'
                                ? `FII ${fmtCr(view.dealsFii)}, DII ${fmtCr(view.dealsDii)}`
                                : id === 'foTrend'
                                  ? (FO_WORD[code] ?? '')
                                  : `${view.spikeDays ?? '—'} spike days (${view.spikeUp ?? 0} up, ${view.spikeDn ?? 0} down)`;
                  const secV =
                    id === 'delivBal' && sector?.medianBal != null
                      ? `sector median ${fmtRatio(sector.medianBal, 2)}`
                      : null;
                  return (
                    <li key={id} className="py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <CodeChip code={code} />
                          <span className="font-semibold">{IND_SHORT[id]}</span>
                        </span>
                        <span className="num">
                          {value}{' '}
                          {secV && (
                            <span className="text-xs text-slate-600 dark:text-slate-400">({secV})</span>
                          )}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        {historyLine(perf.data, 'indicator', `${id}:${code}`, win)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {view && (
              <p className="mt-1 text-sm">
                Tally: {view.A} A, {view.D} D, {view.N} neutral
                {view.missing ? `, ${view.missing} without history` : ''}.{' '}
                {view.flip && (
                  <span data-testid="stock-flip">
                    <span className="chip">{view.flip}</span> taste change since {fmtDate(view.flipSince)}.
                  </span>
                )}
              </p>
            )}
          </section>

          <section aria-label="Weekly trail chart" className="card min-w-0 p-3">
            <h2 className="mb-1 text-sm font-semibold">Price, weekly delivery balance and spike days</h2>
            {result.timeline.length === 0 ? (
              <Empty>Not enough history yet.</Empty>
            ) : (
              <EChart
                option={stockTrailOption(result.timeline, closes, pal, mobile)}
                height={mobile ? 340 : 410}
                ariaLabel={`${sym} weekly close, delivery balance and spike days`}
              />
            )}
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Each point covers the 20 trading days ending that week. Delivery balance above 1 means more
              delivery value on up days than on down days (capped at 4 in the chart).
            </p>
          </section>

          <section aria-label="Sector comparison" className="card p-3" data-testid="sector-compare">
            <h2 className="text-sm font-semibold">
              Compared with the {u.sector} median, {WINDOW_LABEL[win]}
            </h2>
            {!sector || !view ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">No sector comparison available.</p>
            ) : (
              <p className="text-sm">
                {sym}: {view.A} A and {view.D} D footprints. Sector median across {sector.n} stocks:{' '}
                {fmtNum(sector.medianA, 1)} A and {fmtNum(sector.medianD, 1)} D. {fmtPct(sector.shareA, 0)} of
                the sector&apos;s stocks lean A and {fmtPct(sector.shareD, 0)} lean D. Delivery balance:{' '}
                {fmtRatio(view.delivBal, 2)} against a sector median of {fmtRatio(sector.medianBal, 2)}.
              </p>
            )}
          </section>

          {data.data && <HoldingsCard file={data.data.file} />}
          <section aria-label="Weekly timeline" className="card min-w-0 p-3" data-testid="timeline">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Weekly timeline</h2>
              <CsvButton
                disabled={result.timeline.length === 0}
                onClick={() =>
                  exportCsv(
                    `trail-timeline-${sym}`,
                    result.timeline[result.timeline.length - 1]?.end ?? 'none',
                    ['Week ending', 'Close', ...INDICATORS.map((i) => `${i} code`)],
                    [...result.timeline]
                      .reverse()
                      .map((t, k) => [
                        t.end,
                        closes[result.timeline.length - 1 - k] ?? null,
                        ...INDICATORS.map((_, j) => t.codes[j] ?? '-'),
                      ]),
                  )
                }
              />
            </div>
            <div className="max-h-[480px] overflow-auto" tabIndex={0}>
              <table className="num w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-white text-xs text-slate-600 dark:text-slate-400 dark:bg-slate-900">
                  <tr className="text-right">
                    <th className="py-1 text-left font-medium">Week ending</th>
                    <th className="font-medium">Close</th>
                    {INDICATORS.map((i) => (
                      <th key={i} className="font-medium">
                        {IND_SHORT[i]}
                      </th>
                    ))}
                    <th className="font-medium">Week</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.timeline].reverse().map((t, k) => (
                    <tr key={t.end} className="border-t border-slate-100 text-right dark:border-slate-800">
                      <td className="py-1 text-left">{fmtDate(t.end)}</td>
                      <td>{fmtNum(closes[result.timeline.length - 1 - k] ?? null, 2)}</td>
                      {INDICATORS.map((id, j) => (
                        <td key={id}>
                          <span className="inline-flex items-center gap-1">
                            <CodeChip code={t.codes[j] ?? '-'} />
                            <span className="hidden text-xs text-slate-600 dark:text-slate-400 sm:inline">
                              {id === 'delivBal'
                                ? fmtNum(t.delivBal, 2)
                                : id === 'delivPctTrend'
                                  ? fmtNum(t.delivPctTrend, 1)
                                  : id === 'tradeSizeTrend'
                                    ? fmtNum(t.tradeSizeTrend, 0)
                                    : id === 'spikePersist'
                                      ? (t.spikeDays ?? '—')
                                      : ''}
                            </span>
                          </span>
                        </td>
                      ))}
                      <td>
                        <CodeChip code={t.overall} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {data.data && cfg && (
            <NamedDealsCard
              deals={data.data.file.deals}
              startDate={meta.tradingDays[Math.max(0, meta.tradingDays.length - cfg.windows[win].days)] ?? ''}
              win={win}
            />
          )}
          {latest.data && <Slots doc={latest.data} />}
        </>
      )}
    </div>
  );
}

export default function Trail() {
  const { sym } = useParams();
  return sym ? <TrailStock sym={decodeURIComponent(sym)} /> : <TrailMarket />;
}
