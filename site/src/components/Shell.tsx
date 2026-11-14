import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { fmtDate } from '../lib/format';
import { useApp, useGlobalState } from '../lib/hooks';
import { cycleTheme, useThemeChoice } from '../lib/theme';
import { carryParams } from '../lib/urlState';
import { useWatchlist } from '../lib/watchlist';
import FilterPanel from './FilterPanel';
import TimeframeControl from './TimeframeControl';
import { Popover, Skeleton } from './ui';

export const DISCLAIMER =
  'Data source: NSE India (nseindia.com). FII/DII figures are provisional. For education only; not investment advice. Not affiliated with NSE.';

const NAV: { to: string; label: string; icon: string }[] = [
  { to: '/', label: 'Dashboard', icon: '▦' },
  { to: '/screener', label: 'Screener', icon: '☰' },
  { to: '/compare', label: 'Compare', icon: '⇄' },
  { to: '/heatmap', label: 'Heatmap', icon: '▩' },
];

/** Pages under "More" on the mobile tab bar (also listed in the desktop rail). */
const MORE: { to: string; label: string; icon: string }[] = [
  { to: '/institutions', label: 'Institutions', icon: '⌂' },
  { to: '/deals', label: 'Deals', icon: '≡' },
  { to: '/trail', label: 'Trail', icon: '⌇' },
  { to: '/runs', label: 'Runs', icon: '↕' },
  { to: '/stats', label: 'Stats', icon: '∿' },
  { to: '/watchlist', label: 'Watchlist', icon: '★' },
  { to: '/learn', label: 'Learn', icon: '?' },
];

function MoreMenu({ q }: { q: string }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const active = MORE.some((m) => pathname.startsWith(m.to));
  return (
    <div className="relative flex flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-[48px] flex-1 flex-col items-center justify-center text-xs ${active ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400'}`}
      >
        <span aria-hidden className="text-base leading-none">
          ⋯
        </span>
        More
      </button>
      {open && (
        <div
          role="menu"
          className="card absolute bottom-full right-1 z-40 mb-1 w-40 p-1 text-sm shadow-lg"
          onClick={() => setOpen(false)}
        >
          {MORE.map((m) => (
            <NavLink
              key={m.to}
              role="menuitem"
              to={`${m.to}${q}`}
              className="block rounded px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {m.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function Nav({ rail }: { rail: boolean }) {
  const { search } = useLocation();
  const q = carryParams(new URLSearchParams(search));
  const items = rail ? [...NAV, ...MORE] : NAV;
  return (
    <nav
      aria-label="Main"
      className={
        rail
          ? 'hidden w-44 shrink-0 flex-col gap-1 border-r border-slate-200 p-3 dark:border-slate-800 lg:flex'
          : 'fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:hidden'
      }
    >
      {items.map((n) => (
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
      {!rail && <MoreMenu q={q} />}
    </nav>
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
            <tr className="text-left text-slate-600 dark:text-slate-400">
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
        <p className="mt-2 text-slate-600 dark:text-slate-400">Generated {meta.generatedAt}</p>
      </div>
    </Popover>
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
        <TimeframeControl />
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
    <footer className="mt-8 border-t border-slate-200 px-3 py-4 text-xs text-slate-600 dark:text-slate-400 dark:border-slate-800 dark:text-slate-400">
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
