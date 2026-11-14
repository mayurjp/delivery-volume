import { BASELINES, RANGE_PRESETS, type BaselineMode, type RangePreset } from '../lib/range';
import { useApp } from '../lib/hooks';
import type { RangeState } from '../lib/useRange';

/** Range presets, custom dates and the baseline selector (05 section 3). States the resolved ranges in words. */
export default function RangeControls({ state }: { state: RangeState }) {
  const { meta } = useApp();
  const { spec, resolved, setSpec } = state;
  const input =
    'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';
  return (
    <section aria-label="Range controls" className="card space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Range preset">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={spec.preset === p.id}
            className={`chip ${spec.preset === p.id ? 'bg-blue-600 text-white' : ''}`}
            onClick={() =>
              setSpec({
                ...spec,
                preset: p.id as RangePreset,
                a: p.id === 'C' ? (spec.a ?? resolved.range.a) : spec.a,
                b: p.id === 'C' ? (spec.b ?? resolved.range.b) : spec.b,
              })
            }
          >
            {p.label}
          </button>
        ))}
        {spec.preset === 'C' && (
          <span className="flex flex-wrap items-center gap-1 text-sm">
            <input
              type="date"
              aria-label="Range start"
              className={input}
              min={meta.firstDate}
              max={meta.latestDate}
              value={spec.a ?? resolved.range.a}
              onChange={(e) => e.target.value && setSpec({ ...spec, a: e.target.value })}
            />
            to
            <input
              type="date"
              aria-label="Range end"
              className={input}
              min={meta.firstDate}
              max={meta.latestDate}
              value={spec.b ?? resolved.range.b}
              onChange={(e) => e.target.value && setSpec({ ...spec, b: e.target.value })}
            />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500 dark:text-slate-400">Baseline</span>
          <select
            aria-label="Baseline"
            className={input}
            value={spec.baseline}
            onChange={(e) =>
              setSpec({
                ...spec,
                baseline: e.target.value as BaselineMode,
                ba: spec.ba ?? resolved.baseline?.a ?? null,
                bb: spec.bb ?? resolved.baseline?.b ?? null,
              })
            }
          >
            {BASELINES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        {spec.baseline === 'c' && (
          <span className="flex flex-wrap items-center gap-1">
            <input
              type="date"
              aria-label="Baseline start"
              className={input}
              min={meta.firstDate}
              max={meta.latestDate}
              value={spec.ba ?? resolved.baseline?.a ?? ''}
              onChange={(e) => e.target.value && setSpec({ ...spec, ba: e.target.value })}
            />
            to
            <input
              type="date"
              aria-label="Baseline end"
              className={input}
              min={meta.firstDate}
              max={meta.latestDate}
              value={spec.bb ?? resolved.baseline?.b ?? ''}
              onChange={(e) => e.target.value && setSpec({ ...spec, bb: e.target.value })}
            />
          </span>
        )}
      </div>
      <p className="text-sm" data-testid="range-text">
        {resolved.text}
        <span className="text-slate-500 dark:text-slate-400">
          . The range ends on the date picked at the top.
        </span>
      </p>
    </section>
  );
}
