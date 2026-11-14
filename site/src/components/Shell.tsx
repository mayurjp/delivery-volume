import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { fmtDate, MONTH_NAMES, pad2 } from '../lib/format';
import { useApp, useGlobalState } from '../lib/hooks';
import { cycleTheme, useThemeChoice } from '../lib/theme';
import { carryParams } from '../lib/urlState';
import { useWatchlist } from '../lib/watchlist';
import FilterPanel from './FilterPanel';
import { Skeleton } from './ui';

export const DISCLAIMER =
  'Data source: NSE India (nseindia.com). FII/DII figures are provisional. For education only; not investment advice. Not affiliated with NSE.';

const NAV: { to: string; label: string; icon: string }[] = [
  { to: '/', label: 'Dashboard', icon: '▦' },
  { to: '/screener', label: 'Screener', icon: '☰' },
  { to: '/watchlist', label: 'Watchlist', icon: '★' },
  { to: '/learn', label: 'Learn', icon: '?' },
];

function Nav({ rail }: { rail: boolean }) {
  const { search } = useLocation();
  const q = carryParams(new URLSearchParams(search));
  return (
    <nav
      aria-label="Main"
      className={
        rail
          ? 'hidden w-44 shrink-0 flex-col gap-1 border-r border-slate-200 p-3 dark:border-slate-800 lg:flex'
          : 'fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:hidden'
      }
    >
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={`${n.to}${q}`}
          end={n.to === '/'}
          className={({ isActive }) =>
            rail
              ? `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-slate-800 dark:text-blue-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`
              : `flex min-h-[48px] flex-1 flex-col items-center justify-center text-xs ${isActive ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400'}`
          }
        >
          <span aria-hidden className={rail ? 'mr-2 inline-block w-4 text-center' : 'text-base leading-none'}>
            {n.icon}
          </span>
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Popover({
  button,
  children,
  align = 'left',
}: {
  button: (toggle: () => void, open: boolean) => ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {button(() => setOpen((o) => !o), open)}
      {open && (
        <div
          className={`absolute top-full z-40 mt-1 max-w-[calc(100vw-2rem)] ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function FreshnessChip() {
  const { meta } = useApp();
  const stale = Object.values(meta.sources).some((s) => s.latest !== null && s.latest < meta.latestDate);
  return (
    <Popover
      button={(toggle) => (
        <button
          type="button"
          onClick={toggle}
          className={`chip whitespace-nowrap ${stale ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : ''}`}
          title="Click for source freshness"
        >
          Data as of {fmtDate(meta.latestDate)}
          {stale ? ' (stale source)' : ''}
        </button>
      )}
    >
      <div className="card w-80 p-3 text-xs shadow-lg">
        <div className="mb-1 font-semibold">Source freshness</div>
        <table className="w-full">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="font-normal">Source</th>
              <th className="font-normal">Latest</th>
              <th className="text-right font-normal">Gaps</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(meta.sources).map(([k, s]) => (
              <tr
                key={k}
                className={
                  s.latest !== null && s.latest < meta.latestDate ? 'text-amber-700 dark:text-amber-300' : ''
                }
              >
                <td>{k}</td>
                <td>{fmtDate(s.latest)}</td>
                <td className="num text-right">{s.gaps.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-slate-500">Generated {meta.generatedAt}</p>
      </div>
    </Popover>
  );
}

/** Day-mode date control: previous/next arrows and a month grid in which only trading days are enabled. */
export function DateControl() {
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
              <div key={i} className="py-1 text-slate-500">
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

function ThemeToggle() {
  const c = useThemeChoice();
  return (
    <button
      type="button"
      className="btn px-2"
      onClick={cycleTheme}
      aria-label={`Theme: ${c}. Click to change`}
      title={`Theme: ${c}`}
    >
      {c === 'light' ? '☀' : c === 'dark' ? '☾' : '◐'}
    </button>
  );
}

function TopBar() {
  const { activeCount } = useGlobalState();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="mr-auto text-base font-semibold">Delivery Volume</span>
        <FreshnessChip />
        <DateControl />
        <div className="relative">
          <button
            type="button"
            className="btn gap-1"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-haspopup="dialog"
          >
            Filters
            {activeCount > 0 && (
              <span
                className="rounded-full bg-blue-600 px-1.5 text-xs text-white"
                aria-label={`${activeCount} filters active`}
              >
                {activeCount}
              </span>
            )}
          </button>
          {open && <FilterPanel onClose={() => setOpen(false)} />}
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-8 border-t border-slate-200 px-3 py-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
      {DISCLAIMER}
    </footer>
  );
}

export function PageFallback() {
  return (
    <div className="space-y-3 p-3" aria-busy>
      <Skeleton height={28} className="w-1/3" />
      <Skeleton height={160} />
      <Skeleton height={240} />
    </div>
  );
}

export default function Shell() {
  useWatchlist(); // keep the store subscribed app-wide
  return (
    <div className="flex min-h-full flex-col">
      <TopBar />
      <div className="flex min-w-0 flex-1">
        <Nav rail />
        <div className="flex min-w-0 flex-1 flex-col pb-14 lg:pb-0">
          <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-3 py-3">
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </main>
          <Footer />
        </div>
      </div>
      <Nav rail={false} />
    </div>
  );
}
