/**
 * F&O positioning (docs/specs/04-analytics.md section 4.4, Phase 5): the stock page's F&O pane and the Screener's
 * build-up presets read these pure helpers. The build publishes futOi (shares, summed over stock-futures expiries),
 * futOiChgPct (per cent, null when not measured), buildup (LB, SB, SC, LU or null) and pcr (PE over CE open interest).
 * Descriptive only: a build-up code says what price and open interest did on the day, nothing about the next day.
 */

/** Build-up codes and their labels (04 section 4.4). Descriptive terms, not advice. */
export const BUILDUP_LABEL: Readonly<Record<string, string>> = {
  LB: 'Long build-up',
  SB: 'Short build-up',
  SC: 'Short covering',
  LU: 'Long unwinding',
};

/** What the build-up code means in words: price direction, then open-interest direction (04 section 4.4). */
export const BUILDUP_MEANING: Readonly<Record<string, string>> = {
  LB: 'price up, open interest up 2% or more',
  SB: 'price down, open interest up 2% or more',
  SC: 'price up, open interest down 2% or more',
  LU: 'price down, open interest down 2% or more',
};

/** The F&O stock-day's confluence badge (04 section 4.4): heavy delivery together with a build-up. Null otherwise. */
export function confluenceLabel(
  signal: string | null | undefined,
  buildup: string | null | undefined,
): string | null {
  if (signal === 'ACC' && buildup === 'LB') return 'Heavy delivery + long build-up';
  if (signal === 'DIS' && buildup === 'SB') return 'Heavy delivery + short build-up';
  if (signal === 'ACC' && buildup === 'SC') return 'Heavy delivery + short covering';
  return null;
}

/** The stock's F&O history from its symbol file's `fo` block (absent for a non-F&O stock). */
export interface FoHistoryRow {
  date: string;
  futOi: number | null;
  futOiChgPct: number | null;
  buildup: string | null;
  pcr: number | null;
}

export function foHistory(block: { columns: string[]; rows: unknown[][] } | undefined): FoHistoryRow[] {
  if (!block) return [];
  const idx = (name: string) => block.columns.indexOf(name);
  const [cd, co, cc, cb, cp] = ['date', 'futOi', 'futOiChgPct', 'buildup', 'pcr'].map(idx);
  return block.rows.map((r) => ({
    date: r[cd] as string,
    futOi: (r[co] as number | null) ?? null,
    futOiChgPct: (r[cc] as number | null) ?? null,
    buildup: (r[cb] as string | null) ?? null,
    pcr: (r[cp] as number | null) ?? null,
  }));
}

/** Plain-language line for the pane's latest day. */
export function latestLine(h: FoHistoryRow | undefined): string {
  if (!h || h.futOi === null) return 'No F&O data for the latest day.';
  const b = h.buildup ? (BUILDUP_LABEL[h.buildup] ?? h.buildup) : 'No build-up code on this day';
  const chg =
    h.futOiChgPct === null
      ? 'OI change not measured (roll or gap)'
      : `OI change ${h.futOiChgPct >= 0 ? '+' : ''}${h.futOiChgPct.toFixed(2)}%`;
  return `${b}; ${chg}`;
}

/** The F&O columns: they come from fo/{date}.json, not from the daily file (Phase 5). */
export const FO_KEYS = ['futOi', 'futOiChgPct', 'buildup', 'pcr'] as const;

/** The labels a pane may show; a test checks none of them carries advice wording. */
export const FO_PANE_STRINGS = [
  'F&O positioning (stock futures)',
  'Open interest is in shares, summed over all stock-futures expiries. Build-up describes price and open interest on the day; it is not a prediction.',
  'Not an F&O stock: no stock futures in the NSE F&O bhavcopy, so there is no open-interest history.',
  'Put-call ratio: put open interest over call open interest, all stock-option expiries.',
  'Build-up days are shaded in the chart. Hover for the day.',
] as const;
