import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { hmacHex, safeEqual } from '@sw/shared/node';

/** Signed URL lifetimes (build prompt 8, 12). */
export const GET_URL_TTL_S = 5 * 60;
export const PUT_URL_TTL_S = 15 * 60;

export interface Storage {
  readonly driver: 'fs' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  signedGetUrl(key: string, opts?: { filename?: string; ttlS?: number; contentType?: string }): Promise<string>;
  signedPutUrl(key: string, opts: { contentType: string; contentLength: number; ttlS?: number }): Promise<string>;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,400}$/i;
export function assertKey(key: string): string {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) throw new Error(`invalid storage key: ${key}`);
  return key;
}

// ───────────── fs driver: local disk + HMAC-signed URLs served by the API ─────────────

export interface FsSignedParams {
  op: 'get' | 'put';
  key: string;
  exp: number;
  name?: string | undefined;
  ct?: string | undefined;
  len?: number | undefined;
}

function canonical(p: FsSignedParams): string {
  return [p.op, p.key, p.exp, p.name ?? '', p.ct ?? '', p.len ?? ''].join('\n');
}

export function signFsUrl(secret: string, p: FsSignedParams): string {
  return hmacHex(secret, canonical(p));
}

export function verifyFsUrl(secret: string, p: FsSignedParams, sig: string, nowS: number): boolean {
  if (!Number.isFinite(p.exp) || p.exp < nowS) return false;
  return safeEqual(signFsUrl(secret, p), sig);
}

export function fsStorage(opts: { dir: string; secret: string; publicBase: string; now?: () => number }): Storage & { openRead(key: string): Readable; pathOf(key: string): string } {
  const root = resolve(opts.dir);
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const pathOf = (key: string) => {
    const p = resolve(root, assertKey(key));
    if (!p.startsWith(root + sep)) throw new Error('path escapes storage root');
    return p;
  };
  const url = (p: FsSignedParams) => {
    const q = new URLSearchParams({ op: p.op, exp: String(p.exp) });
    if (p.name) q.set('name', p.name);
    if (p.ct) q.set('ct', p.ct);
    if (p.len !== undefined) q.set('len', String(p.len));
    q.set('sig', signFsUrl(opts.secret, p));
    return `${opts.publicBase}/files/${p.key.split('/').map(encodeURIComponent).join('/')}?${q}`;
  };
  return {
    driver: 'fs',
    pathOf,
    openRead: (key) => createReadStream(pathOf(key)),
    async put(key, body) {
      const p = pathOf(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    get: (key) => readFile(pathOf(key)),
    async size(key) {
      try {
        return (await stat(pathOf(key))).size;
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    async move(from, to) {
      const t = pathOf(to);
      await mkdir(dirname(t), { recursive: true });
      await rename(pathOf(from), t);
    },
    async signedGetUrl(key, o = {}) {
      return url({ op: 'get', key: assertKey(key), exp: now() + (o.ttlS ?? GET_URL_TTL_S), name: o.filename, ct: o.contentType });
    },
    async signedPutUrl(key, o) {
      return url({ op: 'put', key: assertKey(key), exp: now() + (o.ttlS ?? PUT_URL_TTL_S), ct: o.contentType, len: o.contentLength });
    },
  };
}

// ───────────── s3 driver: MinIO in compose, S3 in production ─────────────

export function s3Storage(opts: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }): Storage {
  const s3 = new S3Client({
    endpoint: opts.endpoint,
    region: opts.region,
    forcePathStyle: true,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
  });
  const Bucket = opts.bucket;
  return {
    driver: 's3',
    async put(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket, Key: assertKey(key), Body: body, ContentType: contentType }));
    },
    async get(key) {
      const r = await s3.send(new GetObjectCommand({ Bucket, Key: assertKey(key) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
    async size(key) {
      try {
        const r = await s3.send(new HeadObjectCommand({ Bucket, Key: assertKey(key) }));
        return r.ContentLength ?? null;
      } catch {
        return null;
      }
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: assertKey(key) }));
    },
    async move(from, to) {
      await s3.send(new CopyObjectCommand({ Bucket, Key: assertKey(to), CopySource: `${Bucket}/${assertKey(from)}` }));
      await s3.send(new DeleteObjectCommand({ Bucket, Key: from }));
    },
    signedGetUrl(key, o = {}) {
      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket,
          Key: assertKey(key),
          ...(o.filename ? { ResponseContentDisposition: `attachment; filename="${o.filename.replace(/["\\]/g, '')}"` } : {}),
        }),
        { expiresIn: o.ttlS ?? GET_URL_TTL_S },
      );
    },
    signedPutUrl(key, o) {
      return getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: assertKey(key), ContentType: o.contentType, ContentLength: o.contentLength }), {
        expiresIn: o.ttlS ?? PUT_URL_TTL_S,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
    },
  };
}

export function storageFromEnv(env: {
  STORAGE_DRIVER: 'fs' | 's3';
  STORAGE_DIR: string;
  APP_SECRET: string;
  PUBLIC_FILES_BASE: string;
  S3_ENDPOINT?: string | undefined;
  S3_REGION: string;
  S3_BUCKET?: string | undefined;
  S3_ACCESS_KEY?: string | undefined;
  S3_SECRET_KEY?: string | undefined;
}): Storage {
  if (env.STORAGE_DRIVER === 's3') {
    return s3Storage({ endpoint: env.S3_ENDPOINT!, region: env.S3_REGION, bucket: env.S3_BUCKET!, accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! });
  }
  return fsStorage({ dir: env.STORAGE_DIR, secret: env.APP_SECRET, publicBase: env.PUBLIC_FILES_BASE });
}
