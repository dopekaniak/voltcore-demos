// Fan bracket — a plate that holds a square case fan, with an upright mounting flange.
// Original Shapewright starter forge. MIT License.
//
// Prints with the fan plate flat on the bed and the flange standing up along one edge.
// The fan screw holes follow the common case-fan spacings (40, 60, 80, 92, 120, 140 mm).
const SPACING = { 40: 32, 50: 40, 60: 50, 70: 60, 80: 71.5, 92: 82.5, 120: 105, 140: 124.5 };

// Named features: one builder per feature, each labeled with its own key. The part's
// build composes them; a region edit changes one builder and nothing else.
export const features = {
  plate: (k, p, d) => {
    let s = k.shape2d([[0, 0], [p.fan, 0], [p.fan, p.fan], [0, p.fan]]);
    if (p.corner > 0.05) s = s.fillet(Math.min(p.corner, p.fan / 4));
    return s.extrude({ h: p.plate }).label('plate');
  },
  opening: (k, p, d) => k.cylinder({ d: d.opening, h: p.plate + 2 }).at([p.fan / 2, p.fan / 2, -1]).label('opening'),
  fan_holes: (k, p, d) => {
    let holes = null;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const h = k.cylinder({ d: p.screw, h: p.plate + 2 }).at([p.fan / 2 + (sx * d.spacing) / 2, p.fan / 2 + (sy * d.spacing) / 2, -1]);
      holes = holes ? holes.union(h) : h;
    }
    return holes.label('fan_holes');
  },
  flange: (k, p, d) => k.box({ min: [0, 0, 0], max: [p.fan, p.flange_t, p.flange_h] }).label('flange'),
  flange_holes: (k, p, d) => {
    if (p.mount <= 0) return null;
    let holes = null;
    for (const fx of [0.25, 0.75]) {
      const h = k.cylinder({ d: p.mount, h: p.flange_t + 2, center: true }).along('+Y').at([p.fan * fx, p.flange_t / 2, d.mountZ]);
      holes = holes ? holes.union(h) : h;
    }
    return holes.label('flange_holes');
  },
};

export default {
  meta: { title: 'Fan bracket', units: 'mm' },
  parameters: [
    {
      id: 'fan',
      title: 'Fan',
      controls: [
        { key: 'fan', label: 'Fan size', unit: 'mm', min: 40, max: 140, step: 1,
          description: 'Outside size of the square fan frame, for example 60 for a 60 mm fan.' },
        { key: 'screw', label: 'Fan screw hole', unit: 'mm', min: 2.5, max: 5.5, step: 0.1,
          description: 'Clearance hole for the fan screws. 4.3 mm suits the usual self-tapping fan screws.' },
        { key: 'plate', label: 'Plate thickness', unit: 'mm', min: 2, max: 8, step: 0.5 },
        { key: 'corner', label: 'Corner radius', unit: 'mm', min: 0, max: 10, step: 0.5 },
      ],
    },
    {
      id: 'mount',
      title: 'Mounting flange',
      controls: [
        { key: 'flange_h', label: 'Flange height', unit: 'mm', min: 12, max: 60, step: 1 },
        { key: 'flange_t', label: 'Flange thickness', unit: 'mm', min: 2, max: 8, step: 0.5 },
        { key: 'mount', label: 'Mounting hole', unit: 'mm', min: 0, max: 6, step: 0.1,
          description: 'Two screw holes through the flange. 0 for none.' },
      ],
    },
  ],
  defaults: { fan: 60, screw: 4.3, plate: 3, corner: 4, flange_h: 20, flange_t: 3, mount: 4.2 },
  derive: (p) => {
    const size = Object.keys(SPACING).map(Number).reduce((a, b) => (Math.abs(b - p.fan) < Math.abs(a - p.fan) ? b : a));
    const spacing = Math.abs(size - p.fan) <= 1 ? SPACING[size] : p.fan * 0.83;
    return {
      spacing,
      opening: Math.min(p.fan - 4, spacing + p.screw - 2),
      mountZ: Math.max(p.plate + p.mount / 2 + 2, p.plate + (p.flange_h - p.plate) / 2),
    };
  },
  parts: {
    bracket: {
      label: 'Fan bracket',
      views: { bracket: true },
      export: { name: 'fan-bracket' },
      build: (k, p, d) => {
        let s = features.plate(k, p, d).union(features.flange(k, p, d));
        s = s.cut(features.opening(k, p, d)).cut(features.fan_holes(k, p, d));
        const holes = features.flange_holes(k, p, d);
        if (holes) s = s.cut(holes);
        return s;
      },
    },
  },
  views: { bracket: { label: 'Fan bracket' } },
  verify: {
    process: 'fdm-pla',
    accept: ['supports'],
    expect: { bracket: { watertight: true } },
  },
};
