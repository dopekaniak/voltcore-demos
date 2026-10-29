'use client';
import Link from 'next/link';
import { EmptyState } from '@sw/ui';
import { RequireSignIn } from '@/components/RequireSignIn';
import { t } from '@/lib/messages';

export default function LibraryPage() {
  return (
    <RequireSignIn>
      <h1 className="mb-4 text-2xl font-semibold text-[var(--sw-text)]">{t.library.title}</h1>
      <EmptyState title={t.library.empty} action={<Link href="/" className="text-[var(--sw-accent)] underline">{t.nav.describe}</Link>}>
        {t.library.emptyLead}
      </EmptyState>
    </RequireSignIn>
  );
}
