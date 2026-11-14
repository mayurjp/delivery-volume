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
}

export interface SymbolRow {
  date: string;
  series: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
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
  futOi: number | null;
  futOiChgPct: number | null;
  buildup: string | null;
  pcr: number | null;
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
  columns: string[];
  rows: unknown[][];
  deals: Deal[];
  corpActions: CorpAction[];
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
  newListing: 1024,
  expiryWeek: 2048,
} as const;
