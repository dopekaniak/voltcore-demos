'use client';
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[var(--sw-accent)] text-[var(--sw-accent-contrast)] hover:bg-[var(--sw-accent-strong)] border-transparent',
  secondary: 'bg-[var(--sw-surface)] text-[var(--sw-text)] border-[var(--sw-border)] hover:bg-[var(--sw-surface-2)]',
  ghost: 'bg-transparent text-[var(--sw-text)] border-transparent hover:bg-[var(--sw-surface)]',
  danger: 'bg-[var(--sw-fail)] text-white border-transparent hover:opacity-90',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sw-focus)]',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner small /> : null}
      {children}
    </button>
  );
});

export function Spinner({ small, label = 'Loading' }: { small?: boolean; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none', small ? 'h-3.5 w-3.5' : 'h-5 w-5')} />
  );
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-lg border border-[var(--sw-border)] bg-[var(--sw-bg)]', className)} {...rest} />;
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'pass' | 'warn' | 'fail' | 'info'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'text-[var(--sw-text-muted)] border-[var(--sw-border)]',
    accent: 'text-[var(--sw-accent)] border-[var(--sw-accent)]',
    pass: 'text-[var(--sw-pass)] border-[var(--sw-pass)]',
    warn: 'text-[var(--sw-warn)] border-[var(--sw-warn)]',
    fail: 'text-[var(--sw-fail)] border-[var(--sw-fail)]',
    info: 'text-[var(--sw-info)] border-[var(--sw-info)]',
  } as const;
  return <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

export function Alert({ tone = 'info', title, children, action }: { tone?: 'info' | 'pass' | 'warn' | 'fail'; title: string; children?: ReactNode; action?: ReactNode }) {
  const color = { info: 'var(--sw-info)', pass: 'var(--sw-pass)', warn: 'var(--sw-warn)', fail: 'var(--sw-fail)' }[tone];
  return (
    <div role={tone === 'fail' ? 'alert' : 'status'} className="flex items-start gap-3 rounded-md border border-[var(--sw-border)] bg-[var(--sw-surface)] p-3 text-sm" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="flex-1">
        <p className="font-semibold text-[var(--sw-text)]">{title}</p>
        {children ? <div className="mt-1 text-[var(--sw-text-muted)]">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-10 w-full rounded-md border border-[var(--sw-border)] bg-[var(--sw-bg)] px-3 text-sm text-[var(--sw-text)] placeholder:text-[var(--sw-text-muted)]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--sw-focus)]',
        className,
      )}
      {...rest}
    />
  );
});

/** Modal dialog: traps focus, closes on Escape, restores focus on close. */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    const focusables = () => [...node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="sw-dialog-title" className="w-full max-w-md rounded-lg border border-[var(--sw-border)] bg-[var(--sw-bg)] p-5 shadow-xl">
        <h2 id="sw-dialog-title" className="text-lg font-semibold text-[var(--sw-text)]">
          {title}
        </h2>
        <div className="mt-3 text-sm text-[var(--sw-text-muted)]">{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--sw-border)] px-6 py-12 text-center">
      <p className="text-base font-semibold text-[var(--sw-text)]">{title}</p>
      {children ? <p className="max-w-md text-sm text-[var(--sw-text-muted)]">{children}</p> : null}
      {action}
    </div>
  );
}

export { cx };
