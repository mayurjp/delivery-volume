import { describe, expect, it } from 'vitest';
import { buildupRuns } from '../components/FoPane';
import { PRESET_BY_ID, runPreset } from './presets';
import { PRESET_NEEDS, presetBlockedBy } from './screenerTf';
import {
  BUILDUP_LABEL,
  BUILDUP_MEANING,
  FO_PANE_STRINGS,
  confluenceLabel,
  foHistory,
  latestLine,
} from './fo';
import type { DailyRow } from '../types/data';

describe('confluence badges (04 section 4.4)', () => {
  it('pairs heavy delivery with the matching build-up and nothing else', () => {
    expect(confluenceLabel('ACC', 'LB')).toBe('Heavy delivery + long build-up');
    expect(confluenceLabel('DIS', 'SB')).toBe('Heavy delivery + short build-up');
    expect(confluenceLabel('ACC', 'SC')).toBe('Heavy delivery + short covering');
    expect(confluenceLabel('ACC', 'SB')).toBeNull();
    expect(confluenceLabel('DIS', 'LB')).toBeNull();
    expect(confluenceLabel('SPU', 'LB')).toBeNull();
    expect(confluenceLabel(null, 'LB')).toBeNull();
    expect(confluenceLabel('ACC', null)).toBeNull();
  });
});

describe('the stock page F&O history', () => {
  it('reads the fo block by column name and maps missing cells to null', () => {
    const h = foHistory({
      columns: ['date', 'futOi', 'futOiChgPct', 'buildup', 'pcr'],
      rows: [
        ['2026-11-12', 1000, null, null, 0.8],
        ['2026-11-13', 1100, 10, 'LB', null],
      ],
    });
    expect(h).toEqual([
      { date: '2026-11-12', futOi: 1000, futOiChgPct: null, buildup: null, pcr: 0.8 },
      { date: '2026-11-13', futOi: 1100, futOiChgPct: 10, buildup: 'LB', pcr: null },
    ]);
    expect(foHistory(undefined)).toEqual([]);
  });

  it('groups consecutive days with the same build-up into one shaded run', () => {
    const h = foHistory({
      columns: ['date', 'futOi', 'futOiChgPct', 'buildup', 'pcr'],
      rows: [
        ['2026-11-09', 1, 0, 'LB', null],
        ['2026-11-10', 1, 0, 'LB', null],
        ['2026-11-11', 1, 0, null, null],
        ['2026-11-12', 1, 0, 'SB', null],
        ['2026-11-13', 1, 0, 'SB', null],
      ],
    });
    expect(buildupRuns(h)).toEqual([
      ['2026-11-09', '2026-11-10', 'LB'],
      ['2026-11-12', '2026-11-13', 'SB'],
    ]);
  });

  it('says the latest day in words, including a missing OI change', () => {
    expect(latestLine(undefined)).toBe('No F&O data for the latest day.');
    expect(latestLine({ date: 'x', futOi: 5, futOiChgPct: 2.5, buildup: 'LB', pcr: null })).toBe(
      'Long build-up; OI change +2.50%',
    );
    expect(latestLine({ date: 'x', futOi: 5, futOiChgPct: null, buildup: null, pcr: null })).toBe(
      'No build-up code on this day; OI change not measured (roll or gap)',
    );
  });
});

describe('Screener build-up presets', () => {
  const row = (over: Partial<DailyRow>): DailyRow => ({
    sym: 'X',
    series: 'EQ',
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    prevClose: 1,
    vwap: 1,
    vol: 1,
    turnoverCr: 1,
    trades: 1,
    delivQty: 1,
    delivPct: 1,
    delivValCr: 1,
    delivValAvg5: 1,
    delivValAvg20: 1,
    delivValAvg50: 1,
    delivPctAvg20: 1,
    volAvg20: 1,
    turnoverAvg20Cr: 1,
    tradeSizeRatio: 1,
    spike: 1,
    delivPctDiff: 0,
    relVol: 1,
    ret1: 1,
    clv: 0,
    vwapGap: 0,
    delivPctZ60: 0,
    delivPctPctile: 0,
    streak: 0,
    signal: null,
    flags: 0,
    futOi: 100,
    futOiChgPct: 3,
    buildup: null,
    pcr: 1,
    ...over,
  });

  it('Delivery up plus long build-up needs an ACC signal and an LB code', () => {
    const p = PRESET_BY_ID.get('accLB')!;
    const rows = [
      row({ sym: 'A', signal: 'ACC', buildup: 'LB', spike: 3 }),
      row({ sym: 'B', signal: 'ACC', buildup: 'SC', spike: 4 }),
      row({ sym: 'C', signal: null, buildup: 'LB', spike: 5 }),
    ];
    expect(runPreset(p, rows, new Map()).map((r) => r.sym)).toEqual(['A']);
  });

  it('the build-up presets read their own code and rank by the OI change', () => {
    const rows = [
      row({ sym: 'A', buildup: 'SC', futOiChgPct: -5 }),
      row({ sym: 'B', buildup: 'SC', futOiChgPct: -2 }),
      row({ sym: 'C', buildup: 'LB', futOiChgPct: 9 }),
      row({ sym: 'D', buildup: null, futOiChgPct: -9 }),
    ];
    expect(runPreset(PRESET_BY_ID.get('buSC')!, rows, new Map()).map((r) => r.sym)).toEqual(['A', 'B']);
    expect(runPreset(PRESET_BY_ID.get('buLB')!, rows, new Map()).map((r) => r.sym)).toEqual(['C']);
  });

  it('every F&O preset is blocked with a reason when the F&O columns are not published', () => {
    const missing = new Set(['futOi', 'futOiChgPct', 'buildup', 'pcr']);
    for (const id of ['accLB', 'buLB', 'buSB', 'buSC', 'buLU']) {
      expect(PRESET_NEEDS[id], id).toBeDefined();
      expect(presetBlockedBy(id, missing).length, id).toBeGreaterThan(0);
    }
  });
});

describe('F&O pane wording', () => {
  it('avoids advice and rating words in every pane string and build-up label', () => {
    const strings = [...FO_PANE_STRINGS, ...Object.values(BUILDUP_LABEL), ...Object.values(BUILDUP_MEANING)];
    const banned = /\b(bullish|bearish|buy|sell|hold|add|reduce|exit|confirmed|rating|score|recommend)\w*/i;
    for (const s of strings) expect(s, s).not.toMatch(banned);
  });
});
