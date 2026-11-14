import { useMemo } from 'react';
import { deliveryClass, palette, priceClass } from '../charts/theme';
import { marketOption } from '../charts/options';
import EChart from '../charts/EChart';
import {
  AppLink,
  Empty,
  ErrorBox,
  EtfBadge,
  FlagIcons,
  Skeleton,
  Sparkline,
  TrailButton,
} from '../components/ui';
import { applyFilters } from '../lib/filters';
import { fmtCr, fmtDate, fmtInt, fmtPct, fmtPctChg, fmtPp, fmtRatio } from '../lib/format';
import { useApp, useDaily, useGlobalState, useMarket } from '../lib/hooks';
import { PRESET_BY_ID, runPreset, LIST_EXCLUDED } from '../lib/presets';
import { useDark } from '../lib/theme';
import { FLAG, type DailyRow, type Market } from '../types/data';

function Tile({
  label,
  value,
  sub,
  subClass = '',
  spark,
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  spark?: (number | null)[];
  hint?: string;
}) {
  return (
    <div className="card min-w-0 p-3" title={hint}>
      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="num mt-0.5 truncate text-lg font-semibold">{value}</div>
      <div className="flex items-end justify-between gap-1">
        <span className={`num min-w-0 break-words text-xs ${subClass}`}>{sub ?? ' '}</span>
        {spark && <Sparkline values={spark} width={64} height={22} label={`${label}, last 20 days`} />}
      </div>
    </div>
  );
}

function marketTiles(m: Market, date: string) {
  const g = m.groups['ALL'];
  if (!g) return null;
  const i = m.dates.indexOf(date);
  if (i < 0) return null;
  const last = (a: (number | null)[]) => a[i] ?? null;
  const tail = (a: (number | null)[]) => a.slice(Math.max(0, i - 19), i + 1);
  const prior = g.delivPctW.slice(Math.max(0, i - 20), i).filter((x): x is number => x !== null);
  const avg20 = prior.length ? prior.reduce((s, x) => s + x, 0) / prior.length : null;
  const pct = last(g.delivPctW);
  return { g, last, tail, pct, diff: pct !== null && avg20 !== null ? pct - avg20 : null };
}

interface CardSpec {
  id: string;
  title: string;
  note?: string;
  rows: DailyRow[];
}

function TopCard({ spec, bySym }: { spec: CardSpec; bySym: ReturnType<typeof useApp>['bySym'] }) {
  return (
    <section className="card min-w-0 p-3" aria-label={spec.title}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{spec.title}</h2>
        <AppLink
          to={`/screener?p=${spec.id}`}
          className="shrink-0 text-xs text-blue-700 hover:underline dark:text-blue-300"
        >
          View all
        </AppLink>
      </div>
      {spec.note && <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{spec.note}</p>}
      {spec.rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">Nothing matches today.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {spec.rows.map((r) => {
            const u = bySym.get(r.sym);
            return (
              <li key={r.sym}>
                <AppLink
                  to={`/stock/${encodeURIComponent(r.sym)}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{r.sym}</span>
                      <EtfBadge show={(r.flags & FLAG.etf) !== 0} />
                      <FlagIcons flags={r.flags} plain />
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {u?.sector}
                    </span>
                  </span>
                  <span className="num text-right text-xs leading-5">
                    <span className="block">
                      {r.close === null
                        ? '—'
                        : r.close.toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                      <span className={priceClass(r.ret1)}>{fmtPctChg(r.ret1, 2)}</span>
                    </span>
                    <span className="block text-slate-600 dark:text-slate-300">
                      {fmtPct(r.delivPct)}{' '}
                      <span className={deliveryClass((r.spike ?? 1) - 1)}>{fmtRatio(r.spike)}</span>
                    </span>
                  </span>
                </AppLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function Dashboard() {
  const { meta, bySym } = useApp();
  const { filters, date } = useGlobalState();
  const daily = useDaily(date, meta.latestDate);
  const market = useMarket();
  const dark = useDark();
  const pal = palette(dark);

  const filtered = useMemo(
    () =>
      daily.data
        ? applyFilters(daily.data, bySym, filters, { indices: meta.indices, watchlist: new Set() })
        : [],
    [daily.data, bySym, filters, meta.indices],
  );
  const cards: CardSpec[] = useMemo(() => {
    const top = (id: string) => runPreset(PRESET_BY_ID.get(id)!, filtered, bySym).slice(0, 10);
    const highs = filtered
      .filter((r) => (r.flags & FLAG.high52) !== 0 && (r.flags & LIST_EXCLUDED) === 0)
      .sort((a, b) => (b.spike ?? -1) - (a.spike ?? -1))
      .slice(0, 10);
    return [
      { id: 'spikes', title: 'Delivery spikes', rows: top('spikes') },
      { id: 'drops', title: 'Delivery drops', rows: top('drops') },
      { id: 'highpct', title: 'Highest delivery %', rows: top('highpct') },
      { id: 'acc', title: 'Up on heavy delivery', rows: top('acc') },
      { id: 'dis', title: 'Down on heavy delivery', rows: top('dis') },
      { id: 'value', title: 'Largest delivery value', rows: top('value') },
      {
        id: 'high52heavy',
        title: 'New 52-week highs, with delivery level',
        note: 'Each row shows delivery % and the spike vs its 20-day average.',
        rows: highs,
      },
    ];
  }, [filtered, bySym]);

  const t = market.data ? marketTiles(market.data, date) : null;
  const spikeCount = filtered.filter(
    (r) => (r.spike ?? 0) >= 2 && (r.flags & (FLAG.lowLiquidity | FLAG.newListing)) === 0,
  ).length;
  const fii = meta.sources['fii_dii_cash'];
  const collecting = `Collecting since ${fmtDate(fii?.collectingSince ?? meta.latestDate)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-3">
          <TrailButton />
          <p className="text-sm text-slate-500 dark:text-slate-400">{fmtDate(date)}</p>
        </div>
      </div>

      <section aria-label="Market summary" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {market.error ? (
          <div className="col-span-full">
            <ErrorBox message={market.error} />
          </div>
        ) : !t ? (
          Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={84} />)
        ) : (
          <>
            <Tile
              label="Market delivery %"
              value={fmtPct(t.pct)}
              sub={`${fmtPp(t.diff)} vs 20D avg`}
              subClass={deliveryClass(t.diff)}
              spark={t.tail(t.g.delivPctW)}
              hint="Value-weighted delivery % of all EQ stocks"
            />
            <Tile
              label="Delivery value"
              value={fmtCr(t.last(t.g.delivValCr))}
              spark={t.tail(t.g.delivValCr)}
            />
            <Tile label="Turnover" value={fmtCr(t.last(t.g.turnoverCr))} spark={t.tail(t.g.turnoverCr)} />
            <Tile
              label="Advances / declines"
              value={`${fmtInt(t.last(t.g.adv))} / ${fmtInt(t.last(t.g.dec))}`}
              sub={`${fmtInt(t.last(t.g.unch))} unchanged`}
              spark={t.tail(t.g.adv)}
            />
            <Tile
              label="FII net (cash)"
              value="—"
              sub={collecting}
              hint="Provisional FII cash-market flows are collected daily; history will appear in a later phase."
            />
            <Tile
              label="DII net (cash)"
              value="—"
              sub={collecting}
              hint="Provisional DII cash-market flows are collected daily; history will appear in a later phase."
            />
            <Tile
              label="Delivery spike ≥ 2×"
              value={fmtInt(daily.data ? spikeCount : t.last(t.g.spikeCount2x))}
              sub="stocks (filtered)"
            />
          </>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card min-w-0 p-3" aria-label="Market delivery percent chart">
          <h2 className="mb-1 text-sm font-semibold">Market delivery % and Nifty 50, 60 days</h2>
          {market.data ? (
            <EChart
              option={marketOption(market.data, pal)}
              height={240}
              ariaLabel="Market delivery percent with Nifty 50"
            />
          ) : (
            <Skeleton height={240} />
          )}
        </section>
        <section className="card min-w-0 p-3" aria-label="FII and DII net">
          <h2 className="mb-1 text-sm font-semibold">FII / DII net, last 20 days</h2>
          <div className="flex h-[240px] items-center justify-center text-center text-sm text-slate-500 dark:text-slate-400">
            {collecting}. The chart appears once the institutional history is built (a later phase).
          </div>
        </section>
      </div>

      {daily.error ? (
        <ErrorBox message={daily.error} />
      ) : daily.loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={420} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Empty>No stocks match the current filters.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <TopCard key={c.id} spec={c} bySym={bySym} />
          ))}
          <section className="card min-w-0 p-3" aria-label="Bulk and block deals">
            <h2 className="mb-2 text-sm font-semibold">Today&apos;s largest bulk/block deals</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Bulk and block deals are collected every day. This card (round trips excluded) arrives with the
              deals pages in a later phase.
            </p>
          </section>
        </div>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Delivery % shows how much of the day&apos;s trading ended in a change of ownership; it does not say
        whether buyers or sellers won. Lists exclude low-liquidity, trade-for-trade and newly listed stocks.
      </p>
    </div>
  );
}
