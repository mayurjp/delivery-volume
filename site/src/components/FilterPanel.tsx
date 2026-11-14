import { useEffect, useRef } from 'react';
import { useApp, useGlobalState } from '../lib/hooks';
import { BUCKET_LABEL, UNIVERSE_OPTIONS } from '../lib/labels';
import type { Bucket } from '../types/data';
import { NumInput } from './ui';

const BUCKETS: Bucket[] = ['L', 'M', 'S', 'U'];

/** Global filters (05 section 2): a full-height drawer on mobile, a popover on desktop. Every change updates the URL. */
export default function FilterPanel({ onClose }: { onClose: () => void }) {
  const { meta } = useApp();
  const { filters: f, defaults, setFilters, activeCount } = useGlobalState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const sectors = [...meta.sectors, 'Unclassified'];
  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Filters"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white p-4 shadow-xl outline-none dark:bg-slate-900 lg:absolute lg:inset-auto lg:right-0 lg:top-full lg:mt-1 lg:max-h-[80vh] lg:w-96 lg:rounded-lg lg:border lg:border-slate-300 lg:dark:border-slate-700"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Filters</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            disabled={activeCount === 0}
            onClick={() => setFilters(defaults)}
          >
            Reset
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block font-medium">Universe</span>
        <select
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
          value={f.u}
          onChange={(e) => setFilters({ ...f, u: e.target.value })}
        >
          {UNIVERSE_OPTIONS.filter(
            (o) => o.key === 'ALL' || o.key === 'WATCHLIST' || meta.indices.includes(o.key),
          ).map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="mb-1 text-sm">
        <legend className="mb-1 font-medium">Market cap</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {BUCKETS.map((b) => (
            <label key={b} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={f.b.includes(b)}
                onChange={() => setFilters({ ...f, b: toggle(f.b, b) })}
              />
              {BUCKET_LABEL[b]}
            </label>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NumInput
            label="Minimum market cap, rupees crore"
            placeholder="Min ₹ Cr"
            value={f.capMin}
            onCommit={(v) => setFilters({ ...f, capMin: v })}
          />
          <NumInput
            label="Maximum market cap, rupees crore"
            placeholder="Max ₹ Cr"
            value={f.capMax}
            onCommit={(v) => setFilters({ ...f, capMax: v })}
          />
        </div>
      </fieldset>
      <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
        Uses current index constituents and today&apos;s market-cap ranks. Large = rank 1&ndash;100 and Mid =
        101&ndash;250 (SEBI method); the Small/Micro split at 500 is this site&apos;s own.
      </p>

      <fieldset className="mb-3 text-sm">
        <legend className="mb-1 flex w-full items-center justify-between font-medium">
          <span>Sector</span>
          {f.sec.length > 0 && (
            <button type="button" className="text-xs underline" onClick={() => setFilters({ ...f, sec: [] })}>
              clear
            </button>
          )}
        </legend>
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-700">
          {sectors.map((s) => (
            <label key={s} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={f.sec.includes(s)}
                onChange={() => setFilters({ ...f, sec: toggle(f.sec, s) })}
              />
              {s}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
        <label>
          <span className="mb-1 block font-medium">Min 20D avg turnover (₹ Cr)</span>
          <NumInput
            label="Minimum 20 day average turnover"
            value={f.minTurn}
            onCommit={(v) => setFilters({ ...f, minTurn: v ?? defaults.minTurn })}
          />
        </label>
        <label>
          <span className="mb-1 block font-medium">Min price (₹)</span>
          <NumInput
            label="Minimum price"
            value={f.minPrice}
            onCommit={(v) => setFilters({ ...f, minPrice: v ?? 0 })}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.hideEvents}
          onChange={(e) => setFilters({ ...f, hideEvents: e.target.checked })}
        />
        Hide event-driven rows
      </label>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        Hides rows with a corporate action, bulk/block deal or price-band hit. Flag icons stay visible when
        off.
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.hideEtfs}
          onChange={(e) => setFilters({ ...f, hideEtfs: e.target.checked })}
        />
        Hide ETFs
      </label>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        ETFs and index funds are shown with an ETF badge by default. They have no signal and no market-cap
        rank.
      </p>
    </div>
  );
}
