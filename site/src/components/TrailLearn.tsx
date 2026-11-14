import { Link } from 'react-router-dom';

/** Learn page: how to read the Smart Money Trail, in plain words (07 section 6A). Descriptive only. */
export default function TrailLearn() {
  return (
    <section className="space-y-2" aria-label="Reading the Smart Money Trail" data-testid="learn-trail">
      <h2 className="text-base font-semibold">Reading the Smart Money Trail</h2>
      <div className="card space-y-2 p-4">
        <p>
          NSE does not say who took delivery of a stock. The{' '}
          <Link to="/trail" className="text-blue-700 underline dark:text-blue-300">
            Smart Money Trail
          </Link>{' '}
          shows footprints instead: how much delivery value fell on up days compared with down days, whether
          the delivery share rose or fell against the stock&apos;s own past year, whether the average trade
          got larger or smaller, and whether days of unusually heavy delivery kept coming. Each footprint is
          labelled A (the conventional reading is accumulation), D (distribution) or N (neutral).
        </p>
        <p>
          <b>Why the labels come with a track record.</b> Over 3 years, delivery concentrated on up days came{' '}
          <i>before</i> down-runs, not before up-runs: the delivery on up days compared with down days was
          2.16 times before big falls and 0.62 times before big rises. Larger trades also came before falls.
          So the conventional reading of an A label may not hold, and the page shows, next to every list and
          every indicator, what each reading was followed by in the past: the median return against other
          stocks over the next 60 and 120 trading days, how often it came out ahead, and how many cases that
          rests on.
        </p>
        <p className="text-slate-600 dark:text-slate-300">
          The track record is one sample period with today&apos;s index membership and no costs. Evidence
          summary, not advice. You decide.
        </p>
      </div>
    </section>
  );
}
