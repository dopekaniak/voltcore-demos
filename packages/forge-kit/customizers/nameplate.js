// Name plate / keychain — raised lettering on a rounded plate with an optional key ring hole.
// Original Shapewright starter customizer. MIT License. Uses the bundled Roboto face (OFL).
export default {
  meta: { title: 'Name plate', units: 'mm' },
  parameters: [
    {
      id: 'text',
      title: 'Text',
      controls: [
        { key: 'label', type: 'text', label: 'Name', description: 'Up to 16 letters, numbers, spaces, and - . \' &' },
        { key: 'size', label: 'Letter height', unit: 'mm', min: 4, max: 16, step: 0.5 },
        { key: 'depth', label: 'Letter depth', unit: 'mm', min: 0.6, max: 3, step: 0.1 },
      ],
    },
    {
      id: 'plate',
      title: 'Plate',
      controls: [
        { key: 'width', label: 'Width', unit: 'mm', min: 30, max: 120, step: 1 },
        { key: 'height', label: 'Height', unit: 'mm', min: 12, max: 50, step: 1 },
        { key: 'thickness', label: 'Thickness', unit: 'mm', min: 1.6, max: 6, step: 0.2 },
        { key: 'ring', type: 'checkbox', label: 'Key ring hole', on: 1 },
      ],
    },
  ],
  defaults: { label: 'ALEX', size: 9, depth: 1.2, width: 60, height: 22, thickness: 3, ring: 1 },
  derive: (p) => ({ r: Math.min(4, p.height / 4), hole: Math.min(5, p.height / 3) }),
  parts: {
    plate: {
      label: 'Name plate',
      views: { plate: true },
      export: { name: 'name-plate' },
      build: (k, p, d) => {
        let plate = k.shape2d([[0, 0], [p.width, 0], [p.width, p.height], [0, p.height]]).fillet(d.r);
        let s = plate.extrude({ h: p.thickness }).label('plate');
        if (p.ring) {
          s = s.cut(k.cylinder({ d: d.hole, h: p.thickness + 2 }).at([d.hole, p.height / 2, -1]).label('ring'));
        }
        const text = (p.label || ' ').trim() || ' ';
        if (text.trim()) {
          const left = p.ring ? d.hole * 2 : 2;
          // A small outward offset keeps strokes printable (at least the 1.2 mm wall minimum).
          const glyphs = k.text2d(text, { size: p.size, align: 'center', valign: 'middle' }).offset(0.5).translate([(p.width + left) / 2, p.height / 2]);
          s = s.union(glyphs.extrude({ h: p.depth }).translate([0, 0, p.thickness]).label('lettering'));
        }
        return s;
      },
    },
  },
  views: { plate: { label: 'Plate' } },
  verify: { process: 'fdm-pla', expect: { plate: { watertight: true } } },
};
