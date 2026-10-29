'use client';
import { useEffect, useState } from 'react';
import { Alert, Card } from '@sw/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

export default function StatusPage() {
  const [h, setH] = useState<{ status: string; checks: Record<string, string>; modes: Record<string, string> } | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    api<typeof h>('/v1/health').then(setH).catch(() => setDown(true));
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.status.title}</h1>
      {down ? <Alert tone="fail" title={t.status.degraded} /> : h ? <Alert tone={h.status === 'ok' ? 'pass' : 'warn'} title={h.status === 'ok' ? t.status.ok : t.status.degraded} /> : null}
      {h ? (
        <Card className="p-4 font-mono text-sm">
          {Object.entries({ ...h.checks, ...h.modes }).map(([k, v]) => (
            <p key={k}>
              {k}: {v}
            </p>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
