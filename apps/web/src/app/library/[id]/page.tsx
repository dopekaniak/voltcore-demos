'use client';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from '@sw/ui';
import { api, followJob, type Job } from '@/lib/api';
import { downloadFile, fileUrl } from '@/lib/files';
import { t } from '@/lib/messages';

const ModelViewer = dynamic(() => import('@sw/ui/viewer'), { ssr: false });

interface FileRow { id: string; role: string; filename: string; bytes: number }
interface Version { id: string; number: number; stage: string; analysis: { printable?: boolean; watertight?: boolean; bbox_mm?: number[]; triangles?: number; notes?: string[]; actions?: string[] } | null; files: FileRow[] }
interface Asset { id: string; title: string; kind: string; is_owner: boolean; versions: Version[] }

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [vid, setVid] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const load = useCallback(() => {
    api<Asset>(`/v1/assets/${id}`).then((a) => {
      setAsset(a);
      setVid((v) => v ?? a.versions[0]?.id ?? null);
    }).catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  const v = asset?.versions.find((x) => x.id === vid) ?? null;
  useEffect(() => {
    const f = v?.files.find((x) => x.role === 'GLB') ?? v?.files.find((x) => x.role === 'STL' || x.role === 'PREVIEW_MESH');
    setUrl(null);
    if (f && asset) void fileUrl(asset.id, f.id).then(setUrl);
  }, [v, asset]);
  async function repair() {
    if (!asset || !v) return;
    setRepairing(true);
    try {
      const { job } = await api<{ job: Job }>(`/v1/assets/${asset.id}/versions/${v.id}/repair`, { method: 'POST', idempotent: true });
      const stop = followJob(job.id, (j) => {
        if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) {
          stop();
          setRepairing(false);
          if (j.status === 'SUCCEEDED') {
            setVid(String(j.output?.version_id));
            load();
          } else setError(j.error?.message ?? t.common.error);
        }
      });
    } catch (e) {
      setError((e as Error).message);
      setRepairing(false);
    }
  }
  if (error) return <Alert tone="fail" title={error} />;
  if (!asset) return <p className="flex items-center gap-2 text-[var(--sw-text-muted)]"><Spinner /> {t.common.loading}</p>;
  const fmt = v?.files.some((x) => x.role === 'GLB') ? 'glb' : 'stl';
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold text-[var(--sw-text)]">{asset.title}</h1>
        {url ? <ModelViewer url={url} format={fmt} className="h-[50vh] min-h-[300px]" label={asset.title} /> : <div className="h-[50vh] animate-pulse rounded-lg bg-[var(--sw-viewer-bg)]" />}
      </div>
      <aside className="space-y-4">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase text-[var(--sw-text-muted)]">{t.library.versions}</h2>
          <ul className="space-y-1">
            {asset.versions.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => setVid(x.id)} aria-current={x.id === vid || undefined} className={`w-full rounded px-2 py-1 text-left text-sm ${x.id === vid ? 'bg-[var(--sw-surface-2)] font-semibold' : 'hover:bg-[var(--sw-surface)]'} text-[var(--sw-text)]`}>
                  {t.forge.version(x.number)} · {t.library.stage[x.stage] ?? x.stage}
                </button>
              </li>
            ))}
          </ul>
        </section>
        {v?.analysis ? (
          <Card className="space-y-2 p-3 text-sm" data-testid="analysis">
            <h2 className="font-semibold text-[var(--sw-text)]">{t.library.analysis}</h2>
            <Badge tone={v.analysis.printable ? 'pass' : 'warn'}>{v.analysis.printable ? t.library.printable : t.library.notPrintable}</Badge>
            <p className="font-mono text-xs tabular-nums text-[var(--sw-text-muted)]">{v.analysis.bbox_mm?.map((n) => n.toFixed(1)).join(' × ')} mm · {v.analysis.triangles} triangles</p>
            {v.analysis.notes?.map((n) => <p key={n} className="text-[var(--sw-text-muted)]">{n}</p>)}
            {v.analysis.actions?.map((n) => <p key={n} className="text-[var(--sw-text-muted)]">✓ {n}</p>)}
            {asset.is_owner && !v.analysis.printable ? <Button size="sm" onClick={repair} loading={repairing} data-testid="repair">{t.library.repair}</Button> : null}
          </Card>
        ) : null}
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase text-[var(--sw-text-muted)]">{t.library.files}</h2>
          <ul className="space-y-1">
            {v?.files.map((f) => (
              <li key={f.id} className="flex items-center justify-between text-sm">
                <span className="text-[var(--sw-text)]">{f.filename} <span className="font-mono text-xs text-[var(--sw-text-muted)]">{(f.bytes / 1024).toFixed(0)} KB</span></span>
                <Button size="sm" variant="ghost" onClick={() => downloadFile(asset.id, f.id)}>{t.library.download}</Button>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
