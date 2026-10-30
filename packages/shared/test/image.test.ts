import { describe, expect, it } from 'vitest';
import { imageInfo, stripImageMetadata } from '../src/image';

const chunk = (type: string, data: number[]) => {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'latin1');
  Buffer.from(data).copy(b, 8);
  return b;
};
const ihdr = (w: number, h: number) => {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = 8;
  d[9] = 2;
  return chunk('IHDR', [...d]);
};
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('image metadata', () => {
  it('reads PNG size and strips eXIf and text chunks, keeping pixel chunks', () => {
    const png = Buffer.concat([SIG, ihdr(640, 480), chunk('eXIf', [...Buffer.from('GPS 52N')]), chunk('tEXt', [...Buffer.from('Author\0me')]), chunk('IDAT', [1, 2, 3]), chunk('IEND', [])]);
    expect(imageInfo(png)).toEqual({ kind: 'png', width: 640, height: 480 });
    const r = stripImageMetadata(png);
    expect(r.removed).toBe(2);
    const out = Buffer.from(r.data);
    expect(out.includes(Buffer.from('eXIf'))).toBe(false);
    expect(out.includes(Buffer.from('IDAT'))).toBe(true);
    expect(imageInfo(out)).toEqual({ kind: 'png', width: 640, height: 480 });
  });

  it('strips WebP EXIF chunks and fixes the RIFF size and flags', () => {
    const vp8x = Buffer.alloc(18);
    vp8x.write('VP8X', 0, 'latin1');
    vp8x.writeUInt32LE(10, 4);
    vp8x[8] = 0x08; // EXIF flag
    vp8x.writeUIntLE(99, 12, 3);
    vp8x.writeUIntLE(49, 15, 3);
    const exif = Buffer.concat([Buffer.from('EXIF', 'latin1'), Buffer.from([4, 0, 0, 0]), Buffer.from('GPS!')]);
    const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), vp8x, exif]);
    const head = Buffer.alloc(8);
    head.write('RIFF', 0, 'latin1');
    head.writeUInt32LE(body.length, 4);
    const webp = Buffer.concat([head, body]);
    expect(imageInfo(webp)).toEqual({ kind: 'webp', width: 100, height: 50 });
    const out = Buffer.from(stripImageMetadata(webp).data);
    expect(out.includes(Buffer.from('GPS!'))).toBe(false);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out[20]! & 0x08).toBe(0);
  });

  it('leaves unknown data untouched', () => {
    const b = Buffer.from('plain text');
    expect(stripImageMetadata(b)).toEqual({ data: b, removed: 0 });
    expect(imageInfo(b)).toBeNull();
  });
});
