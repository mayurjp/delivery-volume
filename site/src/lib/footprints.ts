/**
 * Daily footprint indicators (07 section 3): the TypeScript twin of `indicators` in pipeline/footprints.py. Both read the
 * shared vectors in footprintVectors.json (footprints.test.ts). The Stock page's Runs tab computes them in the browser from
 * the symbol rows, so nothing is stored per day (DEVIATIONS #139).
 *
 * Input: one record per trading day in date order. Only days with delivValCr and turnoverCr count (valid delivery days).
 */

export interface FootRec {
  close: number | null;
  prevClose: number | null;
  turnoverCr: number | null;
  trades: number | null;
  delivValCr: number | null;
}

export interface FootIndicators {
  delivBal20: number | null;
  delivBal60: number | null;
  delivBal120: number | null;
  delivValRatio60: number | null;
  tradeSizeRatio60: number | null;
  delivPctTrend: number | null;
}

export const FOOT_KEYS: readonly (keyof FootIndicators)[] = [
  'delivBal20',
  'delivBal60',
  'delivBal120',
  'delivValRatio60',
  'tradeSizeRatio60',
  'delivPctTrend',
];

/** Round half away from zero to `d` decimals (the twin of Python's round on the vectors' values). */
function roundTo(x: number, d: number): number {
  const f = 10 ** d;
  const r = (Math.round(Math.abs(x) * f + 1e-9) / f) * Math.sign(x);
  return r === 0 ? 0 : r; // no negative zero
}

const valid = (records: readonly FootRec[]): (FootRec & { delivValCr: number; turnoverCr: number })[] =>
  records.filter(
    (r): r is FootRec & { delivValCr: number; turnoverCr: number } =>
      r.delivValCr !== null && r.turnoverCr !== null,
  );

const sumOf = (rows: readonly FootRec[], key: 'delivValCr' | 'turnoverCr' | 'trades'): number =>
  rows.reduce((s, r) => s + (r[key] ?? 0), 0);

function bal(rows: readonly (FootRec & { delivValCr: number })[], n: number): number | null {
  if (rows.length < n) return null;
  const win = rows.slice(-n);
  let up = 0;
  let dn = 0;
  for (const r of win) {
    if (r.close !== null && r.prevClose !== null) {
      if (r.close > r.prevClose) up += r.delivValCr;
      else if (r.close < r.prevClose) dn += r.delivValCr;
    }
  }
  if (dn <= 0) return null;
  return roundTo(up / dn, 3);
}

/** The six indicators on the last record of `records` (every window ends on the last valid day). */
export function footprintIndicators(records: readonly FootRec[]): FootIndicators {
  const rows = valid(records);
  const out: FootIndicators = {
    delivBal20: bal(rows, 20),
    delivBal60: bal(rows, 60),
    delivBal120: bal(rows, 120),
    delivValRatio60: null,
    tradeSizeRatio60: null,
    delivPctTrend: null,
  };
  if (rows.length >= 80) {
    const last20 = rows.slice(-20);
    const prior60 = rows.slice(-80, -20);
    const mLast = sumOf(last20, 'delivValCr') / 20;
    const mPrior = sumOf(prior60, 'delivValCr') / 60;
    if (mPrior > 0) out.delivValRatio60 = roundTo(mLast / mPrior, 3);
    const tripsLast = sumOf(last20, 'trades');
    const tripsPrior = sumOf(prior60, 'trades');
    const tsLast = tripsLast > 0 ? sumOf(last20, 'turnoverCr') / tripsLast : null;
    const tsPrior = tripsPrior > 0 ? sumOf(prior60, 'turnoverCr') / tripsPrior : null;
    if (tsLast !== null && tsPrior) out.tradeSizeRatio60 = roundTo(tsLast / tsPrior, 3);
  }
  if (rows.length >= 120) {
    const t20 = sumOf(rows.slice(-20), 'turnoverCr');
    const t120 = sumOf(rows.slice(-120), 'turnoverCr');
    if (t20 > 0 && t120 > 0) {
      const d20 = sumOf(rows.slice(-20), 'delivValCr');
      const d120 = sumOf(rows.slice(-120), 'delivValCr');
      out.delivPctTrend = roundTo((d20 / t20) * 100 - (d120 / t120) * 100, 2);
    }
  }
  return out;
}

/**
 * The indicators on every day of `records` (null on days without delivery data), for the Runs tab's footprint pane.
 * O(n^2) in the number of days, which is fine for the stored 3-year history (about 750 days).
 */
export function footprintSeries(records: readonly FootRec[]): FootIndicators[] {
  return records.map((r, i) =>
    r.delivValCr === null || r.turnoverCr === null
      ? {
          delivBal20: null,
          delivBal60: null,
          delivBal120: null,
          delivValRatio60: null,
          tradeSizeRatio60: null,
          delivPctTrend: null,
        }
      : footprintIndicators(records.slice(0, i + 1)),
  );
}
