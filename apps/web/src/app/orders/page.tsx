'use client';
import Link from 'next/link';
import { EmptyState } from '@sw/ui';
import { RequireSignIn } from '@/components/RequireSignIn';
import { t } from '@/lib/messages';

export default function OrdersPage() {
  return (
    <RequireSignIn>
      <h1 className="mb-4 text-2xl font-semibold text-[var(--sw-text)]">{t.orders.title}</h1>
      <EmptyState title={t.orders.empty} action={<Link href="/print" className="text-[var(--sw-accent)] underline">{t.nav.upload}</Link>}>
        {t.orders.emptyLead}
      </EmptyState>
    </RequireSignIn>
  );
}
