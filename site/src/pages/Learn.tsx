import { fmtDate } from '../lib/format';
import { useApp } from '../lib/hooks';
import { DELIVERY_TRUTH, SIGNAL_LABEL, SIGNAL_MEANING } from '../lib/signals';
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
    'Delivery often jumps before dividend, bonus and buyback record dates because people buy to become eligible. That is not organic interest; the CA flag marks it.',
  ],
  [
    'Block and bulk deals',
    'One negotiated counterparty can create huge delivery on a single day. It says little about broad interest.',
  ],
  ['Circuits', 'At an upper or lower circuit, volume is one-sided and thin, so delivery % is inflated.'],
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
        <div className="card overflow-x-auto">
          <table className="num w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-slate-500">
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
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Index constituents as of {fmtDate(meta.constituentsAsOf)}. Generated {meta.generatedAt}.
        </p>
      </section>
    </article>
  );
}
