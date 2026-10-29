// Cable clip — a snap-in ring on a flat mounting base.
// Original Shapewright starter forge. MIT License.
//
// Printed lying flat: the ring axis is Z, so the whole profile sits on the bed and no
// part of the clip overhangs. The opening at the top is narrower than the cable, so the
// cable snaps in and stays.
export default {
  meta: { title: 'Cable clip', units: 'mm' },
  parameters: [
    {
      id: 'cable',
      title: 'Cable',
      description: 'Size the ring around the cable you want to hold.',
      controls: [
        { key: 'cable', label: 'Cable diameter', unit: 'mm', min: 2, max: 20, step: 0.5,
          description: 'Outside diameter of the cable. Measure it with calipers if you can.' },
        { key: 'width', label: 'Clip width', unit: 'mm', min: 4, max: 40, step: 1,
          description: 'Length of the clip along the cable.' },
        { key: 'snap', label: 'Snap opening', unit: '%', min: 50, max: 95, step: 1,
          description: 'Opening as a share of the cable diameter. Lower holds tighter.' },
      ],
    },
    {
      id: 'body',
      title: 'Body',
      controls: [
        { key: 'wall', label: 'Wall', unit: 'mm', min: 0.8, max: 6, step: 0.1, recommended: [1.2, 4],
          description: 'Ring wall thickness. Under 1.2 mm the ring gets fragile.' },
        { key: 'base', label: 'Base thickness', unit: 'mm', min: 1, max: 8, step: 0.5,
          description: 'Thickness of the flat mounting base.' },
        { key: 'tab', label: 'Tab length', unit: 'mm', min: 0, max: 20, step: 1,
          description: 'How far the base reaches past the ring on each side.' },
        { key: 'hole', label: 'Screw hole', unit: 'mm', min: 0, max: 6, step: 0.1,
          description: 'Diameter of a screw hole through each tab. 0 for no holes.' },
      ],
    },
  ],
  defaults: { cable: 6, width: 10, snap: 75, wall: 2, base: 2, tab: 6, hole: 3.2 },
  derive: (p) => ({
    r: p.cable / 2 + 0.15,              // ring bore radius with a small clearance
    R: p.cable / 2 + 0.15 + p.wall,     // ring outer radius
    gap: (p.cable * p.snap) / 100,      // snap opening width at the bore
    // Half-angle of the wedge whose chord at the bore radius equals the opening.
    alpha: Math.asin(Math.min(0.99, (p.cable * p.snap) / 100 / (2 * (p.cable / 2 + 0.15)))),
  }),
  parts: {
    clip: {
      label: 'Clip',
      views: { clip: true },
      export: { name: 'cable-clip' },
      build: (k, p, d) => {
        const ring = k.cylinder({ r: d.R, h: p.width });
        const baseTop = Math.min(-d.R + p.base, 0);
        const base = k.box({ min: [-(d.R + p.tab), -d.R, 0], max: [d.R + p.tab, baseTop, p.width] });
        let s = ring.union(base).label('body');
        s = s.cut(k.cylinder({ r: d.r, h: p.width + 2 }).at([0, 0, -1]).label('bore'));
        // Snap mouth: a radial wedge. Its faces meet both circles at right angles, so the
        // arm tips have no thin corners, and the mouth widens outward to guide the cable.
        const sa = Math.sin(d.alpha);
        const ca = Math.cos(d.alpha);
        const L = (d.R + 1) / ca;
        const wedge = k.prism({ points: [[0, 0], [L * sa, L * ca], [-L * sa, L * ca]], h: p.width + 2 }).at([0, 0, -1]);
        s = s.cut(wedge.label('snap'));
        if (p.hole > 0 && p.tab >= p.hole + 1) {
          for (const side of [-1, 1]) {
            const x = side * (d.R + p.tab / 2);
            s = s.cut(k.cylinder({ d: p.hole, h: p.base + 2, center: true }).along('+Y').at([x, -d.R + p.base / 2, p.width / 2]).label('screw-hole'));
          }
        }
        return s;
      },
    },
  },
  views: { clip: { label: 'Clip' } },
  verify: {
    process: 'fdm-pla',
    expect: { clip: { watertight: true, bbox: '<=[120,120,120]' } },
  },
};
