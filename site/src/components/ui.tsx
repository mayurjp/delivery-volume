import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, type LinkProps } from 'react-router-dom';
import { carryParams } from '../lib/urlState';
import { DELIVERY_TRUTH, flagsOf, SIGNAL_LABEL, SIGNAL_MEANING } from '../lib/signals';
import { useSignalPerf } from '../lib/hooks';
import { signalHistory } from '../lib/signalPerf';
import type { Bucket, SignalCode } from '../types/data';

/** A router link that carries the global filter and date params to the next page. */
export function AppLink({ to, children, ...rest }: Omit<LinkProps, 'to'> & { to: string }) {
  const { search } = useLocation();
  const carried = carryParams(new URLSearchParams(search));
  const [path, own] = to.split('?');
  const q = new URLSearchParams(carried.slice(1));
  if (own) for (const [k, v] of new URLSearchParams(own)) q.set(k, v);
  const s = q.toString();
  return (
    <Link to={s ? `${path}?${s}` : (path as string)} {...rest}>
      {children}
    </Link>
  );
}

export function Skeleton({ className = '', height }: { className?: string; height?: number }) {
  return <div className={`skeleton ${className}`} style={height ? { height } : undefined} aria-hidden />;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="card p-4 text-sm text-dec dark:text-dec-dark">
      Could not load data: {message}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">{children}</div>;
}

/** Tap/hover/focus tooltip: a button that toggles a bubble (works by touch, unlike the `title` attribute). */
export function Tip({
  label,
  children,
  className = '',
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <span ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="cursor-help"
      >
        {label}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[80vw] rounded-md border border-slate-300 bg-white p-2 text-left text-xs font-normal normal-case text-slate-800 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          {children}
        </span>
      )}
    </span>
  );
}

const SIGNAL_TONE: Record<SignalCode, string> = {
  ACC: 'border-inc text-inc dark:border-inc-dark dark:text-inc-dark',
  DIS: 'border-dec text-dec dark:border-dec-dark dark:text-dec-dark',
  ABS: 'border-slate-400 text-slate-600 dark:text-slate-300',
  SPU: 'border-slate-400 text-slate-600 dark:text-slate-300',
  SPD: 'border-slate-400 text-slate-600 dark:text-slate-300',
};

/**
 * Signal badge with a tap tooltip: what happened, the "one truth" about delivery, and a reserved slot for the
 * historical follow-through line (`history`, filled from stats/signal_perf.json in a later phase).
 */
export function SignalBadge({
  signal,
  history,
  bucket = null,
  plain = false,
}: {
  signal: SignalCode | null;
  history?: string;
  /** The stock's cap bucket: picks the signal_perf group for the "Historically" line. */
  bucket?: Bucket | null;
  plain?: boolean;
}) {
  const perf = useSignalPerf();
  if (!signal) return null;
  history = history ?? signalHistory(perf.data, signal, bucket);
  if (plain) {
    // inside virtualised table rows a bubble would be painted under the next row, so use the native title
    return (
      <span
        className={`chip whitespace-nowrap ${SIGNAL_TONE[signal]}`}
        title={`${SIGNAL_MEANING[signal]} ${DELIVERY_TRUTH}${history ? ` ${history}` : ''}`}
      >
        {SIGNAL_LABEL[signal]}
      </span>
    );
  }
  return (
    <Tip
      label={<span className={`chip whitespace-nowrap ${SIGNAL_TONE[signal]}`}>{SIGNAL_LABEL[signal]}</span>}
    >
      <strong className="block">{SIGNAL_LABEL[signal]}</strong>
      <span className="block">{SIGNAL_MEANING[signal]}</span>
      <span className="mt-1 block text-slate-500 dark:text-slate-400">{DELIVERY_TRUTH}</span>
      {history ? (
        <span data-slot="signal-history" className="mt-1 block">
          {history}
        </span>
      ) : null}
    </Tip>
  );
}

/** Small "ETF" badge for exchange-traded funds / index funds (no signal, no market-cap rank). */
export function EtfBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      title="Exchange-traded fund or index fund. Its delivery reflects creation/redemption and arbitrage, so it gets no signal and no market-cap rank."
      className="shrink-0 rounded bg-slate-200 px-1 text-[10px] font-medium leading-4 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
    >
      ETF
    </span>
  );
}

export function FlagIcons({ flags, only, plain = false }: { flags: number; only?: number; plain?: boolean }) {
  const list = flagsOf(only === undefined ? flags : flags & only);
  if (!list.length) return null;
  if (plain) {
    return (
      <span className="inline-flex gap-1 whitespace-nowrap">
        {list.map((f) => (
          <span
            key={f.bit}
            title={`${f.label}: ${f.hint}`}
            className="rounded border border-slate-300 px-1 text-[10px] leading-4 text-slate-600 dark:border-slate-600 dark:text-slate-300"
          >
            {f.short}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-0.5">
      {list.map((f) => (
        <Tip
          key={f.bit}
          label={
            <span className="rounded border border-slate-300 px-1 text-[10px] leading-4 text-slate-600 dark:border-slate-600 dark:text-slate-300">
              {f.short}
            </span>
          }
        >
          <strong className="block">{f.label}</strong>
          {f.hint}
        </Tip>
      ))}
    </span>
  );
}

export function Sparkline({
  values,
  width = 80,
  height = 24,
  label,
}: {
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  label?: string;
}) {
  const pts = values
    .map((v, i) => [i, v] as const)
    .filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden />;
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const n = values.length - 1 || 1;
  const d = pts
    .map(
      ([i, v], k) =>
        `${k ? 'L' : 'M'}${((i / n) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((v - lo) / span) * (height - 4)).toFixed(1)}`,
    )
    .join('');
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={label ?? 'trend'}
      className="text-inc dark:text-inc-dark"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Number input that commits on blur or Enter, so typing does not rewrite the URL on every keystroke. */
export function NumInput({
  value,
  onCommit,
  label,
  placeholder,
  min = 0,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  label: string;
  placeholder?: string;
  min?: number;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value === null ? '' : String(value));
  }
  const commit = () => {
    const t = text.trim();
    if (t === '') return onCommit(null);
    const n = Number(t);
    onCommit(Number.isFinite(n) && n >= min ? n : null);
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
    />
  );
}
