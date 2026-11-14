import type { Bucket } from '../types/data';

export const BUCKET_LABEL: Record<Bucket, string> = {
  L: 'Large (1–100)',
  M: 'Mid (101–250)',
  S: 'Small (251–500)',
  U: 'Micro (501+)',
};

export const UNIVERSE_OPTIONS: { key: string; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'NIFTY50', label: 'Nifty 50' },
  { key: 'NIFTYNEXT50', label: 'Nifty Next 50 (Junior Nifty)' },
  { key: 'NIFTY100', label: 'Nifty 100' },
  { key: 'NIFTY200', label: 'Nifty 200' },
  { key: 'NIFTY500', label: 'Nifty 500' },
  { key: 'MIDCAP150', label: 'Midcap 150' },
  { key: 'SMALLCAP250', label: 'Smallcap 250' },
  { key: 'MICROCAP250', label: 'Microcap 250' },
  { key: 'TOTALMARKET', label: 'Total Market' },
  { key: 'WATCHLIST', label: 'Watchlist' },
];
