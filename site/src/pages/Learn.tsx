import FootprintLearn from '../components/FootprintLearn';
import TrailLearn from '../components/TrailLearn';
import { fmtDate } from '../lib/format';
import { useApp } from '../lib/hooks';
import { Link } from 'react-router-dom';
import { DELIVERY_TRUTH, FLAG_INFO, SIGNAL_LABEL, SIGNAL_MEANING } from '../lib/signals';
import type { SignalCode } from '../types/data';

const SOURCE_NAMES: Record<string, string> = {
  cm_delivery: 'Security-wise delivery (daily)',
  cm_udiff: 'UDiFF cash bhavcopy (ISIN map)',
  pr_zip: 'Market cap, corporate actions, price-band hits',
  indices_close: 'All-index close',
  hl52: '52-week high/low',
  fo_ban: 'F&O ban list',
  fii_dii_cash: 'FII/DII cash (provisional, latest day only)',
  deals: 'Bulk and block deals',
};

const TERMS: [string, string][] = [
  ['Delivery quantity', 'Shares that changed ownership at settlement, i.e. were not squared off intraday.'],
  ['Delivery %', 'Delivery quantity divided by traded quantity.'],
  [
    'T2T (BE/BZ series)',
    'Trade-for-trade: every trade must be delivered, so delivery % carries no information.',
  ],
  ['Spike', 'Today’s delivery value divided by its average over the prior 20 trading days.'],
  ['FII/FPI', 'Foreign institutional / portfolio investors.'],
  ['DII', 'Domestic institutions: mutual funds, insurers, banks, pension funds.'],
  [
    'Bulk deal',
    'One client trades more than 0.5% of a company’s listed shares in a day; the name is published.',
  ],
  ['Block deal', 'A large trade in the separate block-deal window; the name is published.'],
];

const TRAPS: [string, string][] = [
  [
    'Record dates',
    'Delivery often jumps before dividend, bonus and buyback record dates because people purchase shares to become eligible. That is not organic interest; the Corp action flag marks it.',
  ],
  [
    'Block and bulk deals',
    'One negotiated counterparty can create huge delivery on a single day. It says little about broad interest.',
  ],
  [
    'Circuits',
    'At an upper or lower circuit (the daily price limit) volume is one-sided and thin, so delivery % is inflated. The Circuit flag marks it.',
  ],
  [
    'Trade-for-trade (T2T)',
    'In BE/BZ series every trade is delivered, so delivery % is always high and not informative.',
  ],
  [
    'Splits and bonuses',
    'Raw quantities and prices are not adjusted. This site compares delivery value (₹) and delivery %, never raw quantity.',
  ],
  ['Expiry', 'F&O expiry and rollover distort volume and delivery around the monthly expiry.'],
  [
    'Provisional FII/DII data',
    'The daily FII/DII figures are provisional, combined across exchanges, and not per stock.',
  ],
  [
    'Current-constituents bias',
    'Index membership, sectors and cap buckets use today’s lists applied to the whole history, so past results flatter survivors.',
  ],
];

export default function Learn() {
  const { meta } = useApp();
  return (
    <article className="mx-auto max-w-3xl space-y-6 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">Learn: how to read delivery data</h1>

      <section className="card space-y-2 border-blue-300 p-4 dark:border-blue-800">
        <h2 className="text-base font-semibold">The one truth</h2>
        <p className="text-base font-medium">Every delivered share has both a buyer and a seller.</p>
        <p>{DELIVERY_TRUTH}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>High delivery means holders were changing hands: positional, often institutional, activity.</li>
          <li>Low delivery means mostly traders.</li>
          <li>
            Direction comes from price action: the return, where the close sits in the day&apos;s range, and
            the close versus VWAP.
          </li>
        </ul>
        <p>
          So every label on this site combines a delivery metric with a price metric. Labels describe what
          happened; they never predict.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">What each signal means</h2>
        <dl className="card divide-y divide-slate-100 dark:divide-slate-800">
          {(Object.keys(SIGNAL_LABEL) as SignalCode[]).map((k) => (
            <div key={k} className="p-3">
              <dt className="font-semibold">{SIGNAL_LABEL[k]}</dt>
              <dd className="text-slate-600 dark:text-slate-300">{SIGNAL_MEANING[k]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-slate-600 dark:text-slate-300">
          A signal needs at least 10 prior valid days, a liquid stock and an EQ-series row. It is a
          description of one day, not a forecast, and not advice to do anything.
        </p>
      </section>

      <section className="space-y-2" aria-label="Flag legend">
        <h2 className="text-base font-semibold">Flag legend</h2>
        <p className="text-slate-600 dark:text-slate-300">
          Small labels next to a stock mark context that can distort delivery data. They never hide a signal.
        </p>
        <dl className="card divide-y divide-slate-100 dark:divide-slate-800">
          {FLAG_INFO.map((f) => (
            <div key={f.bit} className="p-3">
              <dt>
                <span className="rounded border border-slate-300 px-1 text-xs font-semibold dark:border-slate-600">
                  {f.short}
                </span>{' '}
                <span className="font-semibold">{f.label}</span>
              </dt>
              <dd className="text-slate-600 dark:text-slate-300">{f.hint}</dd>
            </div>
          ))}
          <div className="p-3">
            <dt>
              <span className="rounded bg-slate-200 px-1 text-xs font-medium dark:bg-slate-700">ETF</span>{' '}
              <span className="font-semibold">Exchange-traded fund</span>
            </dt>
            <dd className="text-slate-600 dark:text-slate-300">
              ETF delivery reflects creation and redemption, so ETFs get no signal and no market-cap rank.
              Market statistics count stocks only, with ETFs on their own line.
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2" aria-label="What a year of data showed">
        <h2 className="text-base font-semibold">What a year of data showed</h2>
        <div className="card space-y-2 p-4">
          <p>
            We measured what happened to a stock after each kind of delivery event over one year (256 trading
            days, about 390,000 stock-days, stocks only, ETFs excluded). Each result is the stock&apos;s
            20-day return minus the median return of its cap group on the same day; &ldquo;beat peers&rdquo;
            is the share of cases that came out ahead.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              A heavy-delivery up day did <b>not</b> predict further outperformance: median −0.07%, beat peers
              50% of the time. In large caps it was worse (−0.98%, 44%).
            </li>
            <li>
              In large caps, a heavy-delivery <i>down</i> day was followed by a partial rebound: beat peers
              58% of the time, falling to 53% when measured from the next day&apos;s close.
            </li>
            <li>
              A rise on <b>low</b> delivery faded in small and micro caps (micro: −0.91%, 46%), but not in
              large caps.
            </li>
            <li>
              New 52-week highs did best when delivery was <b>low</b> (+2.50%, 61%) and worse when it was
              heavy (+0.87%, 53%). Next-day entry gave about the same result.
            </li>
            <li>Streaks of above-average delivery (5 or 10 days) showed no edge.</li>
            <li>
              Futures build-up on its own showed no edge, and it did not rescue a heavy-delivery up day.
            </li>
          </ul>
          <p className="text-slate-600 dark:text-slate-300">
            Treat these as descriptions of one year, not rules: it was a year when momentum worked well, cap
            groups and index membership are today&apos;s, the figures are before costs, and overlapping events
            make small differences noise. The live numbers, with the sample size for every cell, are in the{' '}
            <Link to="/stats" className="text-blue-700 underline dark:text-blue-300">
              signal-performance table on the Stats page
            </Link>
            .
          </p>
        </div>
      </section>

      <TrailLearn />

      <FootprintLearn />

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Traps</h2>
        <dl className="card divide-y divide-slate-100 dark:divide-slate-800">
          {TRAPS.map(([t, d]) => (
            <div key={t} className="p-3">
              <dt className="font-semibold">{t}</dt>
              <dd className="text-slate-600 dark:text-slate-300">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Glossary</h2>
        <dl className="card divide-y divide-slate-100 dark:divide-slate-800">
          {TERMS.map(([t, d]) => (
            <div key={t} className="p-3">
              <dt className="font-semibold">{t}</dt>
              <dd className="text-slate-600 dark:text-slate-300">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Data sources and update times</h2>
        <p>
          All data comes from NSE India&apos;s public end-of-day files. A scheduled job fetches them each
          weekday evening (about 19:00 and 22:00 IST, with a morning catch-up), so the site normally shows the
          previous trading day by evening. SME stocks are excluded.
        </p>
        <div className="card overflow-x-auto" tabIndex={0}>
          <table className="num w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-slate-600 dark:text-slate-400">
              <tr>
                <th className="p-2 font-medium">Source</th>
                <th className="p-2 font-medium">Latest</th>
                <th className="p-2 text-right font-medium">Gap days</th>
                <th className="p-2 font-medium">Collecting since</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(meta.sources).map(([k, s]) => (
                <tr key={k} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-2">{SOURCE_NAMES[k] ?? k}</td>
                  <td
                    className={`p-2 ${s.latest !== null && s.latest < meta.latestDate ? 'text-amber-700 dark:text-amber-300' : ''}`}
                  >
                    {fmtDate(s.latest)}
                  </td>
                  <td className="p-2 text-right">{s.gaps.length}</td>
                  <td className="p-2">{s.collectingSince ? fmtDate(s.collectingSince) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Index constituents as of {fmtDate(meta.constituentsAsOf)}. Generated {meta.generatedAt}.
        </p>
      </section>
    </article>
  );
}
