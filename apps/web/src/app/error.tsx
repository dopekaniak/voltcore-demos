'use client';
import { Button, EmptyState } from '@sw/ui';
import { t } from '@/lib/messages';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState title={t.errors.server} action={<Button onClick={reset}>{t.common.retry}</Button>}>
      {t.errors.serverLead}
    </EmptyState>
  );
}
