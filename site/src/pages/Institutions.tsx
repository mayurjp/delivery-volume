import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import EChart from '../charts/EChart';
import {
  cashOption,
  fiiDerivNetOption,
  fiiDerivOiOption,
  fiiLongPctOption,
  netIndexFuturesOption,
  streakLabel,
  volumeShareOption,
} from '../charts/deals';
import { palette } from '../charts/theme';
import { fmtCr, fmtDate, fmtInt, fmtNum, fmtPct, fmtSigned } from '../lib/format';
import { useFiiDeriv, useInstitutionalCash, useMeta, useParticipants } from '../lib/hooks';
import { cashSum, monthlyCash, participantLongPct } from '../lib/institutional';
import { useDark } from '../lib/theme';
import { AppLink, CsvButton, Empty, ErrorBox, Skeleton, Tip } from '../components/ui';
import { exportCsv } from '../lib/csv';
import HoldingsTab from '../components/HoldingsTab';
import type { FiiDerivRow, ParticipantRow } from '../types/data';

type Tab = 'cash' | 'deriv' | 's7' | 'holdings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'deriv', label: 'Derivatives positioning' },
  { id: 's7', label: 'FII derivatives' },
  { id: 'holdings', label: 'Holdings' },
];

/** The provisional-figures banner of P6 (05 section 4), shown on tabs 1 to 3. */
export const PROVISIONAL_BANNER =
  'These FII/DII figures are provisional and combined across NSE, BSE and MSEI. Per-stock FII/DII data comes from two other sources: named bulk/block deals (daily, large trades only) and shareholding patterns (quarterly). See the Holdings tab and the Deals page.';

const RANGES = [
  { id: '1M', days: 21 },
  { id: '3M', days: 63 },
  { id: '1Y', days: 250 },
  { id: 'All', days: 100000 },
] as const;

export default function Institutions() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'cash') as Tab;
  const range = RANGES.find((r) => r.id === params.get('r'))?.id ?? '1Y';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };
  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-xl font-semibold">Institutions</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          FII and DII cash, derivatives positioning and FII derivatives statistics, as published by NSE.
        </p>
      </header>
      <nav aria-label="Institutions tabs" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => set('tab', t.id)}
            className={`chip ${tab === t.id ? 'bg-blue-600 text-white' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab !== 'holdings' && (
        <p role="note" className="card p-3 text-sm">
          {PROVISIONAL_BANNER}
        </p>
      )}
      {tab === 'cash' && <CashTab range={range} onRange={(r) => set('r', r)} />}
      {tab === 'deriv' && <DerivTab />}
      {tab === 's7' && <S7Tab />}
      {tab === 'holdings' && <HoldingsTab />}
    </div>
  );
}

function CashTab({ range, onRange }: { range: string; onRange: (r: string) => void }) {
  const cash = useInstitutionalCash();
  const meta = useMeta();
  const dark = useDark();
  const p = palette(dark);
  const days = RANGES.find((r) => r.id === range)?.days ?? 250;
  const rows = useMemo(() => cash.data?.rows.slice(-days) ?? [], [cash.data, days]);
  const monthly = useMemo(() => monthlyCash(cash.data?.rows ?? []), [cash.data]);
  if (cash.error) return <ErrorBox message={cash.error} />;
  if (!cash.data || !meta.data) return <Skeleton height={420} />;
  const all = cash.data.rows;
  const latest = [...all].reverse().find((r) => r.fiiNet !== null) ?? null;
  const since = cash.data.collectingSince;
  if (all.length === 0 || !since) {
    return (
      <Empty>No FII/DII cash record yet. The scheduled collector stores one line per trading day.</Empty>
    );
  }
  const s5f = cashSum(all, 'fiiNet', 5);
  const s20f = cashSum(all, 'fiiNet', 20);
  const s5d = cashSum(all, 'diiNet', 5);
  const s20d = cashSum(all, 'diiNet', 20);
  const short = rows.length < days && all.length < days;
  return (
    <div className="space-y-3">
      <section aria-label="Cash summary" className="card grid grid-cols-2 gap-2 p-3 text-sm md:grid-cols-4">
        <div>
          <div className="text-xs text-slate-600 dark:text-slate-400">
            Latest FII net ({latest ? fmtDate(latest.date) : '—'})
          </div>
          <div className="num font-semibold">{fmtCr(latest?.fiiNet)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-600 dark:text-slate-400">Latest DII net</div>
          <div className="num font-semibold">{fmtCr(latest?.diiNet)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-600 dark:text-slate-400">5 and 20 days, FII</div>
          <div className="num">
            {fmtSigned(s5f.sum, 0)} / {fmtSigned(s20f.sum, 0)} Cr{' '}
            <span className="text-xs text-slate-600 dark:text-slate-400">({s20f.n} days)</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-600 dark:text-slate-400">5 and 20 days, DII</div>
          <div className="num">
            {fmtSigned(s5d.sum, 0)} / {fmtSigned(s20d.sum, 0)} Cr{' '}
            <span className="text-xs text-slate-600 dark:text-slate-400">({s20d.n} days)</span>
          </div>
        </div>
        <div className="col-span-2 md:col-span-4 text-xs text-slate-600 dark:text-slate-300">
          Streaks: FII {streakLabel(all, 'fiiNet')}; DII {streakLabel(all, 'diiNet')}. Collecting since{' '}
          {fmtDate(since)}.{short && ' History is shorter than the selected range.'}
        </div>
      </section>
      <section aria-label="FII and DII cash" className="card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <h2 className="mr-2 text-sm font-semibold">FII and DII net, daily and cumulative</h2>
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
              onClick={() => onRange(r.id)}
              className={`chip ${range === r.id ? 'bg-blue-600 text-white' : ''}`}
            >
              {r.id}
            </button>
          ))}
        </div>
        <EChart option={cashOption(rows, p, false)} height={320} ariaLabel="FII and DII cash chart" />
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Cumulative lines run from the first collected day. A day with no record is left empty, never
          interpolated.
        </p>
      </section>
      <section aria-label="Monthly cash totals" className="card p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Monthly net (Rs Cr)</h2>
          <CsvButton
            disabled={monthly.length === 0}
            onClick={() =>
              exportCsv(
                'institutions-cash-monthly',
                monthly[monthly.length - 1]?.month ?? 'none',
                ['Month', 'FII net Cr', 'DII net Cr', 'Days'],
                monthly.map((m) => [m.month, m.fiiNet, m.diiNet, m.days]),
              )
            }
          />
        </div>
        <div className="max-h-72 overflow-auto" tabIndex={0}>
          <table className="num w-full text-sm">
            <thead className="text-xs text-slate-600 dark:text-slate-400">
              <tr className="text-right">
                <th className="py-1 text-left font-medium">Month</th>
                <th className="font-medium">FII net</th>
                <th className="font-medium">DII net</th>
                <th className="font-medium">Days</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month} className="border-t border-slate-100 text-right dark:border-slate-800">
                  <td className="py-1 text-left">{m.month}</td>
                  <td>{fmtSigned(m.fiiNet, 0)}</td>
                  <td>{fmtSigned(m.diiNet, 0)}</td>
                  <td>{m.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DerivTab() {
  const part = useParticipants();
  const dark = useDark();
  const p = palette(dark);
  if (part.error) return <ErrorBox message={part.error} />;
  if (!part.data) return <Skeleton height={420} />;
  const oi = part.data.oi;
  const vol = part.data.vol;
  const dates = [...new Set(oi.map((r) => r.date))].sort();
  const latest = dates[dates.length - 1];
  const prev = dates[dates.length - 2];
  const at = (d: string | undefined, who: string) => oi.find((r) => r.date === d && r.participant === who);
  const fiiPct = latest ? participantLongPct(at(latest, 'FII') ?? { futIdxLong: 0, futIdxShort: 0 }) : null;
  const pctSeries = oi.filter((r) => r.participant === 'FII').map((r) => participantLongPct(r));
  const within = pctSeries.filter((v): v is number => v !== null);
  const lower = within.filter((v) => fiiPct !== null && v < fiiPct).length;
  return (
    <div className="space-y-3">
      <section aria-label="Latest positioning" className="card overflow-x-auto p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Latest day, {latest ? fmtDate(latest) : '—'}</h2>
          <CsvButton
            onClick={() =>
              exportCsv(
                'institutions-positioning',
                latest ?? 'none',
                [
                  'Participant',
                  'Index futures net',
                  'Change vs previous day',
                  'Index calls net',
                  'Index puts net',
                ],
                (['FII', 'DII', 'Pro', 'Client'] as const).map((w) => {
                  const r = at(latest, w);
                  const q = at(prev, w);
                  const net = r ? r.futIdxLong - r.futIdxShort : null;
                  const chg = r && q ? net! - (q.futIdxLong - q.futIdxShort) : null;
                  return [
                    w,
                    net,
                    chg,
                    r ? r.optIdxCallLong - r.optIdxCallShort : null,
                    r ? r.optIdxPutLong - r.optIdxPutShort : null,
                  ];
                }),
              )
            }
          />
        </div>
        <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
          Contracts. Rough: contract counts, not delta-adjusted. FII index futures long share is{' '}
          {fmtPct(fiiPct, 1)}, higher than on {lower} of {within.length} days in the stored history.
        </p>
        <table className="num w-full min-w-[480px] text-sm">
          <thead className="text-xs text-slate-600 dark:text-slate-400">
            <tr className="text-right">
              <th className="py-1 text-left font-medium">Participant</th>
              <th className="font-medium">Index futures net</th>
              <th className="font-medium">Change vs previous day</th>
              <th className="font-medium">Index calls net</th>
              <th className="font-medium">Index puts net</th>
              <th className="font-medium">Rough options bias</th>
            </tr>
          </thead>
          <tbody>
            {(['FII', 'DII', 'Pro', 'Client'] as const).map((w) => {
              const r = at(latest, w);
              const q = at(prev, w);
              const net = r ? r.futIdxLong - r.futIdxShort : null;
              const chg = r && q ? net! - (q.futIdxLong - q.futIdxShort) : null;
              const callNet = r ? r.optIdxCallLong - r.optIdxCallShort : null;
              const putNet = r ? r.optIdxPutLong - r.optIdxPutShort : null;
              return (
                <tr key={w} className="border-t border-slate-100 text-right dark:border-slate-800">
                  <td className="py-1 text-left">{w}</td>
                  <td>{fmtInt(net)}</td>
                  <td>{fmtSigned(chg, 0)}</td>
                  <td>{fmtInt(callNet)}</td>
                  <td>{fmtInt(putNet)}</td>
                  <td>{callNet !== null && putNet !== null ? fmtInt(callNet - putNet) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section aria-label="FII index futures long share" className="card p-3">
        <h2 className="mb-1 flex items-center gap-1 text-sm font-semibold">
          FII index futures, long share
          <Tip label={<span className="chip">?</span>}>
            The shaded band is this series' own 10th to 90th percentile in the stored history, so it shows
            where today's position sits in its own range. It is descriptive and not a forecast.
          </Tip>
        </h2>
        <EChart option={fiiLongPctOption(oi, p)} height={260} ariaLabel="FII index futures long share" />
      </section>
      <section aria-label="Net index futures by participant" className="card p-3">
        <h2 className="mb-1 text-sm font-semibold">Net index futures by participant (contracts)</h2>
        <EChart
          option={netIndexFuturesOption(oi, p)}
          height={280}
          ariaLabel="Net index futures by participant"
        />
      </section>
      <section aria-label="Volume share" className="card p-3">
        <h2 className="mb-1 text-sm font-semibold">Share of index-futures volume</h2>
        <EChart
          option={volumeShareOption(vol as ParticipantRow[], p)}
          height={280}
          ariaLabel="Volume share"
        />
      </section>
    </div>
  );
}

function S7Tab() {
  const deriv = useFiiDeriv();
  const dark = useDark();
  const p = palette(dark);
  if (deriv.error) return <ErrorBox message={deriv.error} />;
  if (!deriv.data) return <Skeleton height={420} />;
  const rows: FiiDerivRow[] = deriv.data;
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const date = dates[dates.length - 1];
  if (!date) return <Empty>No FII derivatives statistics stored yet.</Empty>;
  const day = rows.filter((r) => r.date === date && r.level === 'total');
  return (
    <div className="space-y-3">
      <section aria-label="FII derivatives on the latest day" className="card overflow-x-auto p-3">
        <h2 className="mb-1 text-sm font-semibold">Net bought value by category, {fmtDate(date)} (Rs Cr)</h2>
        <EChart
          option={fiiDerivNetOption(rows, date, p)}
          height={280}
          ariaLabel="FII derivatives net bought value"
        />
        <div className="mt-2 flex justify-end">
          <CsvButton
            disabled={day.length === 0}
            onClick={() =>
              exportCsv(
                'institutions-fii-derivatives',
                date,
                ['Category', 'Bought contracts', 'Bought Cr', 'Sold Cr', 'OI Cr'],
                day.map((r) => [r.category, r.buyContracts, r.buyAmtCr, r.sellAmtCr, r.oiAmtCr]),
              )
            }
          />
        </div>
        <table className="num mt-2 w-full min-w-[480px] text-sm">
          <thead className="text-xs text-slate-600 dark:text-slate-400">
            <tr className="text-right">
              <th className="py-1 text-left font-medium">Category</th>
              <th className="font-medium">Bought contracts</th>
              <th className="font-medium">Bought Cr</th>
              <th className="font-medium">Sold Cr</th>
              <th className="font-medium">OI Cr</th>
            </tr>
          </thead>
          <tbody>
            {day.map((r) => (
              <tr key={r.category} className="border-t border-slate-100 text-right dark:border-slate-800">
                <td className="py-1 text-left">{r.category}</td>
                <td>{fmtInt(r.buyContracts)}</td>
                <td>{fmtNum(r.buyAmtCr, 2)}</td>
                <td>{fmtNum(r.sellAmtCr, 2)}</td>
                <td>{fmtNum(r.oiAmtCr, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-label="Open interest value trend" className="card p-3">
        <h2 className="mb-1 text-sm font-semibold">Open interest value, by category (Rs Cr)</h2>
        <EChart
          option={fiiDerivOiOption(rows, p)}
          height={280}
          ariaLabel="FII derivatives open interest value"
        />
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Statistics as NSE publishes them for each trading day (totals across the market, not per stock).
          Named deals per stock are on the <AppLink to="/deals">Deals page</AppLink>.
        </p>
      </section>
    </div>
  );
}
