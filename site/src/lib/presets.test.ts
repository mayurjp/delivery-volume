import { describe, expect, it } from 'vitest';
import { defaultFilters } from './filters';
import { PRESET_BY_ID, PRESET_GROUPS, dailyWatchParams } from './presets';
import { parseFilters } from './urlState';

const INDICES = ['NIFTY50', 'NIFTYNEXT50', 'NIFTY100', 'NIFTY200', 'NIFTY500'];

describe('Daily delivery watch', () => {
  it('sets exactly the approved filters and the Delivery spikes preset, as a shareable URL', () => {
    const next = dailyWatchParams(new URLSearchParams(), 1);
    expect(next.toString()).toBe('u=NIFTY500&mt=5&he=1&hetf=1&p=spikes');
    const f = parseFilters(next, 1, INDICES);
    expect(f).toEqual({
      ...defaultFilters(1),
      u: 'NIFTY500',
      minTurn: 5,
      hideEtfs: true,
      hideEvents: true,
    });
    expect(PRESET_BY_ID.get(next.get('p')!)!.label).toBe('Delivery spikes');
  });

  it('keeps the date, replaces other filters, and clears sort, search and range state', () => {
    const cur = new URLSearchParams(
      'd=2026-11-10&u=NIFTY50&b=L&sec=IT&mp=100&s=ret1:d&q=abc&rng=1&r=3M&p=acc',
    );
    const next = dailyWatchParams(cur, 1);
    expect(next.toString()).toBe('d=2026-11-10&u=NIFTY500&mt=5&he=1&hetf=1&p=spikes');
  });
});

describe('preset groups', () => {
  it('has the approved groups and order, with More collapsed', () => {
    expect(PRESET_GROUPS.map((g) => g.label)).toEqual([
      'Start here',
      'Direction',
      'Patterns',
      'F&O build-up',
      'More',
    ]);
    const label = (id: string) => PRESET_BY_ID.get(id)!.label;
    expect(PRESET_GROUPS[0]!.ids.map(label)).toEqual([
      'Delivery spikes',
      'Unusual vs own history',
      'Largest delivery value',
    ]);
    expect(PRESET_GROUPS[1]!.ids.map(label)).toEqual([
      'Up on heavy delivery',
      'Down on heavy delivery',
      'Delivery ↑ + Long build-up',
    ]);
    expect(PRESET_GROUPS[2]!.ids.map(label)).toEqual([
      'New 52-week high, low delivery',
      'New 52-week high, heavy delivery',
    ]);
    expect(PRESET_GROUPS[3]!.ids.map(label)).toEqual([
      'Long build-up',
      'Short build-up',
      'Short covering',
      'Long unwinding',
    ]);
    expect(PRESET_GROUPS[4]!.collapsed).toBe(true);
    const all = PRESET_GROUPS.flatMap((g) => g.ids);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(PRESET_BY_ID.size); // every preset sits in a group
  });
});
