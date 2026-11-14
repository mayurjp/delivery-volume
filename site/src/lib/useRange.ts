import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dataClient } from './dataClient';
import { useApp, useAsync, useGlobalState, usePeriods, useTimeframe } from './hooks';
import { tfToRangeSpec } from './timeframe';
import {
  buildRangeRows,
  fetchRangeCums,
  parseRange,
  resolveRange,
  writeRange,
  type RangeScreenRow,
  type RangeSpec,
  type ResolvedRange,
} from './range';

export interface RangeState {
  spec: RangeSpec;
  resolved: ResolvedRange;
  setSpec: (s: RangeSpec) => void;
}

/** Range and baseline state, kept in the URL (r, ra, rb, bl, ba, bb); the range ends on the global date. */
export function useRangeState(): RangeState {
  const { meta } = useApp();
  const { date } = useGlobalState();
  const [params, setParams] = useSearchParams();
  const ps = params.toString();
  const spec = useMemo(() => parseRange(new URLSearchParams(ps)), [ps]);
  const resolved = useMemo(() => resolveRange(spec, date, meta.tradingDays), [spec, date, meta.tradingDays]);
  const setSpec = useCallback(
    (s: RangeSpec) => setParams(writeRange(new URLSearchParams(ps), s)),
    [ps, setParams],
  );
  return { spec, resolved, setSpec };
}

/** Loads the (at most four) cum files and the split/bonus list for a resolved range, and computes the rows. */
export function useRangeRows(resolved: ResolvedRange, enabled = true) {
  const { meta, bySym } = useApp();
  const { range, baseline } = resolved;
  const key = enabled ? `range:${range.a}:${range.b}:${baseline?.a ?? '-'}:${baseline?.b ?? '-'}` : null;
  const res = useAsync<RangeScreenRow[]>(key, async () => {
    const [cums, sb] = await Promise.all([fetchRangeCums(dataClient, resolved), dataClient.splitBonus()]);
    return buildRangeRows(cums, resolved, bySym, meta.settings, sb);
  });
  return res;
}

export interface EffectiveRange extends RangeState {
  /** True when the global timeframe (q, N-day bars, a custom range) sets the range instead of the page's own controls. */
  fromTimeframe: boolean;
  /** The timeframe needs periods.json and it is not here yet (or the timeframe has no range). */
  pending: boolean;
}

/**
 * The range a page works on (08 section 5A): the global timeframe q / c / r sets it through tfToRangeSpec; for d, w and m
 * the page's own range controls (r, ra, rb, bl, ba, bb) stay in charge.
 */
export function useEffectiveRange(): EffectiveRange {
  const own = useRangeState();
  const { meta } = useApp();
  const { date } = useGlobalState();
  const { state } = useTimeframe();
  const periods = usePeriods();
  const fromTimeframe = state.tf === 'q' || state.tf === 'c' || state.tf === 'r';
  const spec = useMemo(
    () =>
      fromTimeframe ? tfToRangeSpec(state, date, meta.tradingDays, periods.data?.quarterly ?? []) : null,
    [fromTimeframe, state, date, meta.tradingDays, periods.data],
  );
  const resolved = useMemo(
    () => (spec ? resolveRange(spec, date, meta.tradingDays) : null),
    [spec, date, meta.tradingDays],
  );
  if (fromTimeframe && spec && resolved) {
    return { spec, resolved, setSpec: own.setSpec, fromTimeframe, pending: false };
  }
  return { ...own, fromTimeframe, pending: fromTimeframe };
}
