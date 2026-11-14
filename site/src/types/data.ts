/** Mirrors pipeline/schemas/*.json and pipeline/build/columns.py. Dates are ISO strings, never Date objects. */

export interface SourceFreshness {
  latest: string | null;
  gaps: string[];
  collectingSince?: string;
}

export interface Meta {
  schemaVersion: 1;
  generatedAt: string;
  latestDate: string;
  firstDate: string;
  tradingDays: string[];
  indices: string[];
  sectors: string[];
  constituentsAsOf: string | null;
  sources: Record<string, SourceFreshness>;
  settings: { minTurnoverAvg20Cr: number; minBaseDelivValCr: number };
  /** 07 section 8: daily/ files of days before dailyFullFrom carry only dailySlimColumns. */
  publish: { dailyFullTradingDays: number; dailyFullFrom: string; dailySlimColumns: string[] };
}

export interface Table {
  schemaVersion: 1;
  columns: string[];
  rows: unknown[][];
}

export type Bucket = 'L' | 'M' | 'S' | 'U';

export interface UniverseRow {
  sym: string;
  f: string;
  name: string;
  isin: string | null;
  sector: string;
  idx: number;
  mcapCr: number | null;
  mcapRank: number | null;
  bucket: Bucket | null;
  listedOn: string | null;
  aliases: string[];
  mcapEstimated: boolean;
  /** ETF / index fund (03 section 5.2): keeps its metrics, has no signal, mcap rank or bucket. */
  etf: boolean;
}

export type SignalCode = 'ACC' | 'DIS' | 'ABS' | 'SPU' | 'SPD';

export interface DailyRow {
  sym: string;
  series: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  prevClose: number | null;
  vwap: number | null;
  vol: number | null;
  turnoverCr: number | null;
  trades: number | null;
  delivQty: number | null;
  delivPct: number | null;
  delivValCr: number | null;
  delivValAvg5: number | null;
  delivValAvg20: number | null;
  delivValAvg50: number | null;
  delivPctAvg20: number | null;
  volAvg20: number | null;
  turnoverAvg20Cr: number | null;
  tradeSizeRatio: number | null;
  spike: number | null;
  delivPctDiff: number | null;
  relVol: number | null;
  ret1: number | null;
  clv: number | null;
  vwapGap: number | null;
  delivPctZ60: number | null;
  delivPctPctile: number | null;
  streak: number | null;
  signal: SignalCode | null;
  flags: number;
  futOi: number | null;
  futOiChgPct: number | null;
  buildup: string | null;
  pcr: number | null;
}

export interface CumRow {
  sym: string;
  lastClose: number | null;
  lastTradeDate: string | null;
  cDelivValCr: number;
  cTurnoverCr: number;
  cDelivQty: number;
  cVol: number;
  cDays: number;
  /** Delivery value on up days and down days (close above / below prevClose) and trades: delivBalance and avgTradeSize for any range. */
  cDelivValUpCr: number;
  cDelivValDnCr: number;
  cTrades: number;
}

export interface SymbolRow {
  date: string;
  series: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  /** The raw previous close (NSE does not adjust it on a split ex-date). */
  prevClose: number | null;
  vwap: number | null;
  vol: number | null;
  turnoverCr: number | null;
  trades: number | null;
  delivQty: number | null;
  delivPct: number | null;
  delivValCr: number | null;
  delivPctAvg20: number | null;
  spike: number | null;
  signal: SignalCode | null;
  flags: number;
}

export interface Deal {
  date: string;
  type: string;
  client: string;
  entityId: string | null;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  valueCr: number;
  roundTrip: boolean;
}

export interface CorpAction {
  exDate: string;
  kind: string;
  purpose: string;
}

export interface SymbolFile {
  schemaVersion: 1;
  sym: string;
  name: string;
  sector: string;
  idx: number;
  bucket: Bucket | null;
  etf: boolean;
  columns: string[];
  rows: unknown[][];
  deals: Deal[];
  corpActions: CorpAction[];
}

/** One timeframe block of market.json (weekly / monthly / quarterly): the same groups and fields as the daily block, per period. */
export interface MarketBlock {
  keys: string[];
  /** Last trading day of each period. */
  ends: string[];
  partial: boolean[];
  groups: Record<string, MarketGroup>;
  indexClose: Record<string, (number | null)[]>;
}

export interface MarketGroup {
  turnoverCr: (number | null)[];
  delivValCr: (number | null)[];
  delivPctW: (number | null)[];
  medianDelivPct: (number | null)[];
  adv: (number | null)[];
  dec: (number | null)[];
  unch: (number | null)[];
  spikeCount2x: (number | null)[];
}

export interface Market {
  schemaVersion: 1;
  dates: string[];
  groups: Record<string, MarketGroup>;
  indexClose: Record<string, (number | null)[]>;
  weekly: MarketBlock;
  monthly: MarketBlock;
  quarterly: MarketBlock;
}

export interface SignalPerfEvent {
  id: string;
  label: string;
}

/** stats/signal_perf.json (04 section 6): one row per event x group x entry x horizon. */
export interface SignalPerfDoc {
  schemaVersion: 1;
  asOf: string;
  window: { from: string; to: string };
  horizons: number[];
  entries: ('t1' | 't0')[];
  groups: string[];
  minN: number;
  events: SignalPerfEvent[];
  label: string;
  columns: string[];
  rows: unknown[][];
}

export interface SignalPerfRow {
  event: string;
  group: string;
  entry: 't1' | 't0';
  horizon: number;
  events: number;
  n: number;
  days: number;
  medianExcess: number | null;
  meanExcess: number | null;
  hitRate: number | null;
}

/** stats/split_bonus.json row. */
export interface SplitBonusRow {
  sym: string;
  exDate: string;
  kind: 'SPLIT' | 'BONUS';
  purpose: string;
}

/** Flag bits (03 section 5.3). */
export const FLAG = {
  t2t: 1,
  corpAction: 2,
  bulkDeal: 4,
  blockDeal: 8,
  bandHit: 16,
  fnoBan: 32,
  high52: 64,
  low52: 128,
  lowLiquidity: 256,
  etf: 512,
  newListing: 1024,
  expiryWeek: 2048,
} as const;

// ---- timeframes (08-timeframes.md) ------------------------------------------------------------------------------------

/** One entry of periods.json weekly / monthly / quarterly. Quarters have no snapshot file. */
export interface PeriodInfo {
  key: string;
  /** First and last trading day in the period. */
  start: string;
  end: string;
  tradingDays: number;
  partial: boolean;
  daysIn: number;
  daysExpected: number;
  stocks: number;
  file?: string;
}

export interface PeriodsDoc {
  schemaVersion: 1;
  config: import('../lib/aggregate').PeriodsConfig;
  weekly: PeriodInfo[];
  monthly: PeriodInfo[];
  quarterly: PeriodInfo[];
}

/** A weekly/{end}.json or monthly/{key}.json row (slim set). Missing values are null. */
export interface PeriodSnapshotRow {
  sym: string;
  days: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  prevClose: number | null;
  vwap: number | null;
  vol: number | null;
  turnoverCr: number | null;
  trades: number | null;
  delivQty: number | null;
  delivPct: number | null;
  delivValCr: number | null;
  ret: number | null;
  clv: number | null;
  avgTradeSize: number | null;
  delivBalance: number | null;
  delivValAvgN: number | null;
  delivPctAvgN: number | null;
  turnoverAvgCr: number | null;
  spike: number | null;
  delivPctDiff: number | null;
  relTurnover: number | null;
  tradeSizeRatio: number | null;
  delivPctZ: number | null;
  delivPctPctile: number | null;
  streak: number | null;
  signal: SignalCode | null;
  flags: number;
  adjusted: number;
}

export interface PeriodSnapshot {
  info: {
    tf: 'w' | 'm';
    key: string;
    start: string;
    end: string;
    partial: boolean;
    daysIn: number;
    daysExpected: number;
  };
  rows: PeriodSnapshotRow[];
}

/** stats/signal_perf_periods.json: forward excess returns after each period signal. */
export interface SignalPerfPeriodsDoc {
  schemaVersion: 1;
  asOf: string;
  window: { from: string; to: string };
  timeframes: Record<'w' | 'm', { horizons: number[]; horizonLabels: string[] }>;
  groups: string[];
  minN: number;
  events: SignalPerfEvent[];
  label: string;
  columns: string[];
  rows: unknown[][];
}

export interface SignalPerfPeriodRow {
  tf: 'w' | 'm';
  event: string;
  group: string;
  horizon: number;
  events: number;
  n: number;
  periods: number;
  medianExcess: number | null;
  meanExcess: number | null;
  hitRate: number | null;
}
