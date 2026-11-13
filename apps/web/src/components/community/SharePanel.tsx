'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Input } from '@sw/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';
import { ModelImage } from './ModelCard';
import { CATEGORIES, type ModelDetail } from './types';

interface License {
  code: string;
  name: string;
  allows_derivatives: boolean;
  allows_commercial: boolean;
}

const field =
  'w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] p-2 text-sm text-[var(--sw-text)]';
const label = 'block space-y-1 text-sm';

/** Owner panel: choose a creator name and license, write the page, share, add photos. */
export function SharePanel({ assetId }: { assetId: string }) {
  const { me, refresh } = useSession();
  const [m, setM] = useState<ModelDetail | null>(null);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [handle, setHandle] = useState('');
  const [license, setLicense] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [tags, setTags] = useState('');
  const [listed, setListed] = useState(true);
  const [material, setMaterial] = useState('');
  const [layer, setLayer] = useState('');
  const [supports, setSupports] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const fill = useCallback((d: ModelDetail) => {
    setM(d);
    if (d.publish_status !== 'NONE') {
      setDescription(d.description);
      setCategory(d.category ?? 'other');
      setTags(d.tags.join(', '));
      setListed(d.listed);
      const n = d.print_notes ?? {};
      setMaterial(String(n.material ?? ''));
      setLayer(n.layer_height_mm !== undefined ? String(n.layer_height_mm) : '');
      setSupports(String(n.supports ?? ''));
      setNotes(String(n.notes ?? ''));
    }
    if (d.license.name !== 'No license chosen') setLicense(d.license.code);
  }, []);
  const load = useCallback(() => {
    api<ModelDetail>(`/v1/community/models/${assetId}`)
      .then(fill)
      .catch((e: Error) => setError(e.message));
  }, [assetId, fill]);
  useEffect(load, [load]);
  useEffect(() => {
    api<{ data: License[] }>('/v1/licenses')
      .then((r) => setLicenses(r.data))
      .catch(() => undefined);
  }, []);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    setDone(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const saveHandle = () =>
    run('handle', async () => {
      await api('/v1/me/profile', { method: 'PUT', body: { handle } });
      await refresh();
    });
  const publish = () =>
    run('publish', async () => {
      if (!license) throw new Error(t.community.chooseLicense);
      await api(`/v1/assets/${assetId}/license`, { method: 'PUT', body: { code: license } });
      const print_notes = Object.fromEntries(
        Object.entries({
          material: material.trim(),
          layer_height_mm: layer ? Number(layer) : undefined,
          supports: supports || undefined,
          notes: notes.trim(),
        }).filter(([, v]) => v !== undefined && v !== ''),
      );
      const body = {
        description: description.trim(),
        category,
        tags: tags
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean),
        listed,
        ...(Object.keys(print_notes).length ? { print_notes } : {}),
      };
      const shared = m && (m.publish_status === 'PUBLISHED' || m.publish_status === 'REVIEW');
      const d = await api<ModelDetail>(
        `/v1/community/models/${assetId}${shared ? '' : '/publish'}`,
        { method: shared ? 'PATCH' : 'POST', body },
      );
      fill(d);
      setDone(d.publish_status === 'PUBLISHED' ? t.community.sharedLive : t.community.sharedReview);
    });
  const unpublish = () =>
    run('unpublish', async () => {
      await api(`/v1/community/models/${assetId}/unpublish`, { method: 'POST' });
      load();
    });
  const addPhoto = (file: File) =>
    run('photo', async () => {
      const type = file.type || 'image/jpeg';
      const c = await api<{
        upload: { id: string };
        put: { url: string; headers: Record<string, string> };
      }>('/v1/uploads', {
        method: 'POST',
        body: { filename: file.name, content_type: type, bytes: file.size, purpose: 'image' },
      });
      const put = await fetch(c.put.url, { method: 'PUT', headers: c.put.headers, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await api(`/v1/uploads/${c.upload.id}/complete`, { method: 'POST' });
      await api(`/v1/community/models/${assetId}/photos`, {
        method: 'POST',
        body: { upload_id: c.upload.id },
      });
      load();
    });
  const removePhoto = (fileId: string) =>
    run('photo', async () => {
      await api(`/v1/community/models/${assetId}/photos/${fileId}`, { method: 'DELETE' });
      load();
    });

  if (!m) return error ? <Alert tone="fail" title={error} /> : null;
  if (m.publish_status === 'REMOVED')
    return <Alert tone="fail" title={t.community.status.REMOVED ?? ''} />;
  const shared = m.publish_status === 'PUBLISHED' || m.publish_status === 'REVIEW';
  return (
    <Card className="space-y-3 p-4" data-testid="share-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-[var(--sw-text)]">{t.community.shareTitle}</h2>
        <span data-testid="share-status">
          <Badge
            tone={
              m.publish_status === 'PUBLISHED'
                ? 'pass'
                : m.publish_status === 'NONE'
                  ? 'neutral'
                  : 'warn'
            }
          >
            {t.community.status[m.publish_status]}
          </Badge>
        </span>
      </div>
      <p className="text-xs text-[var(--sw-text-muted)]">{t.community.shareLead}</p>
      {m.review_note && m.publish_status === 'REJECTED' ? (
        <Alert tone="warn" title={t.community.reviewNote(m.review_note)} />
      ) : null}
      {done ? <Alert tone="pass" title={done} /> : null}
      {error ? <Alert tone="fail" title={error} /> : null}
      {!me?.handle ? (
        <div className="space-y-2">
          <label className={label}>
            <span className="font-medium text-[var(--sw-text)]">{t.community.handleTitle}</span>
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              maxLength={30}
              data-testid="share-handle"
            />
            <span className="block text-xs text-[var(--sw-text-muted)]">
              {t.community.handleLead}
            </span>
          </label>
          <Button
            size="sm"
            onClick={saveHandle}
            loading={busy === 'handle'}
            disabled={handle.trim().length < 3}
            data-testid="share-handle-save"
          >
            {t.community.handleSave}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void publish();
          }}
        >
          <label className={label}>
            <span className="font-medium text-[var(--sw-text)]">{t.community.licenseTitle}</span>
            <select
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              required
              className={`${field} h-9 py-0`}
              data-testid="share-license"
            >
              <option value="">{t.community.chooseLicense}</option>
              {licenses.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
            <span className="block text-xs text-[var(--sw-text-muted)]">
              {t.community.licenseHelp}
            </span>
          </label>
          <label className={label}>
            <span className="font-medium text-[var(--sw-text)]">{t.community.description}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={10}
              maxLength={10000}
              rows={4}
              className={field}
              data-testid="share-description"
            />
            <span className="block text-xs text-[var(--sw-text-muted)]">
              {t.community.descriptionHelp}
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>
              <span className="font-medium text-[var(--sw-text)]">{t.community.category}</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={`${field} h-9 py-0`}
                data-testid="share-category"
              >
                {Object.entries(CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              <span className="font-medium text-[var(--sw-text)]">{t.community.tags}</span>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="desk, cable"
                data-testid="share-tags"
              />
            </label>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-[var(--sw-text)]">
              {t.community.printNotes}
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className={label}>
                <span className="text-[var(--sw-text)]">{t.community.material}</span>
                <Input
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  maxLength={60}
                  placeholder="PLA"
                />
              </label>
              <label className={label}>
                <span className="text-[var(--sw-text)]">{t.community.layerHeight}</span>
                <Input
                  type="number"
                  min={0.04}
                  max={1.2}
                  step={0.02}
                  value={layer}
                  onChange={(e) => setLayer(e.target.value)}
                />
              </label>
              <label className={label}>
                <span className="text-[var(--sw-text)]">{t.community.supportsLabel}</span>
                <select
                  value={supports}
                  onChange={(e) => setSupports(e.target.value)}
                  className={`${field} h-9 py-0`}
                >
                  <option value="">—</option>
                  {Object.entries(t.community.supports).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${label} col-span-2`}>
                <span className="text-[var(--sw-text)]">{t.community.extraNotes}</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  className={field}
                />
              </label>
            </div>
          </details>
          <label className="flex items-center gap-2 text-sm text-[var(--sw-text)]">
            <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />{' '}
            {t.community.listed}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy === 'publish'} data-testid="share-publish">
              {shared ? t.community.update : t.community.publish}
            </Button>
            {shared ? (
              <Button
                type="button"
                variant="ghost"
                onClick={unpublish}
                loading={busy === 'unpublish'}
              >
                {t.community.unpublish}
              </Button>
            ) : null}
          </div>
          {m.publish_status === 'PUBLISHED' ? (
            <Link
              href={`/models/${m.id}`}
              className="block text-sm text-[var(--sw-accent)] underline"
              data-testid="share-view"
            >
              {t.community.viewPage}
            </Link>
          ) : null}
        </form>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-[var(--sw-text)]">{t.community.photos}</h3>
        {m.photos.length ? (
          <ul className="flex flex-wrap gap-2">
            {m.photos.map((p) => (
              <li key={p.id} className="space-y-1">
                <ModelImage src={p.url} alt={p.filename} className="h-20 w-20 rounded" />
                <Button size="sm" variant="ghost" onClick={() => removePhoto(p.id)}>
                  {t.community.removePhoto}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <label className={label}>
          <span className="text-[var(--sw-text)]">{t.community.addPhoto}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy === 'photo'}
            onChange={(e) => e.target.files?.[0] && void addPhoto(e.target.files[0])}
            className="block text-sm text-[var(--sw-text)]"
            data-testid="share-photo"
          />
          <span className="block text-xs text-[var(--sw-text-muted)]">{t.community.photoHint}</span>
        </label>
      </section>
    </Card>
  );
}
