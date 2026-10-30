'use client';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import type { Dimensions, ParamSchema, ParamValues } from '@sw/forge-kit/browser';
import { Alert, Button, Spinner } from '@sw/ui';
import { ForgeOwnerBar, type VersionInfo } from '@/components/ForgeOwnerBar';
import { ForgeWorkbench, type Printer } from '@/components/ForgeWorkbench';
import { api, type ApiError } from '@/lib/api';
import { t } from '@/lib/messages';

interface Forge {
  id: string;
  asset_id: string;
  title: string;
  is_owner: boolean;
  visibility: string;
  forked_from: string | null;
  version: { id: string; number: number; params: ParamValues };
  source: { code: string; schema: ParamSchema; dimensions: Dimensions };
  printer: Printer;
}

export default function ForgePage() {
  return (
    <Suspense>
      <ForgeView />
    </Suspense>
  );
}

function ForgeView() {
  const { id } = useParams<{ id: string }>();
  const version = useSearchParams().get('version');
  const [forge, setForge] = useState<Forge | null>(null);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const load = () => {
    setError(null);
    api<{ data: VersionInfo[] }>(`/v1/forges/${id}/versions`).then((r) => setVersions(r.data)).catch(() => undefined);
    api<Forge>(`/v1/forges/${id}${version ? `?version=${version}` : ''}`)
      .then(setForge)
      .catch((e: ApiError) => setError({ status: e.status, message: e.status === 404 ? t.errors.notFoundLead : e.message }));
  };
  useEffect(load, [id, version]);
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
      key={forge.version.id}
      header={(values, dirty) => (
        <ForgeOwnerBar forgeId={forge.id} isOwner={forge.is_owner} visibility={forge.visibility} versions={versions.length ? versions : [{ id: forge.version.id, number: forge.version.number }]} currentVersionId={forge.version.id} forkedFrom={forge.forked_from} params={values} dirty={dirty} />
      )}
      title={forge.title}
      code={forge.source.code}
      schema={forge.source.schema}
      initialParams={forge.version.params}
      {...(forge.is_owner ? { forgeId: forge.id, assetId: forge.asset_id } : {})}
      versionId={forge.version.id}
      versionNumber={forge.version.number}
      dimensions={forge.source.dimensions}
      printer={forge.printer}
      isOwner={forge.is_owner}
      onReload={load}
    />
  );
}
