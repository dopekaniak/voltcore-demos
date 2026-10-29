'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Input } from '@sw/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

function SignInForm() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      await api('/v1/auth/magic-link', { method: 'POST', body: { email, ...(next.startsWith('/') && !next.startsWith('//') ? { redirect_to: next } : {}) } });
      setState('sent');
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  }
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.signIn.title}</h1>
      <p className="text-sm text-[var(--sw-text-muted)]">{t.signIn.lead}</p>
      {state === 'sent' ? (
        <Alert tone="pass" title={t.signIn.sent(email)}>
          {process.env.NODE_ENV !== 'production' ? t.signIn.devHint : null}
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="email" className="block text-sm font-medium text-[var(--sw-text)]">
            {t.signIn.email}
          </label>
          <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email-input" />
          <Button type="submit" className="w-full" loading={state === 'sending'} data-testid="email-submit">
            {t.signIn.submit}
          </Button>
          {state === 'error' ? <Alert tone="fail" title={error} /> : null}
        </form>
      )}
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
