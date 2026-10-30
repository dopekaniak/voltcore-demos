/**
 * Engineering estimates (Module 6, section 5). Simple textbook formulas with their
 * assumptions spelled out. They are estimates, not certified load tests, and never say a
 * part is safe or will hold a load.
 */
export const ESTIMATE_LABEL = 'Estimate, not a certified load test.';
export const ESTIMATE_CODE = 'ESTIMATE_NOT_CERTIFIED';

export interface Estimate {
  code: typeof ESTIMATE_CODE;
  label: typeof ESTIMATE_LABEL;
  title: string;
  formula: string;
  inputs: Record<string, number | string>;
  assumptions: string[];
  value: number;
  unit: string;
  summary: string;
}

type P2 = [number, number];

/** Convex hull of the vertices within `zTol` of the lowest point (the base on the bed). */
export function baseFootprint(positions: ArrayLike<number>, zTol = 0.5): P2[] {
  let zmin = Infinity;
  for (let i = 2; i < positions.length; i += 3) zmin = Math.min(zmin, positions[i]!);
  const pts: P2[] = [];
  const seen = new Set<string>();
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (positions[i + 2]! > zmin + zTol) continue;
    const p: P2 = [Math.round(positions[i]! * 100) / 100, Math.round(positions[i + 1]! * 100) / 100];
    const k = `${p[0]},${p[1]}`;
    if (!seen.has(k)) {
      seen.add(k);
      pts.push(p);
    }
  }
  return convexHull(pts);
}

export function convexHull(points: P2[]): P2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function inside(hull: P2[], q: P2): boolean {
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) < 0) return false;
  }
  return true;
}

function distToEdges(hull: P2[], q: P2): number {
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy)));
  }
  return best;
}

/**
 * Tip-over: how far the standing part can lean before its centre of mass passes the edge
 * of its base. θ = atan(d / h), with d the shortest distance from the centre of mass (seen
 * from above) to the base outline and h its height above the bed.
 */
export function tipOverEstimate(a: { centerOfMass: number[]; footprint: P2[]; bedZ?: number }): Estimate {
  const com = a.centerOfMass;
  const h = Math.max(1e-6, com[2]! - (a.bedZ ?? 0));
  const q: P2 = [com[0]!, com[1]!];
  const ok = a.footprint.length >= 3 && inside(a.footprint, q);
  const d = ok ? distToEdges(a.footprint, q) : 0;
  const deg = Math.round(((Math.atan(d / h) * 180) / Math.PI) * 10) / 10;
  return {
    code: ESTIMATE_CODE,
    label: ESTIMATE_LABEL,
    title: 'Tip-over angle',
    formula: 'θ = atan(d / h)',
    inputs: { d_mm: Math.round(d * 10) / 10, h_mm: Math.round(h * 10) / 10 },
    assumptions: [
      'Uniform, fully solid material (infill changes the centre of mass little for most parts).',
      'The base is the outline of the part where it touches the bed.',
      'Standing on a flat, level surface with nothing attached or inside it.',
    ],
    value: deg,
    unit: '°',
    summary: ok ? `Tips over when tilted about ${deg}° toward its nearest base edge.` : 'The centre of mass is outside the base: it would not stand on its own.',
  };
}

export const MATERIAL_STRENGTH_MPA: Record<string, number> = { PLA: 50, PETG: 45 };

/**
 * Bending stress in a feature treated as a rectangular cantilever with the load at its free
 * end: σ = 6 F L / (b t²). L is the feature's longest extent, b the middle, t the smallest.
 * The ratio compares σ with the material's nominal strength halved for layer adhesion.
 */
export function bendingEstimate(a: { feature: string; size: number[]; loadN: number; material: string }): Estimate {
  const [t, b, L] = [...a.size].map((x) => Math.max(x, 1e-3)).sort((x, y) => x - y) as [number, number, number];
  const sigma = (6 * a.loadN * L) / (b * t * t);
  const strength = MATERIAL_STRENGTH_MPA[a.material] ?? MATERIAL_STRENGTH_MPA.PLA!;
  const allowable = strength * 0.5;
  const ratio = Math.round((sigma / allowable) * 100) / 100;
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    code: ESTIMATE_CODE,
    label: ESTIMATE_LABEL,
    title: `Bending stress in ${a.feature.replace(/_/g, ' ')}`,
    formula: 'σ = 6 F L / (b t²)',
    inputs: { F_N: a.loadN, L_mm: r(L), b_mm: r(b), t_mm: r(t), material: a.material, nominal_strength_MPa: strength },
    assumptions: [
      'The feature is a solid rectangular beam fixed at one end, with the load at the other end.',
      `Its size is the feature's bounding box: length ${r(L)} mm, width ${r(b)} mm, thickness ${r(t)} mm.`,
      'Strength is halved for loads that pull layers apart; real prints vary with settings, infill, and temperature.',
    ],
    value: r(sigma),
    unit: 'MPa',
    summary: `About ${r(sigma)} MPa, ${ratio}× the reduced ${a.material} strength of ${allowable} MPa used here.`,
  };
}
