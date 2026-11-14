import { useMemo } from 'react';
import { EVIDENCE_LABEL, parseTrail } from '../lib/trailView';
import { tallyHistory, tallyLine } from '../lib/smartMoney';
import { useTrail, useTrailPerf } from '../lib/hooks';
import { AppLink } from './ui';

/**
 * The Stock page header's smart-money panel (07 section 6): the 6-month tally of the trail, the "Historically" line of
 * its tally bucket, and a link to the stock's trail. Reads trail/latest.json and stats/trail_perf.json through the shared
 * hooks, so the trail logic lives only in lib/trail.ts and lib/trailView.ts.
 */
export default function SmartMoneyPanel({ sym }: { sym: string }) {
  const trail = useTrail(null);
  const perf = useTrailPerf();
  const entries = useMemo(() => (trail.data ? parseTrail(trail.data) : null), [trail.data]);
  const entry = entries?.find((e) => e.sym === sym);
  const hist = tallyHistory(entry, perf.data, '6M');

  return (
    <section
      aria-label="Smart money"
      data-testid="smart-money"
      className="rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-800/60"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Smart money trail
        </h2>
        <AppLink
          to={`/trail/${encodeURIComponent(sym)}`}
          className="text-xs text-blue-700 hover:underline dark:text-blue-300"
        >
          details
        </AppLink>
      </div>
      {trail.error ? (
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">The trail could not be loaded.</p>
      ) : !entries ? (
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Loading the trail.</p>
      ) : (
        <>
          <p className="num mt-1" data-testid="smart-money-tally">
            {tallyLine(entry)}
          </p>
          {hist && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{hist}</p>}
          <p className="mt-1 text-xs italic text-slate-600 dark:text-slate-400">{EVIDENCE_LABEL}</p>
        </>
      )}
    </section>
  );
}
