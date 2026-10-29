// Planter — a tapered pot with drainage holes and a rolled-out rim.
// Original Shapewright starter forge. MIT License.
//
// Prints upright with no supports: the taper widens upward at well under 45 degrees from
// vertical, and the rim flares out on a 45-degree chamfer before its flat band.
export default {
  meta: { title: 'Planter', units: 'mm' },
  parameters: [
    {
      id: 'pot',
      title: 'Pot',
      controls: [
        { key: 'diameter', label: 'Top diameter', unit: 'mm', min: 40, max: 220, step: 1,
          description: 'Outside diameter at the top of the wall, not counting the rim.' },
        { key: 'height', label: 'Height', unit: 'mm', min: 30, max: 240, step: 1 },
        { key: 'taper', label: 'Taper', unit: '%', min: 0, max: 35, step: 1,
          description: 'How much narrower the base is than the top.' },
        { key: 'wall', label: 'Wall', unit: 'mm', min: 0.8, max: 6, step: 0.1, recommended: [1.2, 4] },
      ],
    },
    {
      id: 'drain',
      title: 'Drainage',
      controls: [
        { key: 'holes', label: 'Holes', min: 0, max: 12, step: 1,
          description: 'Number of drainage holes in the floor. 1 puts a single hole in the centre.' },
        { key: 'hole_d', label: 'Hole diameter', unit: 'mm', min: 3, max: 20, step: 0.5 },
      ],
    },
    {
      id: 'rim',
      title: 'Rim',
      controls: [
        { key: 'rim', label: 'Rim width', unit: 'mm', min: 0, max: 10, step: 0.5,
          description: 'How far the rim stands out from the wall. 0 for no rim.' },
        { key: 'rim_h', label: 'Rim band', unit: 'mm', min: 1, max: 15, step: 0.5 },
      ],
    },
  ],
  defaults: { diameter: 100, height: 90, taper: 20, wall: 2, holes: 5, hole_d: 6, rim: 3, rim_h: 4 },
  derive: (p) => {
    const top = p.diameter;
    const bottom = p.diameter * (1 - p.taper / 100);
    const floor = Math.max(p.wall, 2);
    return { top, bottom, floor };
  },
  parts: {
    pot: {
      label: 'Planter',
      views: { pot: true },
      export: { name: 'planter' },
      build: (k, p, d) => {
        let s = k.cylinder({ d1: d.bottom, d2: d.top, h: p.height }).label('wall');
        // Inner cavity: the same taper, offset in by the wall, above the floor.
        const slope = (d.top - d.bottom) / 2 / p.height;
        const inset = p.wall * Math.sqrt(1 + slope * slope);
        const innerBottom = d.bottom + 2 * slope * d.floor - 2 * inset;
        s = s.cut(k.cylinder({ d1: innerBottom, d2: d.top - 2 * inset + 2 * slope, h: p.height - d.floor + 1 }).at([0, 0, d.floor]).label('cavity'));
        if (p.rim > 0) {
          const zc = p.height - p.rim_h - p.rim;
          const atZ = (z) => d.bottom + ((d.top - d.bottom) * z) / p.height;
          // 45-degree flare, then a straight band to the top edge, hollowed to the cavity.
          let rim = k.cylinder({ d1: atZ(zc), d2: atZ(zc) + 2 * p.rim, h: p.rim }).at([0, 0, zc]);
          rim = rim.union(k.cylinder({ d: atZ(zc) + 2 * p.rim, h: p.rim_h }).at([0, 0, zc + p.rim]));
          const innerAt = (z) => innerBottom + ((d.top - 2 * inset + 2 * slope - innerBottom) * (z - d.floor)) / (p.height - d.floor + 1);
          rim = rim.cut(k.cylinder({ d1: innerAt(zc - 1), d2: innerAt(p.height + 1), h: p.height - zc + 2 }).at([0, 0, zc - 1]));
          s = s.union(rim.label('rim'));
        }
        if (p.holes > 0) {
          const ring = Math.max(0, d.bottom / 2 - p.wall - p.hole_d * 1.5);
          const n = Math.round(p.holes);
          for (let i = 0; i < n; i++) {
            const a = (2 * Math.PI * i) / Math.max(1, n - 1);
            const [x, y] = i === 0 || n === 1 ? [0, 0] : [ring * Math.cos(a), ring * Math.sin(a)];
            s = s.cut(k.cylinder({ d: p.hole_d, h: d.floor + 2 }).at([x, y, -1]).label('drain'));
          }
        }
        return s;
      },
    },
  },
  views: { pot: { label: 'Planter' } },
  verify: {
    process: 'fdm-pla',
    expect: { pot: { watertight: true } },
  },
};
