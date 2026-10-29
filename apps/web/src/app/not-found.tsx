import Link from 'next/link';
import { EmptyState } from '@sw/ui';
import { t } from '@/lib/messages';

export default function NotFound() {
  return (
    <EmptyState title={t.errors.notFound} action={<Link href="/" className="text-[var(--sw-accent)] underline">{t.errors.home}</Link>}>
      {t.errors.notFoundLead}
    </EmptyState>
  );
}
