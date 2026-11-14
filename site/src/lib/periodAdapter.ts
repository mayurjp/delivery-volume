import type { DailyRow, PeriodSnapshotRow } from '../types/data';

/**
 * Period snapshot rows (weekly/, monthly/) use period names (ret, delivPctAvgN, relTurnover ...). The Screener table, its
 * filters and presets, and the treemap read the daily names, so a period row is mapped onto a DailyRow once:
 *   ret -> ret1, delivPctAvgN -> delivPctAvg20, delivValAvgN -> delivValAvg20, turnoverAvgCr -> turnoverAvg20Cr,
 *   relTurnover -> relVol, delivPctZ -> delivPctZ60.
 * Fields a period has no value for (delivValAvg5/50, volAvg20, vwapGap) are null. `series` is EQ (a snapshot holds valid
 * delivery days only). The period-only fields (days, delivBalance, avgTradeSize, adjusted) come back as extras.
 */
export interface PeriodExtras {
  days: number | null;
  delivBalance: number | null;
  avgTradeSize: number | null;
  /** 1 when the period prices were split-adjusted (prevClose and the return are then in post-split prices). */
  adjusted: number;
}

export function periodRowToDaily(r: PeriodSnapshotRow): DailyRow & PeriodExtras {
  return {
    sym: r.sym,
    series: 'EQ',
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    prevClose: r.prevClose,
    vwap: r.vwap,
    vol: r.vol,
    turnoverCr: r.turnoverCr,
    trades: r.trades,
    delivQty: r.delivQty,
    delivPct: r.delivPct,
    delivValCr: r.delivValCr,
    delivValAvg5: null,
    delivValAvg20: r.delivValAvgN,
    delivValAvg50: null,
    delivPctAvg20: r.delivPctAvgN,
    volAvg20: null,
    turnoverAvg20Cr: r.turnoverAvgCr,
    tradeSizeRatio: r.tradeSizeRatio,
    spike: r.spike,
    delivPctDiff: r.delivPctDiff,
    relVol: r.relTurnover,
    ret1: r.ret,
    clv: r.clv,
    vwapGap: null,
    delivPctZ60: r.delivPctZ,
    delivPctPctile: r.delivPctPctile,
    streak: r.streak,
    signal: r.signal,
    flags: r.flags,
    futOi: null,
    futOiChgPct: null,
    buildup: null,
    pcr: null,
    days: r.days,
    delivBalance: r.delivBalance,
    avgTradeSize: r.avgTradeSize,
    adjusted: r.adjusted,
  };
}

/** DailyRow columns that a period snapshot never has (shown as a dash with a tooltip in the Screener). */
export const PERIOD_MISSING: readonly (keyof DailyRow)[] = [
  'delivValAvg5',
  'delivValAvg50',
  'volAvg20',
  'vwapGap',
  'futOi',
  'futOiChgPct',
  'buildup',
  'pcr',
];
