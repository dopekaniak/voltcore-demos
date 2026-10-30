/** Vertex positions (x, y, z per vertex, three per triangle) of a binary STL. */
export function parseBinaryStl(buf: Buffer): Float32Array {
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) out[t * 9 + k] = buf.readFloatLE(o + k * 4);
  }
  return out;
}
