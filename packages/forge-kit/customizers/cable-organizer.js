// Cable organizer — a desk-edge comb with a parametric number of cable slots.
// Original Shapewright starter customizer. MIT License.
export default {
  meta: { title: 'Cable organizer', units: 'mm' },
  parameters: [
    {
      id: 'slots',
      title: 'Slots',
      controls: [
        { key: 'count', label: 'Number of cables', min: 1, max: 12, step: 1 },
        { key: 'cable', label: 'Cable diameter', unit: 'mm', min: 3, max: 12, step: 0.5 },
        { key: 'pitch', label: 'Spacing', unit: 'mm', min: 8, max: 25, step: 1 },
        { key: 'depth', label: 'Depth', unit: 'mm', min: 10, max: 40, step: 1 },
        { key: 'height', label: 'Height', unit: 'mm', min: 12, max: 40, step: 1 },
      ],
    },
  ],
  defaults: { count: 5, cable: 6, pitch: 14, depth: 20, height: 18 },
  parts: {
    organizer: {
      label: 'Organizer',
      views: { organizer: true },
      export: { name: 'cable-organizer' },
      build: (k, p) => {
        const pitch = Math.max(p.pitch, p.cable + 3);
        const W = p.count * pitch + 4;
        let s = k.box({ min: [0, 0, 0], max: [W, p.depth, p.height] }).label('body');
        for (let i = 0; i < p.count; i++) {
          const x = 2 + pitch * (i + 0.5);
          const z = p.height - p.cable / 2 - 2;
          s = s.cut(k.cylinder({ d: p.cable, h: p.depth + 2, center: true }).along('+Y').at([x, p.depth / 2, z]).label('slot'));
          s = s.cut(k.box({ min: [x - p.cable * 0.35, -1, z], max: [x + p.cable * 0.35, p.depth + 1, p.height + 1] }).label('slot'));
        }
        return s;
      },
    },
  },
  views: { organizer: { label: 'Organizer' } },
  verify: { process: 'fdm-pla', accept: ['supports'], expect: { organizer: { watertight: true } } },
};
