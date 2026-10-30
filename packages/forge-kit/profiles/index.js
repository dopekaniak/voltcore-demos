// Printer profiles (Module 6, section 4). Bed sizes come from each manufacturer's published
// specification; sources and retrieval dates are in README.md and on each row. Model names
// are plain-text compatibility labels only.
export const PRINTER_PROFILES = [
  {
    key: 'generic-fdm',
    name: 'Generic FDM (enter your bed size)',
    bed_mm: [220, 220, 250],
    nozzle_mm: 0.4,
    validated_materials: ['PLA', 'PETG'],
    overhang_default_deg: 45,
    wall_min_mm: 1.2,
    source_url: null,
    retrieved_on: null,
    is_generic: true,
  },
  {
    key: 'prusa-mk4s',
    name: 'Original Prusa MK4S',
    bed_mm: [250, 210, 220],
    nozzle_mm: 0.4,
    validated_materials: ['PLA', 'PETG'],
    overhang_default_deg: 45,
    wall_min_mm: 1.2,
    source_url: 'https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer-5/',
    retrieved_on: '2026-10-30',
    is_generic: false,
  },
  {
    key: 'prusa-mini-plus',
    name: 'Original Prusa MINI+',
    bed_mm: [180, 180, 180],
    nozzle_mm: 0.4,
    validated_materials: ['PLA', 'PETG'],
    overhang_default_deg: 45,
    wall_min_mm: 1.2,
    source_url: 'https://www.prusa3d.com/product/original-prusa-mini-semi-assembled-3d-printer-enclosure-bundle-5/',
    retrieved_on: '2026-10-30',
    is_generic: false,
  },
];

/** A DFM profile object for the forge checks from a printer profile row (and a custom bed). */
export function dfmFromPrinter(p, customBed) {
  const bed = p.is_generic && Array.isArray(customBed) && customBed.length === 3 ? customBed : p.bed_mm;
  return {
    key: p.key,
    label: p.name,
    bed,
    minWall: p.wall_min_mm,
    overhangDeg: p.overhang_default_deg,
    process: { base: 'fdm-pla', bed, minWall: p.wall_min_mm },
  };
}
