/** One palette for every chart (05 section 5). Delivery increase = blue, decrease = orange; candles green up / red down. */

export interface Palette {
  text: string;
  muted: string;
  grid: string;
  bg: string;
  inc: string;
  dec: string;
  up: string;
  down: string;
  delivered: string;
  nonDelivered: string;
  line: string;
  line2: string;
  band: string;
  /** Sequential scale for the calendar heat map (low to high delivery %). */
  seq: string[];
}

export const LIGHT: Palette = {
  text: '#0f172a',
  muted: '#64748b',
  grid: '#e2e8f0',
  bg: '#ffffff',
  inc: '#1d6fd1',
  dec: '#d9730d',
  up: '#0f9d58',
  down: '#d93025',
  delivered: '#1d6fd1',
  nonDelivered: '#cbd5e1',
  line: '#0e7490',
  line2: '#7c3aed',
  band: 'rgba(29,111,209,0.14)',
  seq: ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'],
};

export const DARK: Palette = {
  text: '#e2e8f0',
  muted: '#94a3b8',
  grid: '#1e293b',
  bg: '#0f172a',
  inc: '#60a5fa',
  dec: '#fb923c',
  up: '#34d399',
  down: '#f87171',
  delivered: '#60a5fa',
  nonDelivered: '#475569',
  line: '#22d3ee',
  line2: '#c4b5fd',
  band: 'rgba(96,165,250,0.18)',
  seq: ['#172554', '#1e3a8a', '#2563eb', '#60a5fa', '#dbeafe'],
};

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT;
}

/** CSS class for a signed delivery-style change: blue up, orange down. */
export function deliveryClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return '';
  return v > 0 ? 'text-inc dark:text-inc-dark' : 'text-dec dark:text-dec-dark';
}

/** CSS class for a price move: green up, red down. */
export function priceClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return '';
  return v > 0 ? 'text-up dark:text-up-dark' : 'text-down dark:text-down-dark';
}
