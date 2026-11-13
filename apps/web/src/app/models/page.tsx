'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Alert, Button, EmptyState, Input, Spinner } from '@sw/ui';
import { ModelGrid } from '@/components/community/ModelCard';
import { CATEGORIES, type ModelCardData } from '@/components/community/types';
import { api } from '@/lib/api';
import { t } from '@/lib/messages';

const FILTER_KEYS = [
  'q',
  'category',
  'sort',
  'printable',
  'remixable',
  'file_type',
  'license',
  'tag',
] as const;

function Browse() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [models, setModels] = useState<ModelCardData[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<
    (typeof FILTER_KEYS)[number],
    string
  >;
  const query = params.toString();

  const set = (patch: Partial<Record<(typeof FILTER_KEYS)[number], string>>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`/models${next.size ? `?${next}` : ''}`);
  };

  const load = useCallback(
    async (after?: string) => {
      setError(null);
      try {
        const qs = new URLSearchParams(query);
        if (after) qs.set('cursor', after);
        const r = await api<{
          data: ModelCardData[];
          next_cursor: string | null;
          suggested_tags: string[];
        }>(`/v1/community/models?${qs}`);
        setModels((p) => (after ? [...(p ?? []), ...r.data] : r.data));
        setCursor(r.next_cursor);
        setSuggested(r.suggested_tags);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [query],
  );
  useEffect(() => {
    setModels(null);
    void load();
  }, [load]);

  const select =
    'h-9 rounded border border-[var(--sw-border)] bg-[var(--sw-bg)] px-2 text-sm text-[var(--sw-text)]';
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--sw-text)]">{t.community.browseTitle}</h1>
        <p className="text-sm text-[var(--sw-text-muted)]">{t.community.browseLead}</p>
      </div>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set({
            q: q.trim(),
            sort: q.trim() ? filters.sort : filters.sort === 'relevance' ? '' : filters.sort,
          });
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.community.search}
          aria-label={t.community.search}
          maxLength={100}
          data-testid="models-search"
        />
        <Button type="submit">{t.community.searchButton}</Button>
      </form>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select
          aria-label={t.community.category}
          value={filters.category}
          onChange={(e) => set({ category: e.target.value })}
          className={select}
          data-testid="models-category"
        >
          <option value="">{t.community.allCategories}</option>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label={t.community.sort}
          value={filters.sort || (filters.q ? 'relevance' : 'newest')}
          onChange={(e) => set({ sort: e.target.value })}
          className={select}
        >
          {Object.entries(t.community.sorts).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label={t.community.fileType}
          value={filters.file_type}
          onChange={(e) => set({ file_type: e.target.value })}
          className={select}
        >
          <option value="">{t.community.anyType}</option>
          {['stl', '3mf', 'obj', 'glb'].map((f) => (
            <option key={f} value={f}>
              {f.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          aria-label={t.community.license}
          value={filters.license}
          onChange={(e) => set({ license: e.target.value })}
          className={select}
        >
          <option value="">{t.community.anyLicense}</option>
          {[
            'CC0-1.0',
            'CC-BY-4.0',
            'CC-BY-SA-4.0',
            'CC-BY-NC-4.0',
            'CC-BY-ND-4.0',
            'ALL-RIGHTS-RESERVED',
          ].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[var(--sw-text)]">
          <input
            type="checkbox"
            checked={filters.printable === 'true'}
            onChange={(e) => set({ printable: e.target.checked ? 'true' : '' })}
          />
          {t.community.printableOnly}
        </label>
        <label className="flex items-center gap-1 text-[var(--sw-text)]">
          <input
            type="checkbox"
            checked={filters.remixable === 'true'}
            onChange={(e) => set({ remixable: e.target.checked ? 'true' : '' })}
          />
          {t.community.remixableOnly}
        </label>
        {filters.tag ? (
          <Button size="sm" variant="secondary" onClick={() => set({ tag: '' })}>
            #{filters.tag} ✕
          </Button>
        ) : null}
      </div>
      {error ? <Alert tone="fail" title={error} /> : null}
      {models === null ? (
        <p className="flex items-center gap-2 text-[var(--sw-text-muted)]">
          <Spinner /> {t.common.loading}
        </p>
      ) : models.length === 0 ? (
        <EmptyState title={t.community.noResults}>
          {suggested.length ? (
            <p className="flex flex-wrap items-center justify-center gap-2">
              {t.community.tryTags}
              {suggested.map((tag) => (
                <Button key={tag} size="sm" variant="secondary" onClick={() => set({ tag, q: '' })}>
                  #{tag}
                </Button>
              ))}
            </p>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <ModelGrid models={models} />
          {cursor ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                loading={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  await load(cursor);
                  setLoadingMore(false);
                }}
              >
                {t.community.loadMore}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function ModelsPage() {
  return (
    <Suspense>
      <Browse />
    </Suspense>
  );
}
