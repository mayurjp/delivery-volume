import type { PeriodRow } from './aggregate';
import {
  DASH,
  fmtCr,
  fmtInt,
  fmtNum,
  fmtPct,
  fmtPctChg,
  fmtPp,
  fmtPrice,
  fmtRatio,
  fmtSigned,
} from './format';

/** Footprint card of a custom range on the stock page (08 section 5A): the range against the equal-length window before it. */

/** Trading days a..b inclusive on the market calendar. */
export function daysIn(tradingDays: readonly string[], a: string, b: string): string[] {
  return tradingDays.filter((d) => d >= a && d <= b);
}

/**
 * The window of the same number of market trading days that ends on the trading day before `a`.
 * Null when there are not enough earlier days (the window would be cut short) or the range holds no trading day.
 */
export function priorWindow(
  tradingDays: readonly string[],
  a: string,
  b: string,
): { a: string; b: string; days: number } | null {
  const inside = daysIn(tradingDays, a, b);
  if (inside.length === 0) return null;
  const i0 = tradingDays.indexOf(inside[0]!);
  const start = i0 - inside.length;
  if (start < 0) return null;
  return { a: tradingDays[start]!, b: tradingDays[i0 - 1]!, days: inside.length };
}

export interface FootRow {
  key: string;
  label: string;
  hint?: string;
  cur: string;
  prev: string;
  /** Signed change of the range against the window before it; a dash when either side is missing. */
  change: string;
  warn?: boolean;
}

const pctChange = (a: number | null, b: number | null): number | null =>
  a !== null && b !== null && b !== 0 ? (a / b - 1) * 100 : null;
const diff = (a: number | null, b: number | null): number | null => (a !== null && b !== null ? a - b : null);

const rs = (v: number | null) => (v === null ? DASH : `₹${fmtInt(v)}`);

/** Rows of the footprint card, formatted per the 04 section 7 rules. `prev` null shows dashes in the comparison. */
export function footprintRows(cur: PeriodRow, prev: PeriodRow | null): FootRow[] {
  const p = prev;
  const row = (
    key: string,
    label: string,
    c: string,
    pv: string,
    change: string,
    extra: Partial<FootRow> = {},
  ): FootRow => ({ key, label, cur: c, prev: p ? pv : DASH, change: p ? change : DASH, ...extra });
  return [
    row(
      'days',
      'Days',
      String(cur.days),
      String(p?.days ?? 0),
      diff(cur.days, p?.days ?? null) === null ? DASH : fmtSigned(cur.days - (p?.days ?? 0), 0),
      { hint: 'Trading days of this stock with a valid delivery figure' },
    ),
    row(
      'ret',
      'Return',
      fmtPctChg(cur.ret, 2),
      fmtPctChg(p?.ret ?? null, 2),
      fmtPp(diff(cur.ret, p?.ret ?? null)),
      {
        hint: 'Close of the last day vs the close before the first day, split-adjusted',
        warn: cur.adjusted === 1,
      },
    ),
    row(
      'high',
      'High',
      fmtPrice(cur.high),
      fmtPrice(p?.high ?? null),
      fmtPctChg(pctChange(cur.high, p?.high ?? null)),
    ),
    row(
      'low',
      'Low',
      fmtPrice(cur.low),
      fmtPrice(p?.low ?? null),
      fmtPctChg(pctChange(cur.low, p?.low ?? null)),
    ),
    row(
      'close',
      'Close',
      fmtPrice(cur.close),
      fmtPrice(p?.close ?? null),
      fmtPctChg(pctChange(cur.close, p?.close ?? null)),
    ),
    row(
      'clv',
      'Close location',
      fmtNum(cur.clv),
      fmtNum(p?.clv ?? null),
      diff(cur.clv, p?.clv ?? null) === null ? DASH : fmtSigned(cur.clv! - p!.clv!, 2),
      { hint: '+1 closed at the high of the range, -1 at the low' },
    ),
    row(
      'delivPct',
      'Delivery %',
      fmtPct(cur.delivPct),
      fmtPct(p?.delivPct ?? null),
      fmtPp(diff(cur.delivPct, p?.delivPct ?? null)),
      {
        hint: 'Value-weighted: delivery value / turnover',
      },
    ),
    row(
      'delivVal',
      'Delivery value',
      `${fmtCr(cur.delivValCr)}`,
      fmtCr(p?.delivValCr ?? null),
      fmtPctChg(pctChange(cur.delivValCr, p?.delivValCr ?? null), 0),
    ),
    row(
      'turnover',
      'Turnover',
      fmtCr(cur.turnoverCr),
      fmtCr(p?.turnoverCr ?? null),
      fmtPctChg(pctChange(cur.turnoverCr, p?.turnoverCr ?? null), 0),
    ),
    row(
      'ats',
      'Avg trade size',
      rs(cur.avgTradeSize),
      rs(p?.avgTradeSize ?? null),
      fmtPctChg(pctChange(cur.avgTradeSize, p?.avgTradeSize ?? null), 0),
      { hint: 'Turnover divided by number of trades' },
    ),
    row(
      'balance',
      'Delivery balance',
      fmtRatio(cur.delivBalance),
      fmtRatio(p?.delivBalance ?? null),
      diff(cur.delivBalance, p?.delivBalance ?? null) === null
        ? DASH
        : fmtSigned(cur.delivBalance! - p!.delivBalance!, 1),
      {
        hint: 'Delivery value on up days / delivery value on down days. Above 1 means more on days the price rose.',
      },
    ),
  ];
}
