'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Spinner } from '@sw/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useSession();
  const [failed, setFailed] = useState(false);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = params.get('token');
    if (!token) return setFailed(true);
    api<{ redirect_to: string | null }>('/v1/auth/magic-link/consume', { method: 'POST', body: { token } })
      .then(async (r) => {
        await refresh();
        router.replace(r.redirect_to && r.redirect_to.startsWith('/') && !r.redirect_to.startsWith('//') ? r.redirect_to : '/');
      })
      .catch(() => setFailed(true));
  }, [params, refresh, router]);
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      {failed ? (
        <Alert tone="fail" title={t.signIn.callbackFailed}>
          <Link href="/sign-in" className="underline">
            {t.signIn.again}
          </Link>
        </Alert>
      ) : (
        <p className="flex items-center gap-2 text-[var(--sw-text)]">
          <Spinner /> {t.signIn.callbackWorking}
        </p>
      )}
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}
