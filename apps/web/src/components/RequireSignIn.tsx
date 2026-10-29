'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { EmptyState, Spinner } from '@sw/ui';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

export function RequireSignIn({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const path = usePathname();
  if (loading)
    return (
      <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
        <Spinner /> {t.common.loading}
      </p>
    );
  if (!me)
    return (
      <EmptyState title={t.common.signInRequired} action={<Link className="text-[var(--sw-accent)] underline" href={`/sign-in?next=${encodeURIComponent(path)}`}>{t.nav.signIn}</Link>} />
    );
  return <>{children}</>;
}
