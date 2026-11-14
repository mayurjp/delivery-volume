/**
 * The Stock page's smart-money panel (07 section 6): one line of the 6-month trail tally read from trail/latest.json,
 * and the "Historically" line of the matching tally bucket from stats/trail_perf.json (kind `tally`). Both reuse the trail
 * data and the track-record helpers of trailView.ts, so no trail logic is duplicated here.
 *
 * Wording: descriptive, past tense. The label "Evidence summary, not advice. You decide." is shown with the panel.
 */

import type { TrailPerfRow } from '../types/data';
import type { WindowName, WindowView } from './trail';
import { INDICATOR_COUNT, historyLine, type TrailEntry } from './trailView';

export const SMART_MONEY_WINDOW: WindowName = '6M';

/** The tally bucket of a window (07 section 6): four or more of the indicators on one side, else mixed. */
export function tallyBucketId(w: WindowView): 'tallyA4' | 'tallyD4' | 'tallyMixed' {
  if (w.A >= 4) return 'tallyA4';
  if (w.D >= 4) return 'tallyD4';
  return 'tallyMixed';
}

/** "6M: 4 of 8 footprints lean accumulation, 1 leans distribution, 2 not covered." */
export function tallyLine(entry: TrailEntry | undefined, win: WindowName = SMART_MONEY_WINDOW): string {
  if (!entry)
    return 'Not in the trail: the stock is outside the stored index lists or below the liquidity floor.';
  const w = entry.w[win];
  if (!w) return `${win}: not enough history yet for the trail.`;
  const dist = `${w.D} ${w.D === 1 ? 'leans' : 'lean'} distribution`;
  const missing = w.missing > 0 ? `, ${w.missing} not covered` : '';
  return `${win}: ${w.A} of ${INDICATOR_COUNT} footprints lean accumulation, ${dist}${missing}.`;
}

/** The "Historically" line of the window's tally bucket (too few cases or dates are said, not shown as numbers). */
export function tallyHistory(
  entry: TrailEntry | undefined,
  perf: readonly TrailPerfRow[] | null,
  win: WindowName = SMART_MONEY_WINDOW,
): string | null {
  const w = entry?.w[win];
  if (!w) return null;
  return historyLine(perf, 'tally', tallyBucketId(w), win);
}
