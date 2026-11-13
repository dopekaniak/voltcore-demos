'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Dialog, Spinner } from '@sw/ui';
import { ModelImage } from '@/components/community/ModelCard';
import {
  CATEGORIES,
  type CollectionData,
  type Comment,
  type ModelDetail,
} from '@/components/community/types';
import { api, downloadBytes } from '@/lib/api';
import { t } from '@/lib/messages';
import { useSession } from '@/lib/session';

const ModelViewer = dynamic(() => import('@sw/ui/viewer'), { ssr: false });

export default function ModelPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me } = useSession();
  const [m, setM] = useState<ModelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState('copyright');
  const [details, setDetails] = useState('');
  const [collections, setCollections] = useState<CollectionData[] | null>(null);

  const load = useCallback(() => {
    api<ModelDetail>(`/v1/community/models/${id}`)
      .then(setM)
      .catch((e: Error) => setError(e.message));
    api<{ data: Comment[] }>(`/v1/community/models/${id}/comments`)
      .then((r) => setComments(r.data))
      .catch(() => undefined);
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (me)
      api<{ data: CollectionData[] }>('/v1/collections')
        .then((r) => setCollections(r.data))
        .catch(() => undefined);
  }, [me]);

  const needSignIn = () => router.push(`/sign-in?next=${encodeURIComponent(`/models/${id}`)}`);
  async function act(name: string, fn: () => Promise<void>) {
    if (!me) return needSignIn();
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const download = (fileId?: string) =>
    act('download', async () => {
      const r = await api<{ url: string; filename: string }>(
        `/v1/community/models/${id}/download`,
        { method: 'POST', body: fileId ? { file_id: fileId } : {} },
      );
      const res = await fetch(r.url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      downloadBytes(
        await res.arrayBuffer(),
        r.filename,
        res.headers.get('content-type') ?? 'application/octet-stream',
      );
      setM((x) => (x && !x.is_owner ? { ...x, downloads: x.downloads + 1 } : x));
    });
  const toggle = (kind: 'like' | 'save') =>
    act(kind, async () => {
      const on = kind === 'like' ? !m!.liked : !m!.saved;
      const r = await api<{ active: boolean; count: number }>(
        `/v1/community/models/${id}/${kind}`,
        { method: on ? 'PUT' : 'DELETE' },
      );
      setM((x) =>
        x
          ? kind === 'like'
            ? { ...x, liked: r.active, likes: r.count }
            : { ...x, saved: r.active, saves: r.count }
          : x,
      );
    });
  const follow = () =>
    act('follow', async () => {
      const r = await api<{ active: boolean; count: number }>(
        `/v1/creators/${m!.creator.handle}/follow`,
        { method: m!.following ? 'DELETE' : 'PUT' },
      );
      setM((x) =>
        x ? { ...x, following: r.active, creator: { ...x.creator, followers: r.count } } : x,
      );
    });
  const remix = () =>
    act('remix', async () => {
      const r = await api<{ asset_id: string }>(`/v1/community/models/${id}/remix`, {
        method: 'POST',
        idempotent: true,
      });
      router.push(`/library/${r.asset_id}`);
    });
  const comment = () =>
    act('comment', async () => {
      const c = await api<Comment>(`/v1/community/models/${id}/comments`, {
        method: 'POST',
        body: { body: draft },
      });
      setComments((x) => [...x, c]);
      setDraft('');
    });
  const removeComment = (cid: string) =>
    act('comment', async () => {
      await api(`/v1/community/comments/${cid}`, { method: 'DELETE' });
      setComments((x) => x.filter((c) => c.id !== cid));
    });
  const sendReport = () =>
    act('report', async () => {
      await api('/v1/reports', {
        method: 'POST',
        body: { target_type: 'MODEL', target_id: id, reason, details },
      });
      setReportOpen(false);
      setNotice(t.community.reported);
    });
  const addTo = (cid: string) =>
    act('collect', async () => {
      await api(`/v1/collections/${cid}/items`, { method: 'POST', body: { model_id: id } });
      setNotice(t.community.added);
    });

  if (error && !m) return <Alert tone="fail" title={error} />;
  if (!m)
    return (
      <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
        <Spinner /> {t.common.loading}
      </p>
    );
  const notes = m.print_notes
    ? Object.entries(m.print_notes).filter(([, v]) => v !== '' && v !== null)
    : [];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--sw-text)]" data-testid="model-title">
            {m.title}
          </h1>
          <p className="text-sm text-[var(--sw-text-muted)]">
            <Link
              href={`/creators/${m.creator.handle}`}
              className="text-[var(--sw-accent)] underline"
            >
              {m.creator.handle}
            </Link>
            {m.category ? <> · {CATEGORIES[m.category] ?? m.category}</> : null}
            {m.publish_status !== 'PUBLISHED' ? (
              <>
                {' '}
                · <Badge tone="warn">{t.community.status[m.publish_status]}</Badge>
              </>
            ) : null}
          </p>
        </div>
        {m.view ? (
          <ModelViewer
            url={m.view.url}
            format={m.view.format}
            className="h-[50vh] min-h-[300px]"
            label={m.title}
          />
        ) : (
          <div className="h-[50vh] min-h-[300px] animate-pulse rounded-lg bg-[var(--sw-viewer-bg)]" />
        )}
        {m.photos.length ? (
          <section aria-label={t.community.photos} className="flex gap-2 overflow-x-auto">
            {m.photos.map((p) => (
              <ModelImage
                key={p.id}
                src={p.url}
                alt={p.filename}
                className="h-28 w-28 shrink-0 rounded"
              />
            ))}
          </section>
        ) : null}
        {m.needs_repair ? (
          <Alert tone="warn" title={t.community.needsRepair}>
            {t.community.needsRepairLead}
          </Alert>
        ) : null}
        <p className="whitespace-pre-line text-[var(--sw-text)]" data-testid="model-description">
          {m.description}
        </p>
        {m.tags.length ? (
          <p className="flex flex-wrap gap-2">
            {m.tags.map((tag) => (
              <Link
                key={tag}
                href={`/models?tag=${encodeURIComponent(tag)}`}
                className="rounded-full bg-[var(--sw-surface)] px-2 py-0.5 text-xs text-[var(--sw-text)]"
              >
                #{tag}
              </Link>
            ))}
          </p>
        ) : null}
        {m.remix_of || m.remixes.length ? (
          <section className="space-y-1 text-sm" data-testid="lineage">
            {m.remix_of ? (
              <p className="text-[var(--sw-text)]">
                {t.community.remixOf}{' '}
                <Link
                  className="text-[var(--sw-accent)] underline"
                  href={`/models/${m.remix_of.id}`}
                >
                  {m.remix_of.title}
                </Link>{' '}
                {t.community.by(m.remix_of.creator)} ({m.remix_of.license_code})
              </p>
            ) : null}
            {m.remixes.length ? (
              <div>
                <h2 className="font-semibold text-[var(--sw-text)]">{t.community.remixes}</h2>
                <ul className="ml-4 list-disc">
                  {m.remixes.map((r) => (
                    <li key={r.id}>
                      <Link className="text-[var(--sw-accent)] underline" href={`/models/${r.id}`}>
                        {r.title}
                      </Link>{' '}
                      {t.community.by(r.creator)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
        <section className="space-y-2">
          <h2 className="font-semibold text-[var(--sw-text)]">{t.community.comments}</h2>
          {comments.length === 0 ? (
            <p className="text-sm text-[var(--sw-text-muted)]">{t.community.noComments}</p>
          ) : null}
          <ul className="space-y-2" data-testid="comments">
            {comments.map((c) => (
              <li key={c.id} className="rounded border border-[var(--sw-border)] p-2 text-sm">
                <p className="text-xs text-[var(--sw-text-muted)]">
                  {c.author.handle ?? c.author.name ?? t.community.aMaker} ·{' '}
                  {new Date(c.created_at).toLocaleDateString()}
                </p>
                <p className="whitespace-pre-line text-[var(--sw-text)]">{c.body}</p>
                {c.is_mine ? (
                  <Button size="sm" variant="ghost" onClick={() => removeComment(c.id)}>
                    {t.community.deleteComment}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {me ? (
            m.publish_status === 'PUBLISHED' ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void comment();
                }}
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder={t.community.commentPlaceholder}
                  aria-label={t.community.commentPlaceholder}
                  className="w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] p-2 text-sm text-[var(--sw-text)]"
                  data-testid="comment-input"
                />
                <Button
                  type="submit"
                  disabled={!draft.trim()}
                  loading={busy === 'comment'}
                  data-testid="comment-send"
                >
                  {t.community.commentSend}
                </Button>
              </form>
            ) : null
          ) : (
            <p className="text-sm">
              <Link
                className="text-[var(--sw-accent)] underline"
                href={`/sign-in?next=${encodeURIComponent(`/models/${id}`)}`}
              >
                {t.community.commentSignIn}
              </Link>
            </p>
          )}
        </section>
      </div>
      <aside className="space-y-4">
        {notice ? <Alert tone="pass" title={notice} /> : null}
        {error ? <Alert tone="fail" title={error} /> : null}
        <Card className="space-y-3 p-4">
          <Button
            className="w-full"
            onClick={() => download()}
            loading={busy === 'download'}
            data-testid="model-download"
          >
            {me ? t.community.download : t.community.downloadSignIn}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              aria-pressed={m.liked}
              onClick={() => toggle('like')}
              loading={busy === 'like'}
              data-testid="model-like"
            >
              {m.liked ? t.community.liked : t.community.like} · {m.likes}
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              aria-pressed={m.saved}
              onClick={() => toggle('save')}
              loading={busy === 'save'}
              data-testid="model-save"
            >
              {m.saved ? t.community.saved : t.community.save}
            </Button>
          </div>
          {m.license.allows_derivatives ? (
            <Button
              variant="secondary"
              className="w-full"
              onClick={remix}
              loading={busy === 'remix'}
              data-testid="model-remix"
            >
              {t.community.remix}
            </Button>
          ) : (
            <p className="text-xs text-[var(--sw-text-muted)]">{t.community.noRemix}</p>
          )}
          {me && collections?.length ? (
            <select
              aria-label={t.community.addToCollection}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) void addTo(e.target.value);
                e.target.value = '';
              }}
              className="h-9 w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 text-sm text-[var(--sw-text)]"
              data-testid="model-collect"
            >
              <option value="">{t.community.addToCollection}…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          ) : null}
          <p
            className="font-mono text-xs tabular-nums text-[var(--sw-text-muted)]"
            data-testid="model-stats"
          >
            {t.community.downloads(m.downloads)} · {t.community.likes(m.likes)}
          </p>
        </Card>
        <Card className="space-y-2 p-4 text-sm" data-testid="model-license">
          <h2 className="font-semibold text-[var(--sw-text)]">
            {t.community.licenseTitle}: {m.license.code}
          </h2>
          <p className="text-[var(--sw-text-muted)]">{m.license.name}</p>
          <p className="text-[var(--sw-text)]">
            <span className="text-[var(--sw-text-muted)]">{t.community.attribution}:</span>{' '}
            {m.license.attribution}
          </p>
          <ul className="space-y-0.5 text-xs text-[var(--sw-text)]">
            <li>
              {m.license.allows_print_order
                ? `✓ ${t.community.allowsPrint}`
                : `• ${t.community.noPrint}`}
            </li>
            <li>
              {m.license.allows_derivatives
                ? `✓ ${t.community.allowsRemix}`
                : `• ${t.community.noRemixShort}`}
            </li>
            <li>
              {m.license.allows_commercial
                ? `✓ ${t.community.commercial}`
                : `• ${t.community.nonCommercial}`}
            </li>
          </ul>
        </Card>
        <Card className="space-y-2 p-4 text-sm">
          <Link
            href={`/creators/${m.creator.handle}`}
            className="font-semibold text-[var(--sw-accent)] underline"
          >
            {m.creator.handle}
          </Link>
          <p className="text-[var(--sw-text-muted)]">
            {t.community.followers(m.creator.followers)} · {t.community.models(m.creator.models)}
          </p>
          {!m.is_owner ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={follow}
              loading={busy === 'follow'}
              data-testid="creator-follow"
            >
              {m.following ? t.community.following : t.community.follow}
            </Button>
          ) : null}
        </Card>
        {notes.length ? (
          <Card className="space-y-1 p-4 text-sm">
            <h2 className="font-semibold text-[var(--sw-text)]">{t.community.printNotes}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {notes.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-[var(--sw-text-muted)]">{t.community.notes[k] ?? k}</dt>
                  <dd className="text-[var(--sw-text)]">
                    {k === 'supports' ? (t.community.supports[String(v)] ?? v) : v}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ) : null}
        <Card className="space-y-1 p-4 text-sm">
          <h2 className="font-semibold text-[var(--sw-text)]">{t.community.files}</h2>
          {m.bbox_mm ? (
            <p className="font-mono text-xs tabular-nums text-[var(--sw-text-muted)]">
              {t.community.size}: {m.bbox_mm.map((n) => n.toFixed(1)).join(' × ')} mm
            </p>
          ) : null}
          <ul className="space-y-1">
            {m.files.map((f) => (
              <li key={f.id} className="flex items-center justify-between">
                <span className="text-[var(--sw-text)]">
                  {f.filename}{' '}
                  <span className="font-mono text-xs text-[var(--sw-text-muted)]">
                    {(f.bytes / 1024).toFixed(0)} KB
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => download(f.id)}>
                  {t.community.download}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
        {me && !m.is_owner ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReportOpen(true)}
            data-testid="model-report"
          >
            {t.community.report}
          </Button>
        ) : null}
        {m.is_owner ? (
          <Link className="text-sm text-[var(--sw-accent)] underline" href={`/library/${m.id}`}>
            {t.community.shareTitle}
          </Link>
        ) : null}
      </aside>
      <Dialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t.community.reportTitle}
        footer={
          <Button onClick={sendReport} loading={busy === 'report'}>
            {t.community.reportSend}
          </Button>
        }
      >
        <fieldset className="space-y-1 text-sm">
          {Object.entries(t.community.reportReasons).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 text-[var(--sw-text)]">
              <input
                type="radio"
                name="reason"
                value={k}
                checked={reason === k}
                onChange={() => setReason(k)}
              />{' '}
              {v}
            </label>
          ))}
        </fieldset>
        <label className="mt-2 block text-sm">
          <span className="text-[var(--sw-text)]">{t.community.reportDetails}</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={2000}
            rows={3}
            className="w-full rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] p-2 text-[var(--sw-text)]"
          />
        </label>
      </Dialog>
    </div>
  );
}
