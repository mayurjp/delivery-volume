/** en-IN formatting (04 section 7). All dates are ISO strings handled by parts, never via UTC Date parsing. */

const MINUS = '−';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const nf2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nfFixed2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DASH = '—';

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function neg(s: string): string {
  return s.replace('-', MINUS);
}

/** Money in rupees crore: "1,23,456.78 Cr". */
export function fmtCr(v: number | null | undefined): string {
  return isNum(v) ? `${neg(nf2.format(v))} Cr` : DASH;
}

/** Plain en-IN number with up to `digits` decimals. */
export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return DASH;
  const f = digits === 2 ? nf2 : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits });
  return neg(f.format(v));
}

export function fmtInt(v: number | null | undefined): string {
  return isNum(v) ? neg(nf0.format(v)) : DASH;
}

/** Price with exactly 2 decimals. */
export function fmtPrice(v: number | null | undefined): string {
  return isNum(v) ? neg(nfFixed2.format(v)) : DASH;
}

/** Compact share quantity: "12.3 L" (lakh) or "1.2 Cr" (crore); below one lakh, en-IN grouping. */
export function fmtQty(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : '';
  if (a >= 1e7) return `${sign}${nf2.format(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}${nf2.format(a / 1e5)} L`;
  return neg(nf0.format(v));
}

function signed(v: number, digits: number): string {
  const f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const body = f.format(Math.abs(v));
  if (Number(body.replace(/,/g, '')) === 0) return body; // never show +0.0 or -0.0
  return `${v < 0 ? MINUS : '+'}${body}`;
}

/** Signed percentage change: "+4.2%", "-1.3%" (with a true minus sign). */
export function fmtPctChg(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? `${signed(v, digits)}%` : DASH;
}

/** Signed percentage points: "+4.2 pp". */
export function fmtPp(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? `${signed(v, digits)} pp` : DASH;
}

/** A level in percent (not a change): "56.3%". */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return DASH;
  const f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${neg(f.format(v))}%`;
}

/** Ratio: "2.4x" (multiplication sign). */
export function fmtRatio(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? `${neg(v.toFixed(digits))}×` : DASH;
}

/** ISO date -> "13 Nov 2026". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${Number(m[3])} ${mon} ${m[1]}` : iso;
}

/** ISO date -> "13 Nov" (short, for axis labels). */
export function fmtDateShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}` : iso;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export const MONTH_NAMES = MONTHS;
