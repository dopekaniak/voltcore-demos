/**
 * Image header parsing and metadata stripping for uploads (Module 6, rule 3.1: strip EXIF
 * location data). Pure byte work on PNG, JPEG, and WebP; no decoding.
 */
export type ImageKind = 'png' | 'jpg' | 'webp';
export interface ImageInfo {
  kind: ImageKind;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
const u32le = (b: Uint8Array, o: number) => b[o]! + (b[o + 1]! << 8) + (b[o + 2]! << 16) + ((b[o + 3]! << 24) >>> 0);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

export function imageKindOf(b: Uint8Array): ImageKind | null {
  if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  return null;
}

export function imageInfo(b: Uint8Array): ImageInfo | null {
  const kind = imageKindOf(b);
  try {
    if (kind === 'png') return ascii(b, 12, 4) === 'IHDR' ? { kind, width: u32be(b, 16), height: u32be(b, 20) } : null;
    if (kind === 'jpg') {
      let o = 2;
      while (o + 9 < b.length) {
        if (b[o] !== 0xff) return null;
        const m = b[o + 1]!;
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
          o += 2;
          continue;
        }
        const len = u16be(b, o + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { kind, width: u16be(b, o + 7), height: u16be(b, o + 5) };
        o += 2 + len;
      }
      return null;
    }
    if (kind === 'webp') {
      const fourcc = ascii(b, 12, 4);
      if (fourcc === 'VP8 ') return { kind, width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
      if (fourcc === 'VP8L') {
        const bits = u32le(b, 21);
        return { kind, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (fourcc === 'VP8X') return { kind, width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Remove metadata that can carry location or identity: JPEG APP1 (Exif, XMP), APP13 (IPTC)
 * and COM segments; PNG eXIf, tEXt, iTXt, zTXt, tIME chunks; WebP EXIF and XMP chunks.
 * Pixel data is untouched. Returns the input unchanged for anything it does not recognise.
 */
export function stripImageMetadata(b: Uint8Array): { data: Uint8Array; removed: number } {
  const kind = imageKindOf(b);
  const parts: Uint8Array[] = [];
  let removed = 0;
  if (kind === 'jpg') {
    parts.push(b.subarray(0, 2));
    let o = 2;
    while (o + 4 <= b.length) {
      if (b[o] !== 0xff) return { data: b, removed: 0 };
      const m = b[o + 1]!;
      if (m === 0xda) {
        parts.push(b.subarray(o)); // start of scan: the rest is image data
        break;
      }
      const len = u16be(b, o + 2);
      const seg = b.subarray(o, o + 2 + len);
      if (m === 0xe1 || m === 0xed || m === 0xfe) removed++;
      else parts.push(seg);
      o += 2 + len;
    }
  } else if (kind === 'png') {
    parts.push(b.subarray(0, 8));
    let o = 8;
    while (o + 12 <= b.length) {
      const len = u32be(b, o);
      const type = ascii(b, o + 4, 4);
      const chunk = b.subarray(o, o + 12 + len);
      if (['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'].includes(type)) removed++;
      else parts.push(chunk);
      o += 12 + len;
      if (type === 'IEND') break;
    }
  } else if (kind === 'webp') {
    const header = new Uint8Array(b.subarray(0, 12));
    parts.push(header);
    let o = 12;
    while (o + 8 <= b.length) {
      const type = ascii(b, o, 4);
      const len = u32le(b, o + 4);
      const total = 8 + len + (len % 2);
      const chunk = new Uint8Array(b.subarray(o, o + total));
      if (type === 'EXIF' || type === 'XMP ') removed++;
      else {
        if (type === 'VP8X') chunk[8] = chunk[8]! & ~0x0c; // clear the EXIF and XMP flags
        parts.push(chunk);
      }
      o += total;
    }
    const size = parts.reduce((n, p) => n + p.length, 0) - 8;
    header[4] = size & 0xff;
    header[5] = (size >> 8) & 0xff;
    header[6] = (size >> 16) & 0xff;
    header[7] = (size >>> 24) & 0xff;
  } else return { data: b, removed: 0 };
  if (removed === 0) return { data: b, removed: 0 };
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return { data: out, removed };
}
