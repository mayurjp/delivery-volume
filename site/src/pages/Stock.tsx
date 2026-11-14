import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { calendarOption, stockChartOption } from '../charts/options';
import { dealFlowBarsOption } from '../charts/deals';
import { barHolding, barSpecOf, baselineLabel, periodChartOption, periodTitle } from '../charts/periods';
import { FootprintCard, PeriodSummary, rangeSpanText } from '../components/PeriodPanels';
import { aggregatePeriods, aggregateRange, skipSet } from '../lib/aggregate';
import { DEALS_CAVEAT, HISTORY_GAP_NOTE, dealChip, flowsFromSymbol, monthlyFlows } from '../lib/deals';
import { dataClient } from '../lib/dataClient';
import { footprintRows, priorWindow } from '../lib/footprint';
import { periodSignalHistory } from '../lib/signalPerf';
import EChart from '../charts/EChart';
import { OwnershipSection } from '../components/Ownership';
import { FoSection } from '../components/FoPane';
import { deliveryClass, palette, priceClass } from '../charts/theme';
import {
  AppLink,
  Empty,
  ErrorBox,
  EtfBadge,
  FlagIcons,
  SignalBadge,
  Skeleton,
  Tip,
  TrailButton,
} from '../components/ui';
import { BUCKET_LABEL } from '../lib/labels';
import {
  fmtCr,
  fmtDate,
  fmtNum,
  fmtPct,
  fmtPctChg,
  fmtPp,
  fmtPrice,
  fmtQty,
  fmtRatio,
  fmtSigned,
} from '../lib/format';
import { useApp, useAsync, useDaily, useGlobalState, useSymbol, useTimeframe } from '../lib/hooks';
import { stockStats } from '../lib/metrics';
import { useDark } from '../lib/theme';
import { toggleWatch, useWatchlist } from '../lib/watchlist';
import { exportCsv } from '../lib/csv';
import { CsvButton } from '../components/ui';
import type { Bucket, SignalCode, UniverseRow } from '../types/data';

const WINDOWS: { label: string; n: number }[] = [
  { label: '1M', n: 21 },
  { label: '3M', n: 63 },
  { label: '6M', n: 126 },
  { label: '1Y', n: 252 },
];

function useMobile(): boolean {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

function NotFound({ sym }: { sym: string }) {
  const { universe } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState(sym);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n
      ? universe
          .filter((u) => u.sym.toLowerCase().includes(n) || u.name.toLowerCase().includes(n))
          .slice(0, 12)
      : [];
  }, [q, universe]);
  return (
    <div className="card mx-auto max-w-md space-y-3 p-4">
      <h1 className="text-lg font-semibold">No stock found for &ldquo;{sym}&rdquo;</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        It may be delisted, an SME stock (not covered), or a different symbol. Search by symbol or name.
      </p>
      <input
        autoFocus
        aria-label="Search symbol or name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) =>
          e.key === 'Enter' && matches[0] && nav(`/stock/${encodeURIComponent(matches[0].sym)}`)
        }
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <ul className="text-sm">
        {matches.map((u) => (
          <li key={u.sym}>
            <AppLink
              to={`/stock/${encodeURIComponent(u.sym)}`}
              className="block py-1 text-blue-700 hover:underline dark:text-blue-300"
            >
              {u.sym} <EtfBadge show={u.etf} />{' '}
              <span className="text-slate-500 dark:text-slate-400">{u.name}</span>
            </AppLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Header({ u, rows }: { u: UniverseRow; rows: ReturnType<typeof useSymbol>['data'] }) {
  const { meta } = useApp();
  const watch = useWatchlist();
  const starred = watch.includes(u.sym);
  const last = rows?.rows[rows.rows.length - 1];
  const prev = rows?.rows[rows.rows.length - 2];
  // exact previous close and change come from the day's daily file; the symbol file only has closes
  const dailyRows = useDaily(meta.latestDate, meta.latestDate);
  const day =
    last && last.date === meta.latestDate ? dailyRows.data?.find((d) => d.sym === u.sym) : undefined;
  const prevClose = day?.prevClose ?? prev?.close ?? null;
  const ret = day?.ret1 ?? (last?.close && prev?.close ? (last.close / prev.close - 1) * 100 : null);
  const chg = last?.close != null && prevClose !== null ? last.close - prevClose : null;
  const idx = meta.indices.filter((_, i) => (u.idx & (2 ** i)) !== 0 && meta.indices[i] !== 'TOTALMARKET');
  const diff =
    last && last.delivPct !== null && last.delivPctAvg20 !== null ? last.delivPct - last.delivPctAvg20 : null;
  return (
    <section aria-label="Summary" className="card space-y-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {u.sym}
            <EtfBadge show={u.etf} />
            <button
              type="button"
              aria-pressed={starred}
              aria-label={starred ? `Remove ${u.sym} from watchlist` : `Add ${u.sym} to watchlist`}
              onClick={() => toggleWatch(u.sym)}
              className="text-xl leading-none text-amber-500"
            >
              {starred ? '★' : '☆'}
            </button>
          </h1>
          <p className="truncate text-sm text-slate-600 dark:text-slate-300">{u.name}</p>
          <TrailButton sym={u.sym} className="mt-2" />
        </div>
        <div className="num text-right">
          <div className="text-xl font-semibold">{fmtPrice(last?.close)}</div>
          <div className={`text-sm ${priceClass(ret)}`}>
            {fmtSigned(chg)} ({fmtPctChg(ret, 2)})
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Prev close {fmtPrice(prevClose)}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="chip">{u.sector}</span>
        {u.bucket && <span className="chip">{BUCKET_LABEL[u.bucket as Bucket]}</span>}
        {u.mcapCr !== null && (
          <span className="chip num">
            {fmtCr(u.mcapCr)}
            {u.mcapEstimated ? ' (est.)' : ''}
          </span>
        )}
        {idx.map((i) => (
          <span key={i} className="chip">
            {i}
          </span>
        ))}
      </div>
      {last && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            Delivery <b className="num">{fmtPct(last.delivPct)}</b>{' '}
            <span className="text-slate-500 dark:text-slate-400">
              (20D avg {fmtPct(last.delivPctAvg20)},{' '}
            </span>
            <span className={`num ${deliveryClass(diff)}`}>{fmtPp(diff)}</span>
            <span className="text-slate-500 dark:text-slate-400">)</span>
          </span>
          <span>
            Spike <b className={`num ${deliveryClass((last.spike ?? 1) - 1)}`}>{fmtRatio(last.spike)}</b>
          </span>
          <SignalBadge signal={last.signal} bucket={u.bucket} />
          <FlagIcons flags={last.flags} />
          <span className="text-xs text-slate-500 dark:text-slate-400">{fmtDate(last.date)}</span>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-slate-50 p-2 dark:bg-slate-800/60" title={hint}>
      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="num truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

export default function Stock() {
  const { sym = '' } = useParams();
  const { universe, bySym } = useApp();
  const u = useMemo(() => {
    const s = decodeURIComponent(sym).toUpperCase();
    return bySym.get(s) ?? universe.find((x) => x.aliases.includes(s)) ?? null;
  }, [sym, bySym, universe]);
  const data = useSymbol(u ? u.f : null);
  const dark = useDark();
  const mobile = useMobile();
  const [win, setWin] = useState(126);
  const { meta } = useApp();
  const { state: tfState } = useTimeframe();
  const { date: globalDate } = useGlobalState();
  const spec = useMemo(() => barSpecOf(tfState), [tfState]);
  const custom = tfState.tf === 'r';
  const periodsDoc = useAsync(tfState.tf !== 'd' ? 'periods' : null, () => dataClient.periods());
  const periodPerf = useAsync(tfState.tf === 'w' || tfState.tf === 'm' ? 'signalPerfPeriods' : null, () =>
    dataClient.signalPerfPeriods(),
  );

  useEffect(() => {
    if (u) document.title = `${u.sym} – Delivery Volume`;
    return () => {
      document.title = 'Delivery Volume';
    };
  }, [u]);

  const pal = palette(dark);
  const rows = data.data?.rows;
  const chart = useMemo(
    () =>
      data.data
        ? stockChartOption(
            data.data.rows,
            data.data.file.corpActions,
            pal,
            mobile,
            undefined,
            data.data.file.deals,
          )
        : null,
    [data.data, pal, mobile],
  );
  const periodRows = useMemo(
    () =>
      spec && data.data && periodsDoc.data && u
        ? aggregatePeriods(data.data.rows, spec, meta.tradingDays, periodsDoc.data.config, {
            etf: u.etf,
            sym: u.sym,
          })
        : null,
    [spec, data.data, periodsDoc.data, meta.tradingDays, u],
  );
  const periodChart = useMemo(
    () =>
      spec && periodRows && periodRows.length > 0 && periodsDoc.data
        ? periodChartOption(periodRows, spec, pal, { mobile, cfg: periodsDoc.data.config })
        : null,
    [spec, periodRows, periodsDoc.data, pal, mobile],
  );
  const summaryRow = useMemo(
    () => (periodRows ? barHolding(periodRows, globalDate) : null),
    [periodRows, globalDate],
  );
  // custom range: one aggregate over from..to and the equal-length window before it
  const rangeInfo = useMemo(() => {
    if (!custom || !rows || !tfState.from || !tfState.to) return null;
    const lo = tfState.from <= tfState.to ? tfState.from : tfState.to;
    const hi = tfState.from <= tfState.to ? tfState.to : tfState.from;
    const skip = periodsDoc.data ? skipSet(periodsDoc.data.config, u?.sym) : undefined;
    const cur = aggregateRange(rows, lo, hi, skip);
    const pw = priorWindow(meta.tradingDays, lo, hi);
    const prev = pw ? aggregateRange(rows, pw.a, pw.b, skip) : null;
    return { lo, hi, cur, pw, prev };
  }, [custom, rows, tfState.from, tfState.to, meta.tradingDays, periodsDoc.data, u?.sym]);
  const rangeChart = useMemo(
    () =>
      rangeInfo?.cur && periodsDoc.data
        ? periodChartOption([rangeInfo.cur], { kind: 'n', n: rangeInfo.cur.daysIn }, pal, {
            mobile,
            cfg: periodsDoc.data.config,
            zoom: { start: 0, end: 100 },
          })
        : null,
    [rangeInfo, periodsDoc.data, pal, mobile],
  );
  const dailyHighlighted = useMemo(
    () =>
      data.data && rangeInfo
        ? stockChartOption(
            data.data.rows,
            data.data.file.corpActions,
            pal,
            mobile,
            {
              a: rangeInfo.lo,
              b: rangeInfo.hi,
            },
            data.data.file.deals,
          )
        : null,
    [data.data, rangeInfo, pal, mobile],
  );
  const cal = useMemo(() => (rows ? calendarOption(rows, pal) : null), [rows, pal]);
  const stats = useMemo(() => (rows ? stockStats(rows, win) : null), [rows, win]);
  const flowMonths = useMemo(
    () => monthlyFlows(flowsFromSymbol(sym, data.data?.file.dealFlows), null),
    [sym, data.data],
  );

  if (!u) return <NotFound sym={decodeURIComponent(sym)} />;
  if (data.error) return <ErrorBox message={data.error} />;

  const last30 = rows ? rows.slice(-30).reverse() : [];
  const corp = data.data?.file.corpActions ?? [];
  const deals = data.data?.file.deals ?? [];
  const thin = rows !== undefined && rows !== null && rows.filter((r) => r.delivPct !== null).length < 10;

  return (
    <div className="space-y-3">
      <Header u={u} rows={data.data} />

      {spec ? (
        !periodsDoc.data ? (
          <Skeleton height={540} />
        ) : (
          <>
            {summaryRow && (
              <PeriodSummary
                row={summaryRow}
                title={periodTitle(spec, summaryRow)}
                baseline={baselineLabel(spec, periodsDoc.data.config)}
                bucket={u.bucket}
                history={
                  tfState.tf === 'w' || tfState.tf === 'm'
                    ? (periodSignalHistory(
                        periodPerf.data,
                        tfState.tf,
                        (summaryRow.signal as SignalCode | null) ?? null,
                        u.bucket,
                      ) ?? '')
                    : ''
                }
              />
            )}
            <section aria-label="Price, volume and delivery chart by period" className="card min-w-0 p-3">
              <h2 className="mb-1 text-sm font-semibold">
                Price, delivered volume and delivery % by{' '}
                {tfState.tf === 'w'
                  ? 'week'
                  : tfState.tf === 'm'
                    ? 'month'
                    : tfState.tf === 'q'
                      ? 'quarter'
                      : `${tfState.n}-day bar`}
              </h2>
              {periodRows && periodRows.length === 0 ? (
                <Empty>Not enough history yet</Empty>
              ) : periodChart ? (
                <EChart
                  option={periodChart}
                  height={mobile ? 540 : 620}
                  ariaLabel={`${u.sym} candlestick, delivered volume, delivery percent, spike and delivery balance per bar`}
                />
              ) : (
                <Skeleton height={mobile ? 540 : 620} />
              )}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Each bar is one period; a faded bar is still in progress. Prices are in the basis of the
                period end, so a split does not break the candles (a warning marker sits on those bars);
                volume and delivered quantity are plain sums. Bottom pane: spike (delivery value vs the
                baseline) and delivery balance (delivery value on up days / down days, capped at 10), both as
                ratios where 1 is normal or equal. Drag the slider or Ctrl + scroll to zoom.
              </p>
            </section>
          </>
        )
      ) : custom ? (
        <>
          {!tfState.from || !tfState.to ? (
            <section className="card p-3">
              <Empty>Pick a start and end date in the timeframe control to see a custom range.</Empty>
            </section>
          ) : !rows || !periodsDoc.data ? (
            <Skeleton height={320} />
          ) : !rangeInfo?.cur ? (
            <section className="card p-3">
              <Empty>Not enough history yet: no trading day in this range</Empty>
            </section>
          ) : (
            <>
              <FootprintCard
                rows={footprintRows(rangeInfo.cur, rangeInfo.prev)}
                rangeText={rangeSpanText(rangeInfo.lo, rangeInfo.hi, rangeInfo.cur.daysIn)}
                prevText={
                  rangeInfo.pw ? rangeSpanText(rangeInfo.pw.a, rangeInfo.pw.b, rangeInfo.pw.days) : null
                }
              />
              <section aria-label="The range as one bar" className="card min-w-0 p-3">
                <h2 className="mb-1 text-sm font-semibold">The range as one bar</h2>
                {rangeChart && (
                  <EChart
                    option={rangeChart}
                    height={mobile ? 420 : 460}
                    ariaLabel={`${u.sym} the custom range as one bar`}
                  />
                )}
              </section>
              <section aria-label="Price, volume and delivery chart" className="card min-w-0 p-3">
                <h2 className="mb-1 text-sm font-semibold">Daily bars, range shaded</h2>
                {dailyHighlighted && (
                  <EChart
                    option={dailyHighlighted}
                    height={mobile ? 460 : 540}
                    ariaLabel={`${u.sym} daily chart with the custom range shaded`}
                  />
                )}
              </section>
            </>
          )}
        </>
      ) : (
        <section aria-label="Price, volume and delivery chart" className="card min-w-0 p-3">
          <h2 className="mb-1 text-sm font-semibold">Price, delivered volume and delivery %</h2>
          {chart ? (
            <EChart
              option={chart}
              height={mobile ? 460 : 540}
              ariaLabel={`${u.sym} candlestick, delivered volume and delivery percent`}
            />
          ) : (
            <Skeleton height={mobile ? 460 : 540} />
          )}
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {mobile
              ? 'Drag the slider to zoom; tap the chart for values.'
              : 'Ctrl + scroll to zoom, drag to pan; hover for values.'}{' '}
            Dashed vertical lines mark corporate-action ex-dates. Volume is in shares and not adjusted for
            splits or bonuses; compare delivery value and delivery %, not raw quantity, across such dates.
          </p>
        </section>
      )}

      <section aria-label="Delivery statistics" className="card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Delivery statistics</h2>
          <div role="group" aria-label="Window" className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w.n}
                type="button"
                aria-pressed={win === w.n}
                className={`chip ${win === w.n ? 'bg-blue-600 text-white' : ''}`}
                onClick={() => setWin(w.n)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        {!stats ? (
          <Skeleton height={120} />
        ) : thin ? (
          <Empty>Not enough history yet (needs 10 trading days)</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Mean delivery %" value={fmtPct(stats.mean)} />
            <Stat label="Median delivery %" value={fmtPct(stats.median)} />
            <Stat label="Min / max" value={`${fmtPct(stats.min)} / ${fmtPct(stats.max)}`} />
            <Stat label="Std deviation" value={fmtPp(stats.std).replace('+', '')} />
            <Stat
              label="Days above 60%"
              value={String(stats.daysAbove60)}
              hint={`of ${stats.n} valid days`}
            />
            <Stat label="Avg turnover" value={fmtCr(stats.avgTurnoverCr)} />
            <Stat label="Avg delivery value" value={fmtCr(stats.avgDelivValCr)} />
            <Stat
              label="Today's percentile"
              value={stats.todayPercentile === null ? '—' : `${fmtNum(stats.todayPercentile, 0)}`}
              hint="Share of window days with delivery % at or below today's"
            />
            <Stat
              label="Longest above-average streak"
              value={`${stats.longestAboveAvgStreak} days`}
              hint="Consecutive days with delivery % above its prior 20-day average"
            />
            <Stat
              label="Corr. with next-day return"
              value={stats.corrNextDayRet === null ? '—' : fmtNum(stats.corrNextDayRet)}
              hint="Historical, descriptive: correlation of delivery % with the next day's close-to-close return, unadjusted for splits"
            />
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Historical and descriptive. Over {stats?.n ?? 0} valid delivery days in the window.
        </p>
      </section>

      {data.data && <OwnershipSection file={data.data.file} />}
      {data.data && <FoSection file={data.data.file} rows={data.data.rows} pal={pal} mobile={mobile} />}
      <section aria-label="Delivery calendar" className="card min-w-0 p-3">
        <h2 className="mb-1 text-sm font-semibold">Delivery % calendar</h2>
        <div className="overflow-x-auto" tabIndex={0}>
          <div style={{ minWidth: 860 }}>
            {cal ? (
              <EChart option={cal} height={230} ariaLabel="Calendar heat map of delivery percent" />
            ) : (
              <Skeleton height={230} />
            )}
          </div>
        </div>
      </section>

      <section aria-label="Last 30 days" className="card min-w-0 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Last 30 days</h2>
          <CsvButton
            disabled={last30.length === 0}
            onClick={() =>
              exportCsv(
                `stock-${sym}-last-30-days`,
                last30[0]?.date ?? 'none',
                [
                  'Date',
                  'Close',
                  'Return %',
                  'Volume',
                  'Deliv %',
                  'Deliv value Cr',
                  'Spike',
                  'Signal',
                  'Flags',
                ],
                last30.map((r, i, arr) => {
                  const prev = arr[i + 1] ?? rows?.[rows.length - 31];
                  const ret = r.close && prev?.close ? (r.close / prev.close - 1) * 100 : null;
                  return [
                    r.date,
                    r.close,
                    ret === null ? null : Number(ret.toFixed(2)),
                    r.vol,
                    r.delivPct,
                    r.delivValCr,
                    r.spike,
                    r.signal,
                    r.flags,
                  ];
                }),
              )
            }
          />
        </div>
        <div className="max-h-[480px] overflow-auto" tabIndex={0}>
          <table className="num w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-white text-xs text-slate-500 dark:bg-slate-900">
              <tr className="text-right">
                <th className="py-1 text-left font-medium">Date</th>
                <th className="font-medium">Close</th>
                <th className="font-medium">Return</th>
                <th className="font-medium">Volume</th>
                <th className="font-medium">Deliv %</th>
                <th className="font-medium">Deliv value</th>
                <th className="font-medium">Spike</th>
                <th className="pl-2 text-left font-medium">Signal</th>
              </tr>
            </thead>
            <tbody>
              {last30.map((r, i, arr) => {
                const prev = arr[i + 1] ?? rows?.[rows.length - 31];
                const ret = r.close && prev?.close ? (r.close / prev.close - 1) * 100 : null;
                return (
                  <tr key={r.date} className="border-t border-slate-100 text-right dark:border-slate-800">
                    <td className="py-1 text-left">{fmtDate(r.date)}</td>
                    <td>{fmtPrice(r.close)}</td>
                    <td className={priceClass(ret)}>{fmtPctChg(ret, 2)}</td>
                    <td>{fmtQty(r.vol)}</td>
                    <td>{fmtPct(r.delivPct)}</td>
                    <td>{fmtCr(r.delivValCr)}</td>
                    <td>{fmtRatio(r.spike)}</td>
                    <td className="pl-2 text-left">
                      <span className="inline-flex items-center gap-1">
                        <SignalBadge signal={r.signal} bucket={u.bucket} />
                        <FlagIcons flags={r.flags} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <section aria-label="Deals" className="card p-3">
          <h2 className="mb-1 flex items-center gap-1 text-sm font-semibold">
            Bulk and block deals
            <Tip label={<span className="chip">?</span>}>{DEALS_CAVEAT}</Tip>
          </h2>
          <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{HISTORY_GAP_NOTE}</p>
          {deals.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No bulk or block deals stored for this stock.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {[...deals]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((d, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-1">
                    <span className="num">{fmtDate(d.date)}</span>
                    <span className="chip">{dealChip(d)}</span>
                    {d.roundTrip && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        round trip, not counted
                      </span>
                    )}
                    {d.entityId ? (
                      <AppLink to={`/entity/${encodeURIComponent(d.entityId)}`}>
                        {d.entityName ?? d.client}
                      </AppLink>
                    ) : (
                      <span className="text-slate-600 dark:text-slate-300">{d.client}</span>
                    )}
                  </li>
                ))}
            </ul>
          )}
          <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Net via deals by month (Rs Cr)
          </h3>
          {flowMonths.months.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No deal flows for this stock.</p>
          ) : (
            <EChart
              option={dealFlowBarsOption(flowMonths, pal)}
              height={220}
              ariaLabel="Deal flows by month"
            />
          )}
        </section>
        <section aria-label="Corporate actions" className="card p-3">
          <h2 className="mb-1 flex items-center gap-1 text-sm font-semibold">
            Corporate actions
            <Tip label={<span className="chip">?</span>}>
              Ex-dates listed by NSE. Delivery can jump before record dates; splits and bonuses make raw
              prices and quantities non-comparable.
            </Tip>
          </h2>
          {corp.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No corporate actions recorded in the stored history.
            </p>
          ) : (
            <ul className="space-y-0.5 text-sm">
              {[...corp].reverse().map((c, i) => (
                <li key={i}>
                  <span className="num">{fmtDate(c.exDate)}</span> <span className="chip">{c.kind}</span>{' '}
                  <span className="text-slate-600 dark:text-slate-300">{c.purpose}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
