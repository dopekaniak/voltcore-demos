// Filleted box — a desk tray with rounded edges, using the kernel's fillet feature.
// Original Shapewright starter forge. MIT License.
//
// The outside vertical edges and the top rim are filleted with Solid.fillet, which runs
// natively on the Manifold backend for previews and STL/3MF, and on OpenCASCADE for STEP.
export default {
  meta: { title: 'Filleted box', units: 'mm' },
  parameters: [
    {
      id: 'size',
      title: 'Size',
      controls: [
        { key: 'w', label: 'Width', unit: 'mm', min: 20, max: 200, step: 1 },
        { key: 'd', label: 'Depth', unit: 'mm', min: 20, max: 200, step: 1 },
        { key: 'h', label: 'Height', unit: 'mm', min: 8, max: 80, step: 1 },
        { key: 'wall', label: 'Wall', unit: 'mm', min: 0.8, max: 8, step: 0.1, recommended: [1.2, 6] },
      ],
    },
    {
      id: 'edges',
      title: 'Edges',
      controls: [
        { key: 'corner', label: 'Corner fillet', unit: 'mm', min: 0, max: 20, step: 0.5,
          description: 'Radius on the four outside vertical edges.' },
        { key: 'rim', label: 'Rim fillet', unit: 'mm', min: 0, max: 4, step: 0.25,
          description: 'Radius on the outside top edge. Kept below the wall thickness.' },
      ],
    },
  ],
  defaults: { w: 90, d: 60, h: 25, wall: 2.4, corner: 8, rim: 1 },
  derive: (p) => {
    const half = Math.min(p.w, p.d) / 2;
    const corner = Math.max(0, Math.min(p.corner, half - 1));
    return { corner, rim: Math.max(0, Math.min(p.rim, p.wall * 0.8, p.h / 3)) };
  },
  parts: {
    tray: {
      label: 'Tray',
      views: { tray: true },
      export: { name: 'filleted-box' },
      build: (k, p, d) => {
        let s = k.box({ min: [0, 0, 0], max: [p.w, p.d, p.h] }).label('shell');
        if (d.corner > 0) s = s.fillet({ r: d.corner, edges: { dir: 'Z' } });
        if (d.rim > 0) s = s.fillet({ r: d.rim, edges: { inPlane: 'XY', at: p.h } });
        // Pocket: a rounded rectangle that follows the outer corners, inset by the wall.
        const iw = p.w - 2 * p.wall;
        const id = p.d - 2 * p.wall;
        let pocket = k.shape2d([[0, 0], [iw, 0], [iw, id], [0, id]]);
        const ir = Math.max(0, d.corner - p.wall);
        if (ir > 0.05) pocket = pocket.fillet(ir);
        s = s.cut(pocket.extrude({ h: p.h }).translate([p.wall, p.wall, p.wall]).label('pocket'));
        return s;
      },
    },
  },
  views: { tray: { label: 'Tray' } },
  verify: {
    process: 'fdm-pla',
    expect: { tray: { watertight: true, holes: 0 } },
  },
};
