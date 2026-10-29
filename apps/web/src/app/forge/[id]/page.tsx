'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ParamSchema, ParamValues } from '@sw/forge-kit/browser';
import { Alert, Button, Spinner } from '@sw/ui';
import { ForgeWorkbench } from '@/components/ForgeWorkbench';
import { api, type ApiError } from '@/lib/api';
import { t } from '@/lib/messages';

interface Forge {
  id: string;
  asset_id: string;
  title: string;
  is_owner: boolean;
  version: { id: string; number: number; params: ParamValues };
  source: { code: string; schema: ParamSchema };
}

export default function ForgePage() {
  const { id } = useParams<{ id: string }>();
  const [forge, setForge] = useState<Forge | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const load = () => {
    setError(null);
    api<Forge>(`/v1/forges/${id}`)
      .then(setForge)
      .catch((e: ApiError) => setError({ status: e.status, message: e.status === 404 ? t.errors.notFoundLead : e.message }));
  };
  useEffect(load, [id]);
  if (error)
    return (
      <Alert tone="fail" title={error.status === 404 ? t.errors.notFound : t.common.error} action={error.status === 404 ? null : <Button size="sm" variant="secondary" onClick={load}>{t.common.retry}</Button>}>
        {error.message}
      </Alert>
    );
  if (!forge)
    return (
      <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
        <Spinner /> {t.common.loading}
      </p>
    );
  return (
    <ForgeWorkbench
      title={forge.title}
      code={forge.source.code}
      schema={forge.source.schema}
      initialParams={forge.version.params}
      {...(forge.is_owner ? { forgeId: forge.id, assetId: forge.asset_id } : {})}
      versionId={forge.version.id}
      versionNumber={forge.version.number}
    />
  );
}
