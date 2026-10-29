import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertKey, fsStorage, verifyFsUrl } from '../src/index';

describe('fs storage driver', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-storage-'));
  const t = 1_000_000;
  const s = fsStorage({ dir, secret: 's'.repeat(40), publicBase: 'http://localhost:3000/api', now: () => t });

  it('puts, gets, moves, deletes', async () => {
    await s.put('quarantine/a/b.stl', Buffer.from('hello'), 'model/stl');
    expect((await s.get('quarantine/a/b.stl')).toString()).toBe('hello');
    await s.move('quarantine/a/b.stl', 'files/a/b.stl');
    expect(await s.size('quarantine/a/b.stl')).toBeNull();
    expect(await s.size('files/a/b.stl')).toBe(5);
    await s.delete('files/a/b.stl');
    expect(await s.size('files/a/b.stl')).toBeNull();
  });

  it('rejects keys that escape the root', () => {
    expect(() => assertKey('../etc/passwd')).toThrow();
    expect(() => assertKey('/abs')).toThrow();
    expect(() => assertKey('a//b')).toThrow();
  });

  it('signs GET URLs for 5 minutes and PUT URLs for 15, bound to type and length', async () => {
    const get = new URL(await s.signedGetUrl('files/x.stl', { filename: 'x.stl' }));
    expect(Number(get.searchParams.get('exp'))).toBe(t + 300);
    const put = new URL(await s.signedPutUrl('quarantine/y.stl', { contentType: 'model/stl', contentLength: 42 }));
    expect(Number(put.searchParams.get('exp'))).toBe(t + 900);
    const p = { op: 'put' as const, key: 'quarantine/y.stl', exp: Number(put.searchParams.get('exp')), ct: 'model/stl', len: 42 };
    const sig = put.searchParams.get('sig')!;
    expect(verifyFsUrl('s'.repeat(40), p, sig, t)).toBe(true);
    expect(verifyFsUrl('s'.repeat(40), { ...p, len: 43 }, sig, t)).toBe(false);
    expect(verifyFsUrl('s'.repeat(40), { ...p, ct: 'text/plain' }, sig, t)).toBe(false);
    expect(verifyFsUrl('s'.repeat(40), p, sig, t + 901)).toBe(false);
  });
});
