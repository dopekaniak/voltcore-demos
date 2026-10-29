/** Binary STL builders for tests. */
type V = [number, number, number];

export function binaryStl(tris: [V, V, V][]): Buffer {
  const b = Buffer.alloc(84 + tris.length * 50);
  b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const o = 84 + i * 50 + 12;
    t.forEach((v, j) => v.forEach((c, k) => b.writeFloatLE(c, o + j * 12 + k * 4)));
  });
  return b;
}

/** An axis-aligned box from 0 to (w, d, h); `openTop` drops the two top triangles. */
export function boxStl(w: number, d: number, h: number, openTop = false): Buffer {
  const p = (x: number, y: number, z: number): V => [x * w, y * d, z * h];
  const quads: [V, V, V, V][] = [
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)], // bottom (outward -z)
    [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)], // top
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)], // front
    [p(1, 1, 0), p(0, 1, 0), p(0, 1, 1), p(1, 1, 1)], // back
    [p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)], // left
    [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)], // right
  ];
  const tris: [V, V, V][] = [];
  quads.forEach((q, i) => {
    if (openTop && i === 1) return;
    tris.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
  });
  return binaryStl(tris);
}
