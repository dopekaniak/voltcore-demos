'use client';
import { api, downloadBytes } from './api';

/** Download a file through a 5-minute signed URL. */
export async function downloadFile(assetId: string, fileId: string): Promise<void> {
  const { url, filename } = await api<{ url: string; filename: string }>(`/v1/assets/${assetId}/files/${fileId}/url`);
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  downloadBytes(await res.arrayBuffer(), filename, res.headers.get('content-type') ?? 'application/octet-stream');
}

export async function fileUrl(assetId: string, fileId: string): Promise<string> {
  return (await api<{ url: string }>(`/v1/assets/${assetId}/files/${fileId}/url`)).url;
}
