'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card } from '@sw/ui';
import { api, type Job } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

interface Starter {
  key: string;
  title: string;
  summary: string;
  example_prompt: string;
}

export default function Home() {
  const router = useRouter();
  const { me } = useSession();
  const [prompt, setPrompt] = useState('');
  const [starters, setStarters] = useState<Starter[] | null>(null);
  const [startersError, setStartersError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStarters = () => {
    setStartersError(false);
    api<{ data: Starter[] }>('/v1/forges/starters')
      .then((r) => setStarters(r.data))
      .catch(() => setStartersError(true));
  };
  useEffect(loadStarters, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (!me) {
      sessionStorage.setItem('sw_pending_prompt', prompt);
      return router.push('/sign-in?next=/');
    }
    setSubmitting(true);
    setError(null);
    try {
      const { job } = await api<{ job: Job }>('/v1/forges', { method: 'POST', body: { prompt }, idempotent: true });
      router.push(`/forge/new?job=${job.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const pending = sessionStorage.getItem('sw_pending_prompt');
    if (pending) {
      setPrompt(pending);
      sessionStorage.removeItem('sw_pending_prompt');
    }
  }, []);

  return (
    <div className="space-y-10">
      <section className="mx-auto max-w-3xl space-y-4 pt-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--sw-text)] sm:text-4xl">{t.home.title}</h1>
        <p className="text-[var(--sw-text-muted)]">{t.home.lead}</p>
        <form onSubmit={submit} className="space-y-2 text-left">
          <label htmlFor="prompt" className="sr-only">
            {t.home.promptLabel}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t.home.promptPlaceholder}
              maxLength={600}
              className="h-12 flex-1 rounded-md border border-[var(--sw-border)] bg-[var(--sw-bg)] px-4 text-base text-[var(--sw-text)] placeholder:text-[var(--sw-text-muted)]"
              data-testid="prompt-input"
            />
            <Button type="submit" className="h-12 px-6" loading={submitting} disabled={!prompt.trim()} data-testid="prompt-submit">
              {me ? t.home.submit : t.home.signInToForge}
            </Button>
          </div>
          <p className="text-xs text-[var(--sw-text-muted)]">{t.home.cost(10)}</p>
          {error ? <Alert tone="fail" title={error} /> : null}
        </form>
        <div className="flex flex-wrap justify-center gap-2" aria-label={t.home.examples}>
          {(starters ?? []).map((s) => (
            <button key={s.key} type="button" onClick={() => setPrompt(s.example_prompt)} className="rounded-full border border-[var(--sw-border)] px-3 py-1 text-xs text-[var(--sw-text)] hover:bg-[var(--sw-surface)]">
              {s.example_prompt}
            </button>
          ))}
        </div>
      </section>
      <section aria-labelledby="starters-h" className="space-y-3">
        <div>
          <h2 id="starters-h" className="text-lg font-semibold text-[var(--sw-text)]">
            {t.home.starters}
          </h2>
          <p className="text-sm text-[var(--sw-text-muted)]">{t.home.startersLead}</p>
        </div>
        {startersError ? <Alert tone="fail" title={t.common.error} action={<Button size="sm" variant="secondary" onClick={loadStarters}>{t.common.retry}</Button>} /> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(starters ?? Array.from({ length: 4 }, () => null)).map((s, i) =>
            s ? (
              <Card key={s.key} className="flex flex-col gap-2 p-4">
                <h3 className="font-semibold text-[var(--sw-text)]">{s.title}</h3>
                <p className="flex-1 text-sm text-[var(--sw-text-muted)]">{s.summary}</p>
                <Link href={`/forge/starter/${s.key}`} className="text-sm font-medium text-[var(--sw-accent)] underline-offset-2 hover:underline" data-testid={`starter-${s.key}`}>
                  {t.home.openStarter} {s.title}
                </Link>
              </Card>
            ) : (
              <Card key={i} className="h-32 animate-pulse bg-[var(--sw-surface)]" />
            ),
          )}
        </div>
      </section>
    </div>
  );
}
