import { useMemo, useState } from 'react';
import {
  clampN,
  N_MAX,
  N_MIN,
  periodFor,
  periodLabel,
  periodsOf,
  TF_OPTIONS,
  type TfBase,
  type TimeframeState,
} from '../lib/timeframe';
import { partialText } from '../lib/aggregate';
import { useApp, useGlobalState, usePeriods, useTimeframe } from '../lib/hooks';
import DateControl from './DateControl';

/** The segmented D | W | M | Q | Custom switch (08 sections 1 and 5A), stored in the URL as tf=... */
function TfSwitch({ state, onChange }: { state: TimeframeState; onChange: (s: TimeframeState) => void }) {
  const active = state.tf === 'r' ? 'c' : state.tf;
  return (
    <div
      role="group"
      aria-label="Timeframe"
      className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-700"
    >
      {TF_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.title}
          aria-pressed={active === o.id}
          onClick={() => onChange({ ...state, tf: o.id === 'c' && state.tf === 'r' ? 'r' : o.id })}
          className={`px-2 py-1 text-sm ${active === o.id ? 'bg-blue-600 text-white' : 'bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Week, month and quarter picker: arrows and a list. It simply sets the global date to the period's last trading day. */
function PeriodPicker({ tf }: { tf: 'w' | 'm' | 'q' }) {
  const { date, setDate } = useGlobalState();
  const periods = usePeriods();
  const list = useMemo(() => (periods.data ? periodsOf(periods.data, tf) : []), [periods.data, tf]);
  if (list.length === 0) return <span className="text-sm text-slate-500">Loading periods…</span>;
  const cur = periodFor(list, date)!;
  const i = list.indexOf(cur);
  const word = tf === 'w' ? 'week' : tf === 'm' ? 'month' : 'quarter';
  return (
    <div className="flex items-center gap-1" data-testid="period-picker">
      <button
        type="button"
        className="btn px-2"
        aria-label={`Previous ${word}`}
        disabled={i <= 0}
        onClick={() => setDate(list[i - 1]!.end)}
      >
        {'‹'}
      </button>
      <select
        className="btn max-w-[11rem] py-1"
        aria-label={`Pick a ${word}`}
        value={cur.key}
        onChange={(e) => {
          const p = list.find((x) => x.key === e.target.value);
          if (p) setDate(p.end);
        }}
      >
        {[...list].reverse().map((p) => (
          <option key={p.key} value={p.key}>
            {periodLabel(tf, p)}
            {p.partial ? ` · ${partialText(p)}` : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn px-2"
        aria-label={`Next ${word}`}
        disabled={i >= list.length - 1}
        onClick={() => setDate(list[i + 1]!.end)}
      >
        {'›'}
      </button>
    </div>
  );
}

/** Custom: N-day bars (tf=c, 2-120 trading days, aligned to end at the chosen date) or a start-end date range (tf=r). */
function CustomControls({
  state,
  onChange,
}: {
  state: TimeframeState;
  onChange: (s: TimeframeState) => void;
}) {
  const { meta } = useApp();
  const { date } = useGlobalState();
  const [draft, setDraft] = useState(String(state.n));
  const range = state.tf === 'r';
  const bars = (
    <label className="flex items-center gap-1 text-sm">
      <span className="text-slate-600 dark:text-slate-400">Bar size</span>
      <input
        type="number"
        inputMode="numeric"
        min={N_MIN}
        max={N_MAX}
        value={draft}
        aria-label="Bar size in trading days"
        className="btn w-16 py-1"
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= N_MIN && n <= N_MAX) onChange({ ...state, tf: 'c', n: clampN(n) });
        }}
        onBlur={() => setDraft(String(clampN(Number(draft) || state.n)))}
      />
      <span className="text-slate-600 dark:text-slate-400">trading days</span>
    </label>
  );
  const from = state.from ?? meta.tradingDays[Math.max(0, meta.tradingDays.indexOf(date) - 20)]!;
  const to = state.to ?? date;
  const rangeControls = (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <input
        type="date"
        aria-label="Range start"
        className="btn py-1"
        min={meta.firstDate}
        max={meta.latestDate}
        value={from}
        onChange={(e) => onChange({ ...state, tf: 'r', from: e.target.value || null, to })}
      />
      <span aria-hidden>–</span>
      <input
        type="date"
        aria-label="Range end"
        className="btn py-1"
        min={meta.firstDate}
        max={meta.latestDate}
        value={to}
        onChange={(e) => onChange({ ...state, tf: 'r', from, to: e.target.value || null })}
      />
      <select
        className="btn py-1"
        aria-label="Baseline"
        value={state.base}
        onChange={(e) => onChange({ ...state, tf: 'r', from, to, base: e.target.value as TfBase })}
      >
        <option value="prev">vs previous equal period</option>
        <option value="20">vs prior 20 days</option>
        <option value="50">vs prior 50 days</option>
      </select>
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="custom-controls">
      <div
        role="group"
        aria-label="Custom mode"
        className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700"
      >
        <button
          type="button"
          aria-pressed={!range}
          className={`px-2 py-1 ${!range ? 'bg-slate-200 dark:bg-slate-700' : ''}`}
          onClick={() => onChange({ ...state, tf: 'c' })}
        >
          N-day bars
        </button>
        <button
          type="button"
          aria-pressed={range}
          className={`px-2 py-1 ${range ? 'bg-slate-200 dark:bg-slate-700' : ''}`}
          onClick={() => onChange({ ...state, tf: 'r', from, to })}
        >
          Date range
        </button>
      </div>
      {range ? rangeControls : bars}
    </div>
  );
}

/** Top-bar timeframe control: the switch, then the date, period or custom controls that belong to it. */
export default function TimeframeControl() {
  const { state, setState } = useTimeframe();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TfSwitch state={state} onChange={setState} />
      {state.tf === 'd' ? (
        <DateControl />
      ) : state.tf === 'w' || state.tf === 'm' || state.tf === 'q' ? (
        <PeriodPicker tf={state.tf} />
      ) : (
        <CustomControls state={state} onChange={setState} />
      )}
    </div>
  );
}
