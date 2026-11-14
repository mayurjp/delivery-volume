import { useMemo, useState } from 'react';
import { fmtDate, MONTH_NAMES, pad2 } from '../lib/format';
import { useApp, useGlobalState } from '../lib/hooks';
import { Popover } from './ui';

/** Day-mode date control: previous/next arrows and a month grid in which only trading days are enabled. */
export default function DateControl() {
  const { meta } = useApp();
  const { date, setDate } = useGlobalState();
  const days = meta.tradingDays;
  const idx = days.indexOf(date);
  const set = useMemo(() => new Set(days), [days]);
  const [view, setView] = useState(date.slice(0, 7));
  const [seen, setSeen] = useState(date);
  if (seen !== date) {
    setSeen(date);
    setView(date.slice(0, 7));
  }
  const [y, m] = view.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    setView(`${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}`);
  };
  const minView = meta.firstDate.slice(0, 7);
  const maxView = meta.latestDate.slice(0, 7);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="btn px-2"
        aria-label="Previous trading day"
        disabled={idx <= 0}
        onClick={() => setDate(days[idx - 1]!)}
      >
        {'‹'}
      </button>
      <Popover
        button={(toggle) => (
          <button
            type="button"
            className="btn whitespace-nowrap num"
            onClick={toggle}
            aria-label={`Trading date ${fmtDate(date)}; change`}
          >
            {fmtDate(date)}
          </button>
        )}
      >
        <div className="card w-64 p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between text-sm">
            <button
              type="button"
              className="btn px-2"
              aria-label="Previous month"
              disabled={view <= minView}
              onClick={() => shift(-1)}
            >
              {'‹'}
            </button>
            <span>
              {MONTH_NAMES[m - 1]} {y}
            </span>
            <button
              type="button"
              className="btn px-2"
              aria-label="Next month"
              disabled={view >= maxView}
              onClick={() => shift(1)}
            >
              {'›'}
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <div key={i} className="py-1 text-slate-500 dark:text-slate-400">
                {d}
              </div>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <div key={`b${i}`} />
            ))}
            {Array.from({ length: count }, (_, i) => {
              const iso = `${view}-${pad2(i + 1)}`;
              const ok = set.has(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!ok}
                  onClick={() => setDate(iso)}
                  className={`rounded py-1 ${iso === date ? 'bg-blue-600 text-white' : ok ? 'hover:bg-slate-100 dark:hover:bg-slate-800' : 'text-slate-300 dark:text-slate-700'}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      </Popover>
      <button
        type="button"
        className="btn px-2"
        aria-label="Next trading day"
        disabled={idx < 0 || idx >= days.length - 1}
        onClick={() => setDate(days[idx + 1]!)}
      >
        {'›'}
      </button>
    </div>
  );
}
