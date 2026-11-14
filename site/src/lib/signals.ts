import { FLAG, type SignalCode } from '../types/data';

/**
 * Signal labels describe what happened on the day; they never predict and are never "bullish", "bearish",
 * a buy or a sell (04 section 0 and 4.1).
 */
export const SIGNAL_LABEL: Record<SignalCode, string> = {
  ACC: 'Up on heavy delivery',
  DIS: 'Down on heavy delivery',
  ABS: 'Heavy delivery, flat price',
  SPU: 'Up on low delivery',
  SPD: 'Down on low delivery',
};

export const SIGNAL_MEANING: Record<SignalCode, string> = {
  ACC: 'The price rose on unusually high delivery and closed near the high.',
  DIS: 'The price fell on unusually high delivery and closed near the low.',
  ABS: 'A large transfer of shares with little price change.',
  SPU: 'The rise came mostly from intraday trading; little of it ended in delivery.',
  SPD: 'The fall came mostly from intraday trading; little of it ended in delivery.',
};

/** Shown in every signal tooltip (04 section 0). */
export const DELIVERY_TRUTH =
  'Every delivered share has both a buyer and a seller. Delivery % shows how much trading ended in a change of ownership, not who won. Direction comes from the price.';

export const FLAG_INFO: { bit: number; short: string; label: string; hint: string }[] = [
  {
    bit: FLAG.t2t,
    short: 'T2T',
    label: 'Trade-for-trade',
    hint: 'BE/BZ series: every trade is delivered, so delivery % carries no information.',
  },
  {
    bit: FLAG.corpAction,
    short: 'CA',
    label: 'Corporate action',
    hint: 'A dividend, bonus, split, rights or buyback ex-date is within 2 trading days; delivery may be inflated by record-date buying.',
  },
  {
    bit: FLAG.bulkDeal,
    short: 'BD',
    label: 'Bulk deal',
    hint: 'A bulk deal was reported: one negotiated counterparty, not broad interest.',
  },
  {
    bit: FLAG.blockDeal,
    short: 'BK',
    label: 'Block deal',
    hint: 'A block deal was reported: one negotiated counterparty, not broad interest.',
  },
  {
    bit: FLAG.bandHit,
    short: 'CKT',
    label: 'Price band hit',
    hint: 'At a circuit limit volume is one-sided and thin, so delivery % is inflated.',
  },
  { bit: FLAG.fnoBan, short: 'BAN', label: 'F&O ban', hint: 'In the F&O ban list today.' },
  {
    bit: FLAG.high52,
    short: '52H',
    label: 'New 52-week high',
    hint: 'Today’s high is above the 52-week high through the previous day.',
  },
  {
    bit: FLAG.low52,
    short: '52L',
    label: 'New 52-week low',
    hint: 'Today’s low is below the 52-week low through the previous day.',
  },
  {
    bit: FLAG.lowLiquidity,
    short: 'LIQ',
    label: 'Low liquidity',
    hint: '20-day average turnover is below the liquidity floor.',
  },
  {
    bit: FLAG.newListing,
    short: 'NEW',
    label: 'New listing',
    hint: 'Fewer than 20 valid prior days of history.',
  },
  {
    bit: FLAG.expiryWeek,
    short: 'EXP',
    label: 'Expiry week',
    hint: 'F&O expiry is within 5 trading days; rollover distorts volume.',
  },
];

export function flagsOf(flags: number) {
  return FLAG_INFO.filter((f) => (flags & f.bit) !== 0);
}
