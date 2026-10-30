import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, Search, X, XCircle } from 'lucide-react';
import { cn, Tone } from '../../lib/format';
import { useCountUp, useEscape } from '../../lib/hooks';

/* ---------- Surfaces ---------- */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-[18px] border border-line/70 bg-surface', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-4">
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-white">{title}</h2>
        {hint && <p className="text-[13px] text-muted mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 animate-fade-in">
      <div>
        {/* A large title, as at the top of an Apple app screen. */}
        <h1 className="text-[34px] font-bold leading-tight tracking-[-0.022em] text-white">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Badges ---------- */
const TONES: Record<Tone, string> = {
  neutral: 'bg-white/5 text-slate-300 ring-white/10',
  brand: 'bg-brand/15 text-brand-soft ring-brand/25',
  success: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20',
  warn: 'bg-amber-400/10 text-amber-300 ring-amber-400/20',
  danger: 'bg-rose-400/10 text-rose-300 ring-rose-400/20',
  info: 'bg-sky-400/10 text-sky-300 ring-sky-400/20',
  violet: 'bg-violet-400/10 text-violet-300 ring-violet-400/20',
};
export const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400', brand: 'bg-brand', success: 'bg-emerald-400', warn: 'bg-amber-400',
  danger: 'bg-rose-400', info: 'bg-sky-400', violet: 'bg-violet-400',
};
export const TEXT: Record<Tone, string> = {
  neutral: 'text-slate-300', brand: 'text-brand-soft', success: 'text-emerald-300', warn: 'text-amber-300',
  danger: 'text-rose-300', info: 'text-sky-300', violet: 'text-violet-300',
};

export function Badge({ tone = 'neutral', dot, className, children }: {
  tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone])} />}
      {children}
    </span>
  );
}

/* ---------- Buttons & inputs ---------- */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean;
};
export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }: BtnProps) {
  const variants = {
    // Filled for the main action, tinted for the others, plain text for the quietest: the three weights iOS buttons use.
    primary: 'bg-brand text-white hover:bg-brand-deep',
    secondary: 'bg-white/[.1] text-white hover:bg-white/[.16]',
    ghost: 'text-brand-soft hover:bg-white/[.06]',
    danger: 'bg-rose-500 text-white hover:bg-rose-400',
  };
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition duration-150 active:scale-[.97] active:opacity-80 disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'min-h-[32px] px-3.5 py-1.5 text-[13px]' : 'min-h-[40px] px-5 py-2.5 text-[15px]',
        variants[variant], className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

const fieldCls = 'w-full rounded-xl border border-transparent bg-raised px-3.5 py-2.5 text-[15px] text-white placeholder:text-muted transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/25';

export function SearchInput({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(fieldCls, 'pl-9 pr-8')}
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  // Native selects ignore vertical padding, so give them the same fixed height as the other fields.
  return <select className={cn(fieldCls, 'h-[42px] cursor-pointer py-0 pr-8', className)} {...rest}>{children}</select>;
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldCls, props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldCls, 'resize-none', props.className)} />;
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}

/* ---------- Segmented / Tabs ---------- */
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void;
  options: { value: T; label: string; count?: number; tone?: Tone }[];
}) {
  return (
    <div role="tablist" className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[11px] bg-raised/80 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 py-1.5 text-[13px] font-medium transition duration-150',
              active ? 'bg-[#636366] text-white shadow-[0_1px_3px_rgba(0,0,0,.4)]' : 'text-slate-300 hover:text-white',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn('rounded-full px-1.5 text-xs tabular', active ? 'bg-white/20 text-white' : 'bg-white/[.07] text-muted')}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: {
  value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[];
}) {
  return (
    <div role="tablist" className="flex gap-6 border-b border-line">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative -mb-px flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition',
              active ? 'border-brand text-white' : 'border-transparent text-muted hover:text-white',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="rounded-md bg-white/5 px-1.5 text-xs text-muted tabular">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Stats ---------- */
export function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

/* ---------- Feedback states ---------- */
export function EmptyState({ icon, title, hint, action }: { icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="mb-1 rounded-2xl bg-raised p-3 text-muted">{icon}</div>}
      <p className="text-[15px] font-medium text-white">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="flex items-center justify-between gap-4 border-rose-400/20 bg-rose-400/5 p-4">
      <div className="flex items-center gap-3 text-sm text-rose-200">
        <XCircle className="h-5 w-5 text-rose-300" />
        <div>
          <p className="font-medium">{message}</p>
          <p className="text-rose-200/70">Make sure the backend is running on port 8000.</p>
        </div>
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </Card>
  );
}

/* ---------- Overlays ---------- */
export function Drawer({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  useEscape(onClose, open);
  if (!open) return null;
  // Rendered at the top of the page, not inside the page content. Any transform on a parent (even the identity one an animation
  // leaves behind) would otherwise shrink "fixed to the window" to "fixed to that parent", and the popup would land off-screen.
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <aside role="dialog" aria-modal className="absolute right-0 top-0 flex h-full w-full max-w-[460px] animate-slide-in flex-col border-l border-line bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">{title}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-line p-4">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: 'md' | 'lg';
}) {
  useEscape(onClose, open);
  if (!open) return null;
  // Portaled to the page body so it's always centered in the window. See Drawer.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div role="dialog" aria-modal className={cn('relative flex max-h-[90vh] w-full animate-pop-in flex-col rounded-[22px] border border-line/60 bg-surface/95 shadow-[0_24px_80px_rgba(0,0,0,.6)] backdrop-blur-xl', size === 'lg' ? 'max-w-2xl' : 'max-w-lg')}>
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6">
          <h3 className="text-[22px] font-bold tracking-[-0.02em] text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="-mr-2 -mt-1 rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Toasts ---------- */
type ToastItem = { id: number; tone: 'success' | 'error' | 'info'; message: string };
const ToastCtx = createContext<(tone: ToastItem['tone'], message: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
  }, []);
  const icon = { success: <CheckCircle2 className="h-5 w-5 text-emerald-300" />, error: <AlertTriangle className="h-5 w-5 text-rose-300" />, info: <Info className="h-5 w-5 text-sky-300" /> };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex animate-pop-in items-start gap-3 rounded-xl border border-line-strong bg-raised p-3.5 shadow-xl">
            {icon[t.tone]}
            <p className="flex-1 text-sm text-slate-100">{t.message}</p>
            <button onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} aria-label="Dismiss" className="text-muted hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Small helpers ---------- */
export function Meter({ value, tone = 'brand', className }: { value: number; tone?: Tone; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-white/5', className)}>
      <div className={cn('h-full rounded-full transition-all duration-700', DOT[tone])} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

export function KeyValue({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className={cn('mt-1 text-sm text-slate-100', mono && 'font-mono')}>{children}</dd>
    </div>
  );
}
