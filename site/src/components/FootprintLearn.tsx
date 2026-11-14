import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { HEAVY_PRE, TOP_N, pickCaseStudies, type CaseStudy, type CaseRole } from '../lib/caseStudies';
import { useApp, useRunFootprints, useRunsLibrary, useSymbol } from '../lib/hooks';
import { parseRuns, parseSummary } from '../lib/runs';
import type { RunFootprintsDoc } from '../types/data';
import { FootprintCard } from './RunsTab';
import { Empty, ErrorBox, Skeleton } from './ui';

const ROLE_TITLE: Record<CaseRole, string> = {
  largestUp: 'Largest UP run',
  largestDown: 'Largest DOWN run',
  heavyPreUp: 'Largest UP run after heavy pre-run delivery',
};

/**
 * Learn page: "Reading footprints" (07 section 7). The guide is plain words; the three case studies are picked from
 * runs/library.json by the rule in lib/caseStudies.ts, and each card is the stock's own footprint card. No stock name
 * or number is written here.
 */
export default function FootprintLearn() {
  const { meta, universe } = useApp();
  const lib = useRunsLibrary();
  const medians = useRunFootprints();
  const rank = useMemo(() => new Map(universe.map((u) => [u.sym, u.mcapRank])), [universe]);
  const picks = useMemo(
    () => (lib.data ? pickCaseStudies(lib.data, rank, meta.latestDate) : null),
    [lib.data, rank, meta.latestDate],
  );

  return (
    <section className="space-y-2" aria-label="Reading footprints" data-testid="learn-footprints">
      <h2 className="text-base font-semibold">Reading footprints</h2>
      <div className="card space-y-2 p-4">
        <p>
          A <b>run</b> is a big move: at least 20% over at least 5 trading days, measured on prices adjusted
          for splits and bonuses. A <b>footprint</b> is what the trading record shows around a run: how much
          delivery there was against normal, whether delivery came more on up days or on down days (the
          delivery balance), whether the average trade got bigger or smaller, and any named deals and holdings
          changes.
        </p>
        <p>
          Read a footprint card in three steps. First the run&apos;s own numbers, then the stock&apos;s
          ordinary days, then the market-wide median for runs in the same direction. A difference from normal
          is a pattern to look at, not a proven cause.
        </p>
        <p>
          The statistics show how often a feature in its top or bottom fifth was followed by a big move, next
          to the base rate for all stock-days, on the{' '}
          <Link to="/runs" className="text-blue-700 underline dark:text-blue-300">
            Run library
          </Link>
          . In the study, heavy delivery on up days came more often before down runs than before up runs, the
          opposite of the usual reading. Keep that in mind, and keep the caveats there in view.
        </p>
        <p className="font-semibold">Historical, not a prediction. Evidence, not advice.</p>
      </div>

      <h3 className="pt-2 text-sm font-semibold">Three case studies, picked from the data</h3>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Runs that ended in the last year, among the top {TOP_N} stocks by market cap. The largest up and down
        runs come first. The third is the largest up run where delivery in the 20 days before the start was at
        least {HEAVY_PRE} times normal, not counting the first two.
      </p>
      {lib.error ? (
        <ErrorBox message={lib.error} />
      ) : picks === null ? (
        <Skeleton height={240} />
      ) : picks.length === 0 ? (
        <Empty>No run in the last year fits these rules yet.</Empty>
      ) : (
        picks.map((p) => <CaseCard key={`${p.role}-${p.sym}-${p.start}`} pick={p} medians={medians.data} />)
      )}
    </section>
  );
}

function CaseCard({ pick, medians }: { pick: CaseStudy; medians: RunFootprintsDoc | null }) {
  const { bySym } = useApp();
  const u = bySym.get(pick.sym) ?? null;
  const data = useSymbol(u?.f ?? null);
  const runs = useMemo(() => (data.data ? parseRuns(data.data.file.runs) : []), [data.data]);
  const summary = useMemo(() => parseSummary(data.data?.file.runSummary), [data.data]);
  const k = runs.findIndex((r) => r.start === pick.start && r.dir === pick.dir);
  return (
    <article className="card min-w-0 space-y-2 p-3" data-testid="case-study" data-role={pick.role}>
      <h4 className="text-sm font-semibold">
        {ROLE_TITLE[pick.role]}: {pick.sym}
      </h4>
      <p className="text-sm">{pick.text}</p>
      {data.error ? (
        <ErrorBox message={data.error} />
      ) : !data.data || !u ? (
        <Skeleton height={240} />
      ) : k < 0 ? (
        <Empty>This run is not in the stock&apos;s own history file.</Empty>
      ) : (
        <FootprintCard run={runs[k]!} index={k} summary={summary} medians={medians} bucket={u.bucket} />
      )}
      <Link
        to={`/stock/${encodeURIComponent(pick.sym)}?tab=runs&run=${encodeURIComponent(pick.start)}`}
        className="text-sm text-blue-700 underline dark:text-blue-300"
      >
        Open {pick.sym}&apos;s Runs tab at this run
      </Link>
    </article>
  );
}
