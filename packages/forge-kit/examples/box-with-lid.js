// Rectangular box with a snap-fit lid.
// Original Shapewright starter forge. MIT License.
//
// Two printed pieces. The body prints open side up. The lid prints upside down: its plate
// is on the bed and its lip points up. A ridge on the outside of the lip clicks into a
// groove inside the body walls.
// Rounded rectangle profile with its corner at the origin.
const rr = (k, w, dd, r) => {
  const shape = k.shape2d([[0, 0], [w, 0], [w, dd], [0, dd]]);
  return r > 0.05 ? shape.fillet(r) : shape;
};

// Named features: one builder per feature, each labeled with its own key. The parts'
// builds compose them; a region edit changes one builder and nothing else.
export const features = {
  shell: (k, p, d) => rr(k, d.W, d.D, d.r).extrude({ h: d.H }).label('shell'),
  cavity: (k, p, d) => rr(k, p.inner_w, p.inner_d, Math.max(0, d.r - p.wall)).extrude({ h: d.H }).translate([p.wall, p.wall, p.wall]).label('cavity'),
  groove: (k, p, d) => {
    if (!p.snap) return null;
    // Grooves in the two long walls, where the lid ridge lands.
    const z0 = d.H - d.lipH + 0.6; // ridge lands at H - lipH + 0.7 .. + 2.0
    let g = null;
    for (const y of [p.wall - 0.5, d.D - p.wall]) {
      const b = k.box({ min: [p.wall + d.r, y, z0], max: [d.W - p.wall - d.r, y + 0.5, z0 + 1.6] });
      g = g ? g.union(b) : b;
    }
    return g.label('groove');
  },
  plate: (k, p, d) => rr(k, d.W, d.D, d.r).extrude({ h: d.lidT }).label('plate'),
  lip: (k, p, d) => {
    const c = p.clearance;
    const lw = p.inner_w - 2 * c;
    const ld = p.inner_d - 2 * c;
    const lipR = Math.max(0, d.r - p.wall - c);
    const lip = rr(k, lw, ld, lipR).extrude({ h: d.lipH })
      .cut(rr(k, lw - 2 * d.lipW, ld - 2 * d.lipW, Math.max(0, lipR - d.lipW)).extrude({ h: d.lipH + 2 }).translate([d.lipW, d.lipW, -1]))
      .translate([p.wall + c, p.wall + c, d.lidT]);
    return lip.label('lip');
  },
  ridge: (k, p, d) => {
    if (!p.snap) return null;
    // Ridge on the long sides of the lip, 0.4 mm proud and 1.3 mm tall; lands in the body groove.
    const c = p.clearance;
    const z0 = d.lidT + d.lipH - 2.0;
    let r = null;
    for (const [y0, y1] of [[p.wall + c - 0.4, p.wall + c + 0.01], [d.D - p.wall - c - 0.01, d.D - p.wall - c + 0.4]]) {
      const b = k.box({ min: [p.wall + d.r, y0, z0], max: [d.W - p.wall - d.r, y1, z0 + 1.3] });
      r = r ? r.union(b) : b;
    }
    return r.label('ridge');
  },
};

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
        let s = features.shell(k, p, d).cut(features.cavity(k, p, d));
        const groove = features.groove(k, p, d);
        if (groove) s = s.cut(groove);
        return s;
      },
    },
    lid: {
      label: 'Lid',
      views: { print: (s, p, d) => s.translate([d.W + d.gap, 0, 0]), lid: true },
      export: { name: 'box-lid' },
      build: (k, p, d) => {
        let s = features.plate(k, p, d).union(features.lip(k, p, d));
        const ridge = features.ridge(k, p, d);
        if (ridge) s = s.union(ridge);
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
