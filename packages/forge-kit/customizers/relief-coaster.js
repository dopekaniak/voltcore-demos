// Relief coaster — a round coaster with a raised relief made from an uploaded image.
// Original Shapewright starter customizer. MIT License.
// The platform replaces the RELIEF literal with a height map computed from the user's
// image (grayscale, resized to a fixed grid) before building. With no image, a ripple
// pattern is used.
const RELIEF = /*__SW_RELIEF__*/ null;

export default {
  meta: { title: 'Relief coaster', units: 'mm' },
  parameters: [
    {
      id: 'coaster',
      title: 'Coaster',
      controls: [
        { key: 'diameter', label: 'Diameter', unit: 'mm', min: 70, max: 120, step: 1 },
        { key: 'base', label: 'Base thickness', unit: 'mm', min: 2, max: 6, step: 0.2 },
        { key: 'relief', label: 'Relief height', unit: 'mm', min: 0.4, max: 3, step: 0.1 },
        { key: 'invert', type: 'checkbox', label: 'Invert (dark is high)', on: 1 },
      ],
    },
  ],
  defaults: { diameter: 95, base: 3, relief: 1.2, invert: 0 },
  parts: {
    coaster: {
      label: 'Coaster',
      views: { coaster: true },
      export: { name: 'relief-coaster' },
      build: (k, p) => {
        const n = 48;
        let grid = RELIEF;
        if (!grid) {
          const data = [];
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data.push(Math.round(32767 * (1 + Math.cos(Math.hypot(x - n / 2, y - n / 2) / 4))));
          grid = { width: n, height: n, data };
        }
        const side = p.diameter * 0.62;
        const relief = k
          .heightfield({ width: grid.width, height: grid.height, data: new Uint16Array(grid.data) }, { w: side, d: side, base: 0.01, maxZ: p.relief, invert: Boolean(p.invert), origin: 'center' })
          .translate([0, 0, p.base - 0.01]);
        const disc = k.cylinder({ d: p.diameter, h: p.base }).label('base');
        const rim = k.cylinder({ d: p.diameter, h: p.base + p.relief }).cut(k.cylinder({ d: p.diameter - 4, h: p.base + p.relief + 2 }).at([0, 0, -1])).label('rim');
        return disc.union(rim).union(relief.label('relief'));
      },
    },
  },
  views: { coaster: { label: 'Coaster' } },
  verify: { process: 'fdm-pla', expect: { coaster: { watertight: true } } },
};
