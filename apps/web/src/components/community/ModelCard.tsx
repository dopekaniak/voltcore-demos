'use client';
import Link from 'next/link';
import { Badge, Card } from '@sw/ui';
import { t } from '@/lib/messages';
import type { ModelCardData } from './types';

/** A model's photo or render. URLs come signed in the API response (no request per image). */
export function ModelImage({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className: string;
}) {
  if (src)
    return <img src={src} alt={alt} loading="lazy" className={`${className} object-cover`} />;
  return (
    <div
      className={`${className} flex items-center justify-center bg-[var(--sw-surface)] text-[var(--sw-text-muted)]`}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="h-10 w-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <path d="M12 2 3 7v10l9 5 9-5V7z" />
        <path d="m3 7 9 5 9-5M12 12v10" />
      </svg>
    </div>
  );
}

export function ModelCard({ m }: { m: ModelCardData }) {
  return (
    <Card className="overflow-hidden p-0" data-testid="model-card">
      <Link
        href={`/models/${m.id}`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sw-accent)]"
      >
        <ModelImage src={m.image_url} alt="" className="h-40 w-full" />
        <div className="space-y-1 p-3">
          <h3 className="line-clamp-2 font-medium text-[var(--sw-text)]">{m.title}</h3>
          <p className="text-xs text-[var(--sw-text-muted)]">{t.community.by(m.creator.handle)}</p>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <Badge>{m.license_code}</Badge>
            {m.needs_repair ? <Badge tone="warn">{t.community.needsRepair}</Badge> : null}
          </div>
          <p className="font-mono text-xs tabular-nums text-[var(--sw-text-muted)]">
            {t.community.downloads(m.downloads)} · {t.community.likes(m.likes)}
          </p>
        </div>
      </Link>
    </Card>
  );
}

export function ModelGrid({ models }: { models: ModelCardData[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="model-grid">
      {models.map((m) => (
        <li key={m.id}>
          <ModelCard m={m} />
        </li>
      ))}
    </ul>
  );
}
