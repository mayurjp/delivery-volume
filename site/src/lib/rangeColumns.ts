import { deliveryClass, priceClass } from '../charts/theme';
import { numCol, type ColumnSpec } from './columns';
import { fmtCr, fmtPct, fmtPctChg, fmtPp } from './format';
import type { RangeScreenRow } from './range';
import { SIGNAL_LABEL } from './signals';

/** Screener Range-mode columns: the 04 section 3 range fields. */
const n = (
  k: keyof RangeScreenRow & string,
  label: string,
  tip: string,
  width: number,
  f: (v: number | null) => string,
  tone?: (v: number | null) => string,
) => numCol<RangeScreenRow>(k, label, tip, width, f, tone);

export const RANGE_COLUMNS: ColumnSpec<RangeScreenRow>[] = [
  {
    key: 'sym',
    kind: 'sym',
    label: 'Symbol',
    tip: 'NSE symbol. Click to open the stock page.',
    width: 120,
    fmt: (r) => r.sym,
  },
  { key: 'name', label: 'Name', tip: 'Company name', width: 200, fmt: (r) => r.name },
  { key: 'sector', label: 'Sector', tip: 'Sector', width: 170, fmt: (r) => r.sector },
  n('mcapCr', 'Mkt cap', 'Market capitalisation, ₹ Cr', 110, fmtCr),
  { key: 'bucket', label: 'Cap', tip: 'Cap bucket', width: 56, fmt: (r) => r.bucket ?? '—' },
  n(
    'delivValChgPct',
    'Deliv value chg',
    'Average daily delivery value in the range vs the baseline',
    120,
    (v) => fmtPctChg(v, 0),
    deliveryClass,
  ),
  n(
    'delivPctChgPp',
    'Deliv % chg',
    'Value-weighted delivery % in the range minus the baseline, percentage points',
    100,
    fmtPp,
    deliveryClass,
  ),
  n(
    'ret',
    'Return',
    'Close at the end of the range vs the close before it (unadjusted)',
    90,
    (v) => fmtPctChg(v, 1),
    priceClass,
  ),
  {
    key: 'caWarn',
    kind: 'warn',
    label: 'CA',
    tip: 'A split or bonus ex-date falls in the range: the price return is not adjusted.',
    width: 44,
    fmt: (r) => (r.caWarn ? '⚠' : ''),
    csv: (r) => (r.caWarn ? 'corporate action in range' : ''),
  },
  {
    key: 'signal',
    kind: 'signal',
    label: 'Range signal',
    tip: 'Describes what happened over the range; it does not predict anything.',
    width: 190,
    fmt: (r) => (r.signal ? SIGNAL_LABEL[r.signal] : '—'),
    csv: (r) => (r.signal ? SIGNAL_LABEL[r.signal] : null),
  },
  n('avgDelivValR', 'Avg deliv value', 'Average daily delivery value in the range, ₹ Cr', 110, fmtCr),
  n('avgDelivValB', 'Baseline deliv value', 'Average daily delivery value in the baseline, ₹ Cr', 130, fmtCr),
  n('delivPctWR', 'Deliv %', 'Value-weighted delivery % in the range', 80, (v) => fmtPct(v)),
  n('delivPctWB', 'Baseline deliv %', 'Value-weighted delivery % in the baseline', 120, (v) => fmtPct(v)),
  n(
    'turnoverChgPct',
    'Turnover chg',
    'Average daily turnover in the range vs the baseline',
    100,
    (v) => fmtPctChg(v, 0),
    deliveryClass,
  ),
  n('avgTurnoverR', 'Avg turnover', 'Average daily turnover in the range, ₹ Cr', 110, fmtCr),
  n('nR', 'Days', 'Valid delivery days in the range', 60, (v) => (v === null ? '—' : String(v))),
  n('coverage', 'Coverage', 'Share of the range days with a valid delivery row', 80, (v) =>
    v === null ? '—' : fmtPct(v * 100, 0),
  ),
];

export const RANGE_COLUMN_BY_KEY = new Map<string, ColumnSpec<RangeScreenRow>>(
  RANGE_COLUMNS.map((c) => [c.key, c]),
);

export const DEFAULT_RANGE_COLUMNS = [
  'sym',
  'delivValChgPct',
  'delivPctChgPp',
  'ret',
  'caWarn',
  'signal',
  'avgDelivValR',
  'delivPctWR',
  'avgTurnoverR',
];
