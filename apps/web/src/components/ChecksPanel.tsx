'use client';
import type { ForgeCheck } from '@sw/forge-kit/browser';
import { t } from '@/lib/messages';

const ICON = { pass: '✓', warn: '!', fail: '✕' } as const;
const COLOR = { pass: 'var(--sw-pass)', warn: 'var(--sw-warn)', fail: 'var(--sw-fail)' } as const;
const LABEL = { pass: t.forge.pass, warn: t.forge.warn, fail: t.forge.fail } as const;

export function ChecksPanel({ checks, busy }: { checks: ForgeCheck[] | null; busy?: boolean }) {
  const rows = [...(checks ?? [])].sort((a, b) => ({ fail: 0, warn: 1, pass: 2 })[a.status] - ({ fail: 0, warn: 1, pass: 2 })[b.status]);
  const failing = rows.filter((c) => c.status === 'fail').length;
  return (
    <section aria-labelledby="checks-h" aria-busy={busy || undefined} className="space-y-2">
      <h2 id="checks-h" className="text-sm font-semibold uppercase tracking-wide text-[var(--sw-text-muted)]">
        {t.forge.checks}
      </h2>
      {checks === null ? <p className="text-sm text-[var(--sw-text-muted)]">{t.common.loading}</p> : null}
      {checks && failing === 0 && !rows.some((r) => r.status === 'warn') ? <p className="text-sm text-[var(--sw-pass)]">{t.forge.allPass}</p> : null}
      <ul className="space-y-1.5" data-testid="checks-list">
        {rows.map((c) => (
          <li key={c.id} className="flex gap-2 rounded border border-[var(--sw-border)] p-2 text-sm" data-status={c.status}>
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: COLOR[c.status] }}>
              {ICON[c.status]}
            </span>
            <div>
              <p className="font-medium text-[var(--sw-text)]">
                <span className="sr-only">{LABEL[c.status]}: </span>
                {c.title}
              </p>
              <p className="text-[var(--sw-text-muted)]">{c.message}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
