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
  entityName?: string;
  entityCategory?: Category;
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
  /** Per date and category (FII, DII, Other), round trips excluded (03 5.5). */
  dealFlows: { columns: string[]; rows: unknown[][] };
  /** Quarterly holdings (03 5.10): one row per stored quarter; `quarters` is the store's quarter list (07 6A). */
  holdings: { columns: string[]; rows: unknown[][]; quarters?: string[] };
  /** Named holders above 1% in the latest quarter, with NEW / UP / DOWN / SAME / EXITED status. */
  namedHolders: { columns: string[]; rows: unknown[][] };
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
  kind: 'SPLIT' | 'BONUS' | 'ADJ' | 'DEMERGER';
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

/** trail/latest.json and trail/asof/{date}.json (07 section 6A). A window cell is null when it cannot be computed. */
export interface TrailDoc {
  schemaVersion: 1;
  asOf: string;
  stripWeeks: (string | null)[];
  windows: string[];
  windowDays: number[];
  windowColumns: string[];
  indicators: { id: string; label: string; rule: string }[];
  slots: { id: string; label: string; arrives: string }[];
  listSize: number;
  label: string;
  columns: string[];
  rows: [string, string, unknown[] | null, unknown[] | null, unknown[] | null][];
  eligible?: number;
  survivorship?: string;
  /** Month-end as-of snapshots that exist (latest.json only). */
  snapshots?: string[];
  /** The thresholds the build used; the browser twin reads the same numbers. */
  config: unknown;
}

/** stats/trail_perf.json (07 section 6A): the track record per list and per indicator. */
export interface TrailPerfRow {
  kind: 'list' | 'indicator';
  id: string;
  window: string;
  horizon: number;
  n: number;
  dates: number;
  medianExcess: number | null;
  meanExcess: number | null;
  hitRate: number | null;
}

export interface TrailPerfDoc {
  schemaVersion: 1;
  asOf: string;
  universe: string;
  windows: string[];
  horizons: number[];
  asOfDates: string[];
  minN: number;
  listSize: number;
  lists: { id: string; label: string }[];
  indicators: { id: string; label: string }[];
  label: string;
  columns: string[];
  rows: unknown[][];
}

// ---- Phase 4: institutions and deals (03 5.7, 5.8) -------------------------------------------------------------------

export type Category = 'FII' | 'DII' | 'Other';

/** One deal row of deals/{YYYY}.json (columns as published). */
export interface DealRow {
  date: string;
  type: string;
  sym: string;
  client: string;
  entityId: string;
  entityName: string;
  entityType: string;
  entityCategory: Category;
  entityTypeInferred: boolean;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  valueCr: number;
  roundTrip: boolean;
}

/** deals/flows.json: per stock, date and category, round trips excluded. */
export interface FlowRow {
  date: string;
  sym: string;
  category: Category;
  buyValueCr: number;
  sellValueCr: number;
  netValueCr: number;
}

/** deals/entities.json. disclosedHolding* are filled in by Phase 4B (S16), null until then. */
export interface EntityRow {
  entityId: string;
  entityName: string;
  entityType: string;
  entityCategory: Category;
  aliases: string[];
  dealCount: number;
  buyValueCr: number;
  sellValueCr: number;
  netValueCr: number;
  firstDate: string;
  lastDate: string;
  topSymbols: string[];
  disclosedHoldingsCount: number | null;
  disclosedHoldingsQuarter: string | null;
}

/**
 * One shareholding filing (S16, 03 5.10). holdings/latest.json and holdings/{q}.json rows carry `sym` and `quarter`;
 * the per-stock `holdings` block of a symbol file has the same fields without `sym`. Percentages are of total shares;
 * `*ChgPp` is the change against the previous quarter in percentage points; `sharesChgPct` is the change in total
 * shares in percent (|x| > 2 sets `dilutionFlag`, 04 5.4).
 */
export interface HoldingsFiling {
  sym?: string;
  quarter: string;
  filedOn: string | null;
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null;
  mfPct: number | null;
  insurancePct: number | null;
  retailPct: number | null;
  fiiChgPp: number | null;
  diiChgPp: number | null;
  mfChgPp: number | null;
  promoterChgPp: number | null;
  sharesChgPct: number | null;
  dilutionFlag: boolean;
  holderCount: number | null;
  totalShares: number | null;
}

/** holdings/quarters.json: `filedCount` of `universeCount` companies filed; `complete` once the quarter is closed. */
export interface HoldingsQuarterRow {
  quarter: string;
  filedCount: number;
  universeCount: number;
  complete: boolean;
}

/** holdings/aggregates.json: market-cap-weighted group percentages (ALL, MC:L, MC:M, MC:S, MC:U). */
export interface HoldingsAggregateRow {
  quarter: string;
  group: string;
  n: number;
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null;
  mfPct: number | null;
  retailPct: number | null;
}

/** holdings/holders/{quarter}.json: a named holder above 1%. `chg` is NEW, UP, DOWN, SAME or EXITED (pct null). */
export interface HolderRow {
  sym: string;
  category: string;
  subType: string;
  holder: string;
  entityId: string;
  shares: number | null;
  pct: number | null;
  prevPct: number | null;
  chg: 'NEW' | 'UP' | 'DOWN' | 'SAME' | 'EXITED' | null;
}

/** institutional/cash.json (Rs Crore; nulls on days with no S8 record). */
export interface CashRow {
  date: string;
  fiiBuy: number | null;
  fiiSell: number | null;
  fiiNet: number | null;
  diiBuy: number | null;
  diiSell: number | null;
  diiNet: number | null;
}

/** institutional/participants.json, one table for OI and one for volume. */
export interface ParticipantRow {
  date: string;
  participant: 'FII' | 'DII' | 'Pro' | 'Client';
  futIdxLong: number;
  futIdxShort: number;
  futStkLong: number;
  futStkShort: number;
  optIdxCallLong: number;
  optIdxPutLong: number;
  optIdxCallShort: number;
  optIdxPutShort: number;
  optStkCallLong: number;
  optStkPutLong: number;
  optStkCallShort: number;
  optStkPutShort: number;
  totalLong: number;
  totalShort: number;
}

/** institutional/fii_deriv.json (S7): one row per date and category row. */
export interface FiiDerivRow {
  date: string;
  category: string;
  level: 'total' | 'instrument';
  buyContracts: number | null;
  buyAmtCr: number | null;
  sellContracts: number | null;
  sellAmtCr: number | null;
  oiContracts: number | null;
  oiAmtCr: number | null;
}
