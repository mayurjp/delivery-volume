import type { Market, MarketBlock, MarketGroup } from '../types/data';
import type { TimeframeState } from './timeframe';

/**
 * Market-level series per timeframe (08 section 5, Stats and Heatmaps). Weekly, monthly and quarterly come from the
 * market.json blocks; custom N-day bars and custom ranges are built from the daily arrays: sums for turnover and
 * delivery value, delivPctW from the sums, adv/dec/unch/spikeCount2x summed, and the median stock delivery % of a bar
 * as the mean of its daily medians (a median cannot be aggregated; the UI says so).
 */

export interface MarketSeries {
  /** One entry per point: the period's last trading day. */
  ends: string[];
  keys: string[];
  partial: boolean[];
  group: MarketGroup;
  indexClose: Record<string, (number | null)[]>;
}

const sum = (a: readonly (number | null)[]): number | null => {
  let s = 0;
  let any = false;
  for (const v of a) {
    if (v !== null) {
      s += v;
      any = true;
    }
  }
  return any ? s : null;
};

const mean = (a: readonly (number | null)[]): number | null => {
  const v = a.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

/** N-trading-day bars aligned to END at the last date (the first bar may be short): [start, end) index pairs. */
export function barEdges(length: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let e = length; e > 0; e -= n) out.push([Math.max(0, e - n), e]);
  return out.reverse();
}

export function aggregateGroupBars(
  dates: readonly string[],
  g: MarketGroup,
  indexClose: Record<string, (number | null)[]>,
  n: number,
): MarketSeries {
  const edges = barEdges(dates.length, n);
  const col = (a: readonly (number | null)[], f: (x: readonly (number | null)[]) => number | null) =>
    edges.map(([s, e]) => f(a.slice(s, e)));
  const turnoverCr = col(g.turnoverCr, sum);
  const delivValCr = col(g.delivValCr, sum);
  return {
    ends: edges.map(([, e]) => dates[e - 1]!),
    keys: edges.map(([, e]) => dates[e - 1]!),
    partial: edges.map(([s, e]) => e - s < n),
    group: {
      turnoverCr,
      delivValCr,
      delivPctW: turnoverCr.map((t, i) =>
        t !== null && t > 0 && delivValCr[i] !== null ? (delivValCr[i]! / t) * 100 : null,
      ),
      medianDelivPct: col(g.medianDelivPct, mean),
      adv: col(g.adv, sum),
      dec: col(g.dec, sum),
      unch: col(g.unch, sum),
      spikeCount2x: col(g.spikeCount2x, sum),
    },
    indexClose: Object.fromEntries(
      Object.entries(indexClose).map(([k, v]) => [k, edges.map(([, e]) => v[e - 1] ?? null)]),
    ),
  };
}

function fromBlock(b: MarketBlock, group: string): MarketSeries | null {
  const g = b.groups[group];
  return g ? { ends: b.ends, keys: b.keys, partial: b.partial, group: g, indexClose: b.indexClose } : null;
}

/** The series of one market group for the timeframe (null when the group does not exist). d keeps the daily arrays. */
export function marketSeries(market: Market, group: string, tf: TimeframeState): MarketSeries | null {
  const g = market.groups[group];
  if (!g) return null;
  switch (tf.tf) {
    case 'w':
      return fromBlock(market.weekly, group);
    case 'm':
      return fromBlock(market.monthly, group);
    case 'q':
      return fromBlock(market.quarterly, group);
    case 'c':
      return aggregateGroupBars(market.dates, g, market.indexClose, tf.n);
    case 'r': {
      const keep = market.dates
        .map((d, i) => ((tf.from && d < tf.from) || (tf.to && d > tf.to) ? -1 : i))
        .filter((i) => i >= 0);
      const pick = (a: readonly (number | null)[]) => keep.map((i) => a[i] ?? null);
      return {
        ends: keep.map((i) => market.dates[i]!),
        keys: keep.map((i) => market.dates[i]!),
        partial: keep.map(() => false),
        group: {
          turnoverCr: pick(g.turnoverCr),
          delivValCr: pick(g.delivValCr),
          delivPctW: pick(g.delivPctW),
          medianDelivPct: pick(g.medianDelivPct),
          adv: pick(g.adv),
          dec: pick(g.dec),
          unch: pick(g.unch),
          spikeCount2x: pick(g.spikeCount2x),
        },
        indexClose: Object.fromEntries(Object.entries(market.indexClose).map(([k, v]) => [k, pick(v)])),
      };
    }
    default:
      return {
        ends: market.dates,
        keys: market.dates,
        partial: market.dates.map(() => false),
        group: g,
        indexClose: market.indexClose,
      };
  }
}
