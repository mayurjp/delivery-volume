import type { PeriodRow } from '../lib/aggregate';
import { partialText } from '../lib/aggregate';
import { deliveryClass, priceClass } from '../charts/theme';
import { fmtCr, fmtPct, fmtPctChg, fmtPp, fmtRatio, fmtDate } from '../lib/format';
import type { FootRow } from '../lib/footprint';
import { DELIVERY_TRUTH, SIGNAL_LABEL, SIGNAL_MEANING } from '../lib/signals';
import type { Bucket, SignalCode } from '../types/data';
import { SignalBadge } from './ui';

const SIGNAL_CODES = new Set<string>(['ACC', 'DIS', 'ABS', 'SPU', 'SPD']);

function Item({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-slate-50 p-2 dark:bg-slate-800/60" title={hint}>
      <div className="truncate text-xs text-slate-600 dark:text-slate-400">{label}</div>
      <div className={`num truncate text-sm font-semibold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

/** Summary of the bar that holds the global date (08 section 5): return, delivery, spike, balance and the signal. */
export function PeriodSummary({
  row,
  title,
  baseline,
  bucket,
  history,
}: {
  row: PeriodRow;
  title: string;
  /** "10-week average" etc. */
  baseline: string;
  bucket: Bucket | null;
  /** Historical line for the signal tooltip; empty text hides it. */
  history: string;
}) {
  const signal = row.signal && SIGNAL_CODES.has(row.signal) ? (row.signal as SignalCode) : null;
  const part = partialText(row);
  return (
    <section aria-label="Period summary" className="card space-y-2 p-3" data-testid="period-summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {title}
          {part ? <span className="ml-2 font-normal text-slate-600 dark:text-slate-400">{part}</span> : null}
        </h2>
        {signal ? <SignalBadge signal={signal} bucket={bucket} history={history} /> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Item
          label={row.adjusted === 1 ? 'Return ⚠' : 'Return'}
          value={fmtPctChg(row.ret, 2)}
          tone={priceClass(row.ret)}
          hint={
            row.adjusted === 1 ? 'A split or bonus fell in this period: prices are split-adjusted' : undefined
          }
        />
        <Item
          label="Delivery %"
          value={fmtPct(row.delivPct)}
          hint={`${baseline} ${fmtPct(row.delivPctAvgN)}`}
        />
        <Item
          label={`Deliv % vs ${baseline}`}
          value={fmtPp(row.delivPctDiff)}
          tone={deliveryClass(row.delivPctDiff)}
        />
        <Item label="Delivery value" value={fmtCr(row.delivValCr)} />
        <Item
          label="Spike vs baseline"
          value={fmtRatio(row.spike)}
          tone={deliveryClass(row.spike === null ? null : row.spike - 1)}
          hint={`Delivery value / its ${baseline}`}
        />
        <Item
          label="Delivery balance"
          value={fmtRatio(row.delivBalance)}
          hint="Delivery value on up days / on down days in the period"
        />
      </div>
      {signal ? (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          <b>{SIGNAL_LABEL[signal]}.</b> {SIGNAL_MEANING[signal]} {DELIVERY_TRUTH}
        </p>
      ) : (
        <p className="text-xs text-slate-600 dark:text-slate-400">No signal for this bar.</p>
      )}
      {row.adjusted === 1 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          ⚠ A split or bonus fell in this period. Prices are split-adjusted; volume and delivered quantity are
          plain sums and not comparable across the date.
        </p>
      )}
    </section>
  );
}

/** Footprint card of a custom range against the window before it. */
export function FootprintCard({
  rows,
  rangeText,
  prevText,
}: {
  rows: FootRow[];
  rangeText: string;
  prevText: string | null;
}) {
  return (
    <section aria-label="Range footprint" className="card min-w-0 space-y-2 p-3" data-testid="footprint">
      <h2 className="text-sm font-semibold">Range footprint</h2>
      <table className="num w-full text-xs sm:text-sm">
        <thead className="text-slate-600 dark:text-slate-400">
          <tr className="text-right">
            <th className="py-1 text-left font-medium">&nbsp;</th>
            <th className="font-medium">Range</th>
            <th className="font-medium">Before</th>
            <th className="font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className="border-t border-slate-100 text-right dark:border-slate-800"
              title={r.hint}
            >
              <td className="py-1 text-left">
                {r.label}
                {r.warn ? (
                  <span
                    role="img"
                    aria-label="Prices are split-adjusted in this range"
                    title="A split or bonus fell in this range: prices are split-adjusted"
                    className="ml-1 text-amber-700 dark:text-amber-400"
                  >
                    ⚠
                  </span>
                ) : null}
              </td>
              <td>{r.cur}</td>
              <td>{r.prev}</td>
              <td>{r.change}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Range: {rangeText}. Before: {prevText ?? 'not enough earlier history for a window of the same length'}
        . Changes are signed: a percentage for sums and prices, percentage points for delivery % and return.
      </p>
    </section>
  );
}

export const rangeSpanText = (a: string, b: string, days: number) =>
  `${fmtDate(a)} to ${fmtDate(b)}, ${days} trading days`;
