import { deliveryClass, priceClass } from '../charts/theme';
import type { Bucket, DailyRow, SignalCode } from '../types/data';
import {
  fmtCr,
  fmtInt,
  fmtSigned,
  fmtNum,
  fmtPct,
  fmtPctChg,
  fmtPp,
  fmtPrice,
  fmtQty,
  fmtRatio,
} from './format';
import { SIGNAL_LABEL } from './signals';

/** A Screener row: one daily row joined with its universe row. */
export type ScreenRow = DailyRow & {
  name: string;
  sector: string;
  mcapCr: number | null;
  bucket: Bucket | null;
  /** Close minus previous close, ₹. */
  chg: number | null;
};

/** What every Screener row type (day or range) provides for the shared table. */
export interface RowLike {
  sym: string;
  flags?: number;
  signal?: SignalCode | null;
  etf?: boolean;
  bucket?: Bucket | null;
  caWarn?: boolean;
}

export interface ColumnSpec<R = ScreenRow> {
  key: keyof R & string;
  label: string;
  tip: string;
  width: number;
  align?: 'left' | 'right';
  /** Special cell renderers handled by the table: symbol link, signal badge, flag chips, ⚠ marker. */
  kind?: 'sym' | 'signal' | 'flags' | 'warn';
  /** Display text. */
  fmt: (r: R) => string;
  /** CSS colour class (price green/red, delivery blue/orange). */
  tone?: (r: R) => string;
  /** Plain value for CSV export (defaults to the raw field). */
  csv?: (r: R) => string | number | null;
}

export const numCol = <R>(
  k: keyof R & string,
  label: string,
  tip: string,
  width: number,
  f: (v: number | null) => string,
  tone?: (v: number | null) => string,
): ColumnSpec<R> => ({
  key: k,
  label,
  tip,
  width,
  align: 'right',
  fmt: (r) => f(r[k] as number | null),
  tone: tone ? (r) => tone(r[k] as number | null) : undefined,
});

const num = (
  k: keyof ScreenRow & string,
  label: string,
  tip: string,
  width: number,
  f: (v: number | null) => string,
  tone?: (v: number | null) => string,
): ColumnSpec => numCol<ScreenRow>(k, label, tip, width, f, tone);

export const COLUMNS: ColumnSpec[] = [
  {
    key: 'sym',
    kind: 'sym',
    label: 'Symbol',
    tip: 'NSE symbol. Click to open the stock page.',
    width: 120,
    fmt: (r) => r.sym,
  },
  { key: 'name', label: 'Name', tip: 'Company name', width: 200, fmt: (r) => r.name },
  {
    key: 'sector',
    label: 'Sector',
    tip: 'Sector from the Total Market index file, else Unclassified',
    width: 170,
    fmt: (r) => r.sector,
  },
  num('mcapCr', 'Mkt cap', 'Market capitalisation, ₹ Cr', 110, fmtCr),
  {
    key: 'bucket',
    label: 'Cap',
    tip: 'Cap bucket: Large (rank 1-100), Mid (101-250), Small (251-500), Micro (501+)',
    width: 56,
    fmt: (r) => r.bucket ?? '—',
  },
  {
    key: 'series',
    label: 'Series',
    tip: 'EQ, or BE/BZ (trade-for-trade: delivery % is not meaningful)',
    width: 64,
    fmt: (r) => r.series,
  },
  num('open', 'Open', 'Open price, ₹', 84, fmtPrice),
  num('high', 'High', 'High price, ₹', 84, fmtPrice),
  num('low', 'Low', 'Low price, ₹', 84, fmtPrice),
  num('prevClose', 'Prev close', 'Previous close, ₹', 90, fmtPrice),
  num('close', 'Close', 'Close price, ₹', 90, fmtPrice),
  num('chg', 'Change (₹)', 'Close minus previous close, ₹', 90, fmtSigned, priceClass),
  num('vwap', 'VWAP', 'Volume-weighted average price, ₹', 84, fmtPrice),
  num('vol', 'Volume', 'Traded quantity (shares)', 90, fmtQty),
  num('turnoverCr', 'Turnover', 'Traded value, ₹ Cr', 96, fmtCr),
  num('trades', 'Trades', 'Number of trades', 80, fmtInt),
  num('delivQty', 'Deliv qty', 'Delivered quantity (shares)', 90, fmtQty),
  num('delivPct', 'Deliv %', 'Delivery % = delivered / traded quantity', 76, (v) => fmtPct(v)),
  num('delivValCr', 'Deliv value', 'Delivery value, ₹ Cr = delivered qty x VWAP', 100, fmtCr),
  num('delivValAvg5', 'Dv avg 5D', 'Average delivery value over the prior 5 days, ₹ Cr', 100, fmtCr),
  num('delivValAvg20', 'Dv avg 20D', 'Average delivery value over the prior 20 days, ₹ Cr', 104, fmtCr),
  num('delivValAvg50', 'Dv avg 50D', 'Average delivery value over the prior 50 days, ₹ Cr', 104, fmtCr),
  num('delivPctAvg20', 'Deliv % 20D', 'Value-weighted delivery % over the prior 20 days', 92, (v) =>
    fmtPct(v),
  ),
  num('volAvg20', 'Vol avg 20D', 'Average traded quantity over the prior 20 days', 96, fmtQty),
  num('turnoverAvg20Cr', 'Turn avg 20D', 'Average turnover over the prior 20 days, ₹ Cr', 104, fmtCr),
  num('tradeSizeRatio', 'Trade size', 'Average trade size vs its prior 20-day mean', 84, fmtRatio),
  num('spike', 'Spike', 'Delivery value / its prior 20-day average', 70, fmtRatio, (v) =>
    v === null ? '' : v >= 1 ? deliveryClass(1) : deliveryClass(-1),
  ),
  num(
    'delivPctDiff',
    'Deliv % diff',
    'Delivery % minus its prior 20-day average, in percentage points',
    96,
    fmtPp,
    deliveryClass,
  ),
  num('relVol', 'Rel vol', 'Traded quantity / its prior 20-day average', 70, fmtRatio),
  num('ret1', 'Change (%)', 'Close vs previous close, %', 84, (v) => fmtPctChg(v, 2), priceClass),
  num('clv', 'CLV', 'Close location in the day’s range: +1 closed at the high, -1 at the low', 66, (v) =>
    fmtNum(v),
  ),
  num('vwapGap', 'VWAP gap', 'Close vs VWAP', 84, (v) => fmtPctChg(v, 2), priceClass),
  num('delivPctZ60', 'Z 60D', 'Delivery % z-score vs the prior 60 days', 66, (v) => fmtNum(v)),
  num('delivPctPctile', 'Pctile', 'Percentile of today’s delivery % among the last 250 days', 66, (v) =>
    fmtNum(v, 0),
  ),
  num('streak', 'Streak', 'Consecutive days above (+) or below (-) the 20-day average delivery %', 66, (v) =>
    v === null ? '—' : v > 0 ? `+${v}` : String(v).replace('-', '−'),
  ),
  {
    key: 'signal',
    kind: 'signal',
    label: 'Signal',
    tip: 'Describes what happened on the day; it does not predict anything.',
    width: 190,
    fmt: (r) => (r.signal ? SIGNAL_LABEL[r.signal] : '—'),
    csv: (r) => (r.signal ? SIGNAL_LABEL[r.signal] : null),
  },
  {
    key: 'flags',
    kind: 'flags',
    label: 'Flags',
    tip: 'Context flags (corporate action, deals, circuit, 52-week break, ...)',
    width: 260,
    fmt: (r) => String(r.flags),
  },
  num('futOi', 'Fut OI', 'Futures open interest (Phase 5)', 90, fmtQty),
  num('futOiChgPct', 'Fut OI chg', 'Futures OI change (Phase 5)', 90, (v) => fmtPctChg(v)),
  {
    key: 'buildup',
    label: 'Build-up',
    tip: 'F&O build-up (Phase 5)',
    width: 80,
    fmt: (r) => r.buildup ?? '—',
  },
  num('pcr', 'PCR', 'Put-call ratio (Phase 5)', 66, (v) => fmtNum(v)),
];

export const COLUMN_BY_KEY = new Map<string, ColumnSpec>(COLUMNS.map((c) => [c.key as string, c]));

export const DEFAULT_COLUMNS: string[] = [
  'sym',
  'prevClose',
  'close',
  'chg',
  'ret1',
  'turnoverCr',
  'delivPct',
  'delivPctAvg20',
  'delivPctDiff',
  'delivValCr',
  'spike',
  'signal',
  'flags',
];

/** Column set saved by builds before the price columns (localStorage key dv.cols). */
export const COLS_KEY = 'dv.cols.v2';
export const OLD_COLS_KEY = 'dv.cols';
const PRICE_BLOCK = ['prevClose', 'close', 'chg', 'ret1'];

/**
 * Merges the price columns into a column set saved before they existed: Prev close, Close, Change (₹) and Change (%)
 * go together right after the symbol; every other saved column keeps its place.
 */
export function migrateColumns(saved: readonly string[]): string[] {
  const rest = saved.filter((c) => c !== 'sym' && !PRICE_BLOCK.includes(c));
  return ['sym', ...PRICE_BLOCK, ...rest];
}

export function csvEscape(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<R>(rows: readonly R[], cols: readonly ColumnSpec<R>[]): string {
  const head = cols.map((c) => csvEscape(c.label)).join(',');
  const body = rows.map((r) =>
    cols.map((c) => csvEscape(c.csv ? c.csv(r) : (r[c.key] as string | number | null))).join(','),
  );
  return [head, ...body].join('\n');
}
