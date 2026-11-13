'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Button, Card } from '@sw/ui';
import { RequireSignIn } from '@/components/RequireSignIn';
import { api, followJob, type Job } from '@/lib/api';
import { downloadFile, fileUrl } from '@/lib/files';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

const ModelViewer = dynamic(() => import('@sw/ui/viewer'), { ssr: false });

interface Model {
  code: string;
  name: string;
  provider: string;
  costs: Record<string, number>;
  capabilities: Record<string, unknown>;
}
interface Asset {
  id: string;
  versions: { id: string; stage: string; files: { id: string; role: string }[] }[];
}

function JobCard({
  title,
  job,
  onReady,
}: {
  title: string;
  job: Job | null;
  onReady?: (assetId: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [glb, setGlb] = useState<{ asset: string; file: string } | null>(null);
  useEffect(() => {
    if (job?.status !== 'SUCCEEDED' || !job.output) return;
    const assetId = String(job.output.asset_id);
    const versionId = String(job.output.version_id);
    onReady?.(assetId);
    api<Asset>(`/v1/assets/${assetId}`).then(async (a) => {
      const v = a.versions.find((x) => x.id === versionId) ?? a.versions[0];
      const g = v?.files.find((f) => f.role === 'GLB');
      if (g) {
        setGlb({ asset: assetId, file: g.id });
        setUrl(await fileUrl(assetId, g.id));
      }
    });
  }, [job, onReady]);
  return (
    <Card className="space-y-2 p-3" data-testid={`card-${title.toLowerCase()}`}>
      <h2 className="font-semibold text-[var(--sw-text)]">{title}</h2>
      {!job ? <p className="text-sm text-[var(--sw-text-muted)]">—</p> : null}
      {job && ['QUEUED', 'RUNNING', 'RETRYING'].includes(job.status) ? (
        <div className="space-y-1" role="status">
          <p className="text-sm text-[var(--sw-text)]">
            {job.status === 'QUEUED' ? t.generate.queued : t.generate.running(job.progress)}
          </p>
          <div className="h-2 overflow-hidden rounded bg-[var(--sw-surface-2)]">
            <div
              className="h-full bg-[var(--sw-accent)] transition-all"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      ) : null}
      {job?.status === 'FAILED' ? (
        <Alert tone="fail" title={t.generate.failed}>
          {job.error?.message}
        </Alert>
      ) : null}
      {url ? <ModelViewer url={url} format="glb" className="h-64" label={title} /> : null}
      {glb ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => downloadFile(glb.asset, glb.file)}
            data-testid={`download-glb-${title.toLowerCase()}`}
          >
            {t.generate.downloadGlb}
          </Button>
          <Link
            className="self-center text-sm text-[var(--sw-accent)] underline"
            href={`/library/${glb.asset}`}
          >
            {t.generate.openInLibrary}
          </Link>
        </div>
      ) : null}
    </Card>
  );
}

function Studio() {
  const { refresh } = useSession();
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState('');
  const [source, setSource] = useState<'text' | 'image'>('text');
  const [prompt, setPrompt] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [removeBg, setRemoveBg] = useState(true);
  const [style, setStyle] = useState('realistic');
  const [topology, setTopology] = useState('triangle');
  const [polycount, setPolycount] = useState(30000);
  const [preview, setPreview] = useState<Job | null>(null);
  const [refined, setRefined] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ data: Model[] }>('/v1/models')
      .then((r) => {
        setModels(r.data);
        setModel(r.data[0]?.code ?? '');
      })
      .catch(() => setError(t.generate.modelsFailed));
  }, []);
  const choices =
    source === 'image'
      ? models.filter((m) => m.capabilities.imageTo3D)
      : models.filter((m) => m.capabilities.textTo3D !== false);
  const current = choices.find((m) => m.code === model);
  useEffect(() => {
    if (choices.length && !choices.some((m) => m.code === model)) setModel(choices[0]!.code);
  }, [choices, model]);
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);
  function pickPhoto(file: File | null) {
    setPhoto(file);
    setPhotoUrl(file ? URL.createObjectURL(file) : null);
  }
  const follow = (job: Job, set: (j: Job) => void) =>
    followJob(job.id, (j) => {
      set(j);
      if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(j.status)) void refresh();
    });
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let job: Job;
      if (source === 'image') {
        if (!photo) return;
        const type = photo.type || 'image/png';
        const c = await api<{
          upload: { id: string };
          put: { url: string; headers: Record<string, string> };
        }>('/v1/uploads', {
          method: 'POST',
          body: { filename: photo.name, content_type: type, bytes: photo.size, purpose: 'image' },
        });
        const put = await fetch(c.put.url, { method: 'PUT', headers: c.put.headers, body: photo });
        if (!put.ok) throw new Error(t.generate.photoUploadFailed(put.status));
        await api(`/v1/uploads/${c.upload.id}/complete`, { method: 'POST' });
        const title = photo.name
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .trim()
          .slice(0, 120);
        ({ job } = await api<{ job: Job }>('/v1/generations/image-to-3d', {
          method: 'POST',
          body: {
            upload_ids: [c.upload.id],
            model,
            remove_background: removeBg,
            ...(title ? { title } : {}),
          },
          idempotent: true,
        }));
      } else {
        ({ job } = await api<{ job: Job }>('/v1/generations/text-to-3d', {
          method: 'POST',
          body: { mode: 'preview', prompt, model, style, topology, polycount },
          idempotent: true,
        }));
      }
      setPreview(job);
      setRefined(null);
      void refresh();
      follow(job, setPreview);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refine() {
    if (!preview) return;
    setError(null);
    try {
      const { job } = await api<{ job: Job }>('/v1/generations/text-to-3d', {
        method: 'POST',
        body: { mode: 'refine', preview_job_id: preview.id },
        idempotent: true,
      });
      setRefined(job);
      void refresh();
      follow(job, setRefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const label = 'block space-y-1 text-sm';
  const select =
    'h-9 w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 text-[var(--sw-text)]';
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.generate.title}</h1>
        <p className="text-sm text-[var(--sw-text-muted)]">{t.generate.lead}</p>
      </div>
      <form onSubmit={generate} className="grid gap-3 md:grid-cols-4">
        <div className="flex gap-2 md:col-span-4" role="tablist">
          {(['text', 'image'] as const).map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={source === k ? 'primary' : 'secondary'}
              role="tab"
              aria-selected={source === k}
              onClick={() => setSource(k)}
              data-testid={`gen-source-${k}`}
            >
              {k === 'text' ? t.generate.fromText : t.generate.fromPhoto}
            </Button>
          ))}
        </div>
        {source === 'text' ? (
          <label className={`${label} md:col-span-4`}>
            <span className="font-medium text-[var(--sw-text)]">{t.generate.prompt}</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={600}
              required
              rows={2}
              placeholder={t.generate.placeholder}
              className="w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] p-2 text-[var(--sw-text)]"
              data-testid="gen-prompt"
            />
          </label>
        ) : (
          <div className="flex flex-wrap items-start gap-4 md:col-span-4">
            <label className={label}>
              <span className="font-medium text-[var(--sw-text)]">{t.generate.photo}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                className="block text-sm text-[var(--sw-text)]"
                data-testid="gen-photo"
              />
              <span className="block text-xs text-[var(--sw-text-muted)]">
                {t.generate.photoHint}
              </span>
              <span className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={removeBg}
                  onChange={(e) => setRemoveBg(e.target.checked)}
                  id="gen-remove-bg"
                />
                <label htmlFor="gen-remove-bg">{t.generate.removeBackground}</label>
              </span>
            </label>
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={t.generate.photoAlt}
                className="h-28 w-28 rounded border border-[var(--sw-border)] object-contain"
              />
            ) : null}
          </div>
        )}
        <label className={label}>
          <span className="font-medium text-[var(--sw-text)]">{t.generate.model}</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={select}
            data-testid="gen-model"
          >
            {choices.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {source === 'text' ? (
          <>
            <label className={label}>
              <span className="font-medium text-[var(--sw-text)]">{t.generate.style}</span>
              <select value={style} onChange={(e) => setStyle(e.target.value)} className={select}>
                {Object.entries(t.generate.styles).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              <span className="font-medium text-[var(--sw-text)]">{t.generate.topology}</span>
              <select
                value={topology}
                onChange={(e) => setTopology(e.target.value)}
                className={select}
              >
                {Object.entries(t.generate.topologies).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              <span className="font-medium text-[var(--sw-text)]">{t.generate.polycount}</span>
              <input
                type="number"
                min={100}
                max={300000}
                step={100}
                value={polycount}
                onChange={(e) => setPolycount(Number(e.target.value))}
                className={`${select} font-mono tabular-nums`}
              />
            </label>
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 md:col-span-4">
          <Button
            type="submit"
            loading={busy}
            disabled={(source === 'text' ? !prompt.trim() : !photo) || !model}
            data-testid="gen-preview"
          >
            {t.generate.preview}
          </Button>
          <span
            className="font-mono text-sm tabular-nums text-[var(--sw-text-muted)]"
            data-testid="gen-cost"
          >
            {current
              ? t.generate.cost(
                  (source === 'image' ? current.costs.image : current.costs.preview) ?? 0,
                )
              : ''}
          </span>
          <Button
            type="button"
            variant="secondary"
            onClick={refine}
            disabled={preview?.status !== 'SUCCEEDED' || refined !== null}
            data-testid="gen-refine"
          >
            {current?.provider === 'selfhost' ? t.generate.refineDetail : t.generate.refine}{' '}
            {current ? `(${t.generate.cost(current.costs.refine ?? 0)})` : ''}
          </Button>
          {preview?.status !== 'SUCCEEDED' ? (
            <span className="text-xs text-[var(--sw-text-muted)]">{t.generate.refineLocked}</span>
          ) : null}
        </div>
      </form>
      {error ? <Alert tone="fail" title={error} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <JobCard title={t.generate.previewCard} job={preview} />
        <JobCard title={t.generate.refineCard} job={refined} />
      </div>
    </div>
  );
}

export default function GeneratePage() {
  return (
    <RequireSignIn>
      <Studio />
    </RequireSignIn>
  );
}
