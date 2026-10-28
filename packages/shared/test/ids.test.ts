import { describe, expect, it } from 'vitest';
import { fromApiId, newId, toApiId } from '../src/ids';

describe('ids', () => {
  it('round-trips a UUIDv7 through a prefixed API id', () => {
    const id = newId();
    expect(id[14]).toBe('7');
    const api = toApiId('job', id);
    expect(api).toMatch(/^job_[0-9a-f]{32}$/);
    expect(fromApiId('job', api)).toBe(id);
  });
  it('rejects a wrong prefix or malformed body', () => {
    const api = toApiId('job', newId());
    expect(fromApiId('order', api)).toBeNull();
    expect(fromApiId('job', 'job_xyz')).toBeNull();
    expect(fromApiId('job', 42 as unknown as string)).toBeNull();
  });
  it('ids sort by creation time', () => {
    const a = newId();
    const b = newId();
    expect(a < b).toBe(true);
  });
});
