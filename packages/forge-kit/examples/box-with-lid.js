// Rectangular box with a snap-fit lid.
// Original Shapewright starter forge. MIT License.
//
// Two printed pieces. The body prints open side up. The lid prints upside down: its plate
// is on the bed and its lip points up. A ridge on the outside of the lip clicks into a
// groove inside the body walls.
export default {
  meta: { title: 'Box with lid', units: 'mm' },
  parameters: [
    {
      id: 'inside',
      title: 'Inside size',
      description: 'The space inside the box. The outside grows by the wall on each side.',
      controls: [
        { key: 'inner_w', label: 'Inner width', unit: 'mm', min: 20, max: 200, step: 1 },
        { key: 'inner_d', label: 'Inner depth', unit: 'mm', min: 20, max: 200, step: 1 },
        { key: 'inner_h', label: 'Inner height', unit: 'mm', min: 10, max: 150, step: 1 },
      ],
    },
    {
      id: 'shell',
      title: 'Shell',
      controls: [
        { key: 'wall', label: 'Wall', unit: 'mm', min: 0.8, max: 5, step: 0.1, recommended: [1.6, 4],
          description: 'Wall and floor thickness. The lid groove needs at least 1.6 mm.' },
        { key: 'radius', label: 'Corner radius', unit: 'mm', min: 0, max: 20, step: 0.5,
          description: 'Rounds the four vertical corners.' },
        { key: 'clearance', label: 'Lid clearance', unit: 'mm', min: 0.1, max: 0.6, step: 0.05,
          description: 'Gap between lip and wall on each side. 0.2-0.3 mm suits most FDM printers.' },
        { key: 'snap', type: 'checkbox', label: 'Snap ridge', on: 1,
          description: 'Adds a ridge on the lid lip and a matching groove in the body.' },
      ],
    },
  ],
  defaults: { inner_w: 60, inner_d: 40, inner_h: 30, wall: 2, radius: 4, clearance: 0.25, snap: 1 },
  derive: (p) => {
    const W = p.inner_w + 2 * p.wall;
    const D = p.inner_d + 2 * p.wall;
    const r = Math.min(p.radius, W / 2 - 0.5, D / 2 - 0.5);
    return {
      W,
      D,
      H: p.inner_h + p.wall,
      r,
      lidT: p.wall,
      lipH: Math.min(8, Math.max(4, p.inner_h / 4)),
      lipW: Math.max(1.2, p.wall * 0.8),
      gap: 10,
    };
  },
  parts: {
    body: {
      label: 'Body',
      views: { print: true, body: true },
      export: { name: 'box-body' },
      build: (k, p, d) => {
        const rr = (w, dd, r) => {
          const shape = k.shape2d([[0, 0], [w, 0], [w, dd], [0, dd]]);
          return r > 0.05 ? shape.fillet(r) : shape;
        };
        let s = rr(d.W, d.D, d.r).extrude({ h: d.H }).label('shell');
        const ir = Math.max(0, d.r - p.wall);
        s = s.cut(rr(p.inner_w, p.inner_d, ir).extrude({ h: d.H }).translate([p.wall, p.wall, p.wall]).label('cavity'));
        if (p.snap) {
          // Grooves in the two long walls, where the lid ridge lands.
          const z0 = d.H - d.lipH + 0.6; // ridge lands at H - lipH + 0.7 .. + 2.0
          for (const y of [p.wall - 0.5, d.D - p.wall]) {
            s = s.cut(k.box({ min: [p.wall + d.r, y, z0], max: [d.W - p.wall - d.r, y + 0.5, z0 + 1.6] }).label('groove'));
          }
        }
        return s;
      },
    },
    lid: {
      label: 'Lid',
      views: { print: (s, p, d) => s.translate([d.W + d.gap, 0, 0]), lid: true },
      export: { name: 'box-lid' },
      build: (k, p, d) => {
        const rr = (w, dd, r) => {
          const shape = k.shape2d([[0, 0], [w, 0], [w, dd], [0, dd]]);
          return r > 0.05 ? shape.fillet(r) : shape;
        };
        let s = rr(d.W, d.D, d.r).extrude({ h: d.lidT }).label('plate');
        const c = p.clearance;
        const lw = p.inner_w - 2 * c;
        const ld = p.inner_d - 2 * c;
        const lipR = Math.max(0, d.r - p.wall - c);
        const lip = rr(lw, ld, lipR).extrude({ h: d.lipH })
          .cut(rr(lw - 2 * d.lipW, ld - 2 * d.lipW, Math.max(0, lipR - d.lipW)).extrude({ h: d.lipH + 2 }).translate([d.lipW, d.lipW, -1]))
          .translate([p.wall + c, p.wall + c, d.lidT]);
        s = s.union(lip.label('lip'));
        if (p.snap) {
          // Ridge on the long sides of the lip, 0.4 mm proud and 1.3 mm tall; lands in the body groove.
          const z0 = d.lidT + d.lipH - 2.0;
          for (const [y0, y1] of [[p.wall + c - 0.4, p.wall + c + 0.01], [d.D - p.wall - c - 0.01, d.D - p.wall - c + 0.4]]) {
            s = s.union(k.box({ min: [p.wall + d.r, y0, z0], max: [d.W - p.wall - d.r, y1, z0 + 1.3] }).label('ridge'));
          }
        }
        return s;
      },
    },
  },
  views: { print: { label: 'Print layout' }, body: { label: 'Body' }, lid: { label: 'Lid' } },
  verify: {
    process: 'fdm-pla',
    accept: ['supports'],
    expect: {
      body: { watertight: true },
      lid: { watertight: true },
      _view: { overlaps: 0 },
    },
  },
};
