import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dataClient } from './dataClient';
import { useApp, useAsync, useGlobalState } from './hooks';
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
