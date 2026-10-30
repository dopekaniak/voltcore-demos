// Modular storage tile — a grid of square bins on a base plate.
// Original Shapewright starter customizer. MIT License.
export default {
  meta: { title: 'Storage tile', units: 'mm' },
  parameters: [
    {
      id: 'grid',
      title: 'Grid',
      controls: [
        { key: 'cols', label: 'Columns', min: 1, max: 6, step: 1 },
        { key: 'rows', label: 'Rows', min: 1, max: 6, step: 1 },
        { key: 'cell', label: 'Cell size', unit: 'mm', min: 20, max: 60, step: 1 },
        { key: 'depth', label: 'Bin depth', unit: 'mm', min: 10, max: 60, step: 1 },
        { key: 'wall', label: 'Wall', unit: 'mm', min: 1.2, max: 4, step: 0.1 },
      ],
    },
  ],
  defaults: { cols: 3, rows: 2, cell: 30, depth: 20, wall: 1.6 },
  parts: {
    tile: {
      label: 'Tile',
      views: { tile: true },
      export: { name: 'storage-tile' },
      build: (k, p) => {
        const W = p.cols * (p.cell + p.wall) + p.wall;
        const D = p.rows * (p.cell + p.wall) + p.wall;
        let s = k.box({ min: [0, 0, 0], max: [W, D, p.depth + p.wall] }).label('frame');
        for (let i = 0; i < p.cols; i++) {
          for (let j = 0; j < p.rows; j++) {
            const x = p.wall + i * (p.cell + p.wall);
            const y = p.wall + j * (p.cell + p.wall);
            s = s.cut(k.box({ min: [x, y, p.wall], max: [x + p.cell, y + p.cell, p.depth + p.wall + 1] }).label('bin'));
          }
        }
        return s;
      },
    },
  },
  views: { tile: { label: 'Tile' } },
  verify: { process: 'fdm-pla', expect: { tile: { watertight: true } } },
};
