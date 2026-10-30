// Shared forge runtime helpers. Plain JavaScript so the sandboxed Node child process and
// the browser Web Worker load the exact same code with no build step. DOM-free, node:-free.
import { measure as pfMeasure, verify as pfVerify } from 'partforge/oracle';
import { resolveDerived } from 'partforge/derive';

/** DFM profiles (ADR-007). The partforge `process` object is applied on top of the part's verify block. */
export const DFM_PROFILES = {
  'fdm-0.4mm-nozzle': {
    key: 'fdm-0.4mm-nozzle',
    label: 'FDM, 0.4 mm nozzle',
    bed: [220, 220, 250],
    minWall: 1.2,
    overhangDeg: 45,
    process: { base: 'fdm-pla', bed: [220, 220, 250], minWall: 1.2 },
  },
};
export const DEFAULT_PROFILE = 'fdm-0.4mm-nozzle';

const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => (Number.isFinite(n) ? r1(n).toString() : String(n));

function viewsOf(sub) {
  if (Array.isArray(sub.views)) return sub.views;
  return Object.keys(sub.views ?? {});
}

/** The first view key, which headless measure/verify use. */
export function defaultView(part) {
  return Object.keys(part.views ?? {})[0];
}

/** Sub-parts shown in a view at these params, in definition order. */
export function subpartsFor(part, view, params) {
  const p = { ...(part.defaults ?? {}), ...(params ?? {}) };
  return Object.entries(part.parts ?? {})
    .filter(([, sub]) => viewsOf(sub).includes(view) && (typeof sub.enabled !== 'function' || sub.enabled(p)))
    .map(([name]) => name);
}

/**
 * Run measure + verify at the given params under a DFM profile, and turn the result into
 * plain-language check rows. Verify runs a single case at the current params: the part's
 * defaults are replaced by the resolved params and its presets are not expanded.
 */
export function inspectPart(kernel, part, params = {}, profileKey = DEFAULT_PROFILE) {
  // A profile key, or a profile object built from a printer profile (dfmFromPrinter).
  const profile = profileKey && typeof profileKey === 'object' ? profileKey : (DFM_PROFILES[profileKey] ?? DFM_PROFILES[DEFAULT_PROFILE]);
  const view = defaultView(part);
  const resolved = { ...(part.defaults ?? {}), ...params };
  const atParams = {
    ...part,
    defaults: resolved,
    verify: { ...(part.verify ?? {}), process: profile.process, cases: ['defaults'] },
  };
  const m = pfMeasure(kernel, atParams, view, {}, { minWall: true, gaps: false, overhang: profile.overhangDeg });
  let v = null;
  let verifyError = null;
  try {
    v = pfVerify(kernel, atParams, { view, measureFn: pfMeasure, seed: { params: {}, result: m } });
  } catch (e) {
    verifyError = String(e?.message ?? e);
  }
  return summarize(m, v, profile, verifyError);
}

export function summarize(m, v, profile, verifyError = null) {
  const subparts = (m.subparts ?? []).map((s) => ({
    name: s.name,
    bbox: s.bbox.map(r1),
    volumeMm3: Math.round(s.volume ?? 0),
    surfaceAreaMm2: Math.round(s.surfaceArea ?? 0),
    triangles: s.triangleCount ?? 0,
    watertight: s.watertight !== false,
    minWall: s.minWall ?? null,
    minWallAt: s.minWallAt ? s.minWallAt.map(r1) : null,
    overhangAreaMm2: Math.round(s.overhangArea ?? 0),
    overhangPct: s.surfaceArea ? Math.round(((s.overhangArea ?? 0) / s.surfaceArea) * 1000) / 10 : 0,
    overhangAt: s.overhangAt ? s.overhangAt.map(r1) : null,
    centerOfMass: s.centerOfMass ? s.centerOfMass.map(r1) : null,
    bounds: s.bounds ? { min: s.bounds.min.map(r1), max: s.bounds.max.map(r1) } : null,
  }));
  const bounds = unionBounds(m.subparts ?? []);
  const bbox = bounds ? bounds.max.map((x, i) => r1(x - bounds.min[i])) : [0, 0, 0];
  const checks = [];

  // Bed fit: the whole view must fit the profile's bed.
  const fits = bbox.every((x, i) => x <= profile.bed[i] + 1e-6);
  checks.push({
    id: 'bed-fit',
    status: fits ? 'pass' : 'fail',
    title: 'Fits the print bed',
    message: fits
      ? `Part is ${bbox.map(fmt).join(' × ')} mm; the bed is ${profile.bed.join(' × ')} mm.`
      : `Part is ${bbox.map(fmt).join(' × ')} mm, larger than the ${profile.bed.join(' × ')} mm bed.`,
    measured: bbox,
    limit: profile.bed,
  });

  for (const s of subparts) {
    checks.push({
      id: `watertight:${s.name}`,
      status: s.watertight ? 'pass' : 'fail',
      title: `${s.name}: closed, manifold mesh`,
      message: s.watertight ? 'The mesh is closed and manifold.' : 'The mesh has holes or non-manifold edges and may not slice.',
      subpart: s.name,
    });
    if (s.minWall !== null) {
      const ok = s.minWall >= profile.minWall - 1e-6;
      checks.push({
        id: `min-wall:${s.name}`,
        status: ok ? 'pass' : 'fail',
        title: `${s.name}: wall thickness`,
        message: ok
          ? `Thinnest wall is ${fmt(s.minWall)} mm; the printer minimum is ${profile.minWall} mm.`
          : `Wall is ${fmt(s.minWall)} mm; the printer minimum is ${profile.minWall} mm.`,
        measured: r1(s.minWall),
        limit: profile.minWall,
        subpart: s.name,
        ...(s.minWallAt ? { location: s.minWallAt } : {}),
      });
    }
    // Overhangs never block: they need supports, which the printer adds.
    const over = s.overhangPct > 0.5;
    checks.push({
      id: `overhang:${s.name}`,
      status: over ? 'warn' : 'pass',
      title: `${s.name}: overhangs`,
      message: over
        ? `${fmt(s.overhangPct)}% of the surface (${s.overhangAreaMm2} mm²) is steeper than ${profile.overhangDeg}° and needs supports.`
        : s.overhangPct > 0
          ? `${fmt(s.overhangPct)}% of the surface is steeper than ${profile.overhangDeg}°, small enough to print without supports.`
          : `No surface is steeper than ${profile.overhangDeg}°; no supports needed.`,
      measured: s.overhangPct,
      limit: profile.overhangDeg,
      subpart: s.name,
      ...(over && s.overhangAt ? { location: s.overhangAt } : {}),
    });
  }

  // The part's own verify block: gates fail, warnings warn, unaccepted costs warn.
  if (verifyError) {
    checks.push({ id: 'verify', status: 'fail', title: 'Design checks', message: `Checks could not run: ${verifyError}` });
  }
  for (const c of v?.cases?.[0]?.checks ?? []) {
    if (c.metric === 'bbox' && c.scope === 'view') continue; // covered by bed-fit
    if (c.metric === 'minWall' || c.metric === 'watertight' || c.metric === 'overhangArea') continue; // covered above
    if (c.status === 'pass' || c.status === 'skip') {
      if (c.kind === 'gate' && c.status === 'pass') {
        checks.push({ id: `verify:${c.subpart ?? 'view'}:${c.metric}`, status: 'pass', title: titleFor(c), message: passMessage(c), subpart: c.subpart ?? undefined });
      }
      continue;
    }
    let status = 'warn';
    if (c.status === 'fail' && c.kind === 'gate') status = 'fail';
    if (c.status === 'cost' && c.accepted) continue;
    checks.push({
      id: `verify:${c.subpart ?? 'view'}:${c.metric}`,
      status,
      title: titleFor(c),
      message: plainMessage(c, profile),
      subpart: c.subpart ?? undefined,
    });
  }

  const failing = checks.filter((c) => c.status === 'fail').length;
  return {
    view: m.view,
    profile: profile.key,
    bbox,
    subparts,
    checks,
    ok: failing === 0,
    verifyOk: v ? v.ok : false,
  };
}

function titleFor(c) {
  const who = c.subpart ? `${c.subpart}: ` : '';
  const names = {
    overhangArea: 'overhangs',
    bedContactPct: 'first-layer contact',
    footprintPct: 'footprint',
    holes: 'hole count',
    watertight: 'closed mesh',
    overlaps: 'pieces overlap',
    volume: 'volume',
    bbox: 'size',
  };
  return who + (names[c.metric] ?? c.metric);
}

function passMessage(c) {
  switch (c.metric) {
    case 'bedContactPct':
      return 'The flat underside sits on the bed.';
    case 'overlaps':
      return 'No pieces overlap.';
    case 'holes':
      return `Has the expected ${c.actual} through-hole${c.actual === 1 ? '' : 's'}.`;
    default:
      return `Meets the design check (${c.message}).`;
  }
}

function plainMessage(c, profile) {
  const a = typeof c.actual === 'number' ? fmt(c.actual) : JSON.stringify(c.actual);
  switch (c.metric) {
    case 'overhangArea':
      return `${a} mm² of surface is steeper than ${profile.overhangDeg}° and will need supports.`;
    case 'bedContactPct':
      return `Only ${a}% of the flat underside touches the bed; the first layer may print in mid-air.`;
    case 'footprintPct':
      return `Only ${a}% of the outline touches the bed; consider a brim.`;
    case 'overlaps':
      return `${a} pairs of pieces overlap.`;
    default:
      return c.message;
  }
}

function unionBounds(subs) {
  let min = null;
  let max = null;
  for (const s of subs) {
    if (!s.bounds) continue;
    min = min ? min.map((v, i) => Math.min(v, s.bounds.min[i])) : [...s.bounds.min];
    max = max ? max.map((v, i) => Math.max(v, s.bounds.max[i])) : [...s.bounds.max];
  }
  return min && max ? { min, max } : null;
}

/** Merge several binary STL buffers into one binary STL. */
export function mergeBinaryStl(buffers) {
  let tris = 0;
  for (const b of buffers) tris += new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true);
  const out = new Uint8Array(84 + tris * 50);
  const header = new TextEncoder().encode('Shapewright forge export');
  out.set(header.subarray(0, 80), 0);
  new DataView(out.buffer).setUint32(80, tris, true);
  let off = 84;
  for (const b of buffers) {
    const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true);
    out.set(b.subarray(84, 84 + n * 50), off);
    off += n * 50;
  }
  return out;
}

/**
 * View-frame bounds of each named feature at the given params (ADR-038). A builder that
 * returns null (the feature is switched off) gets null bounds. The sub-part's view
 * placement is applied, so the bounds line up with the meshes the viewer shows.
 */
export function featureBoxes(kernel, part, features, featureParts, params = {}) {
  const view = defaultView(part);
  const p = { ...(part.defaults ?? {}), ...params };
  const d = resolveDerived(part, p);
  const out = [];
  for (const [key, fn] of Object.entries(features ?? {})) {
    if (typeof fn !== 'function') continue;
    let solid = fn(kernel, p, d);
    if (!solid) {
      out.push({ key, part: featureParts?.[key] ?? null, bbox: null });
      continue;
    }
    const sub = featureParts?.[key] ? part.parts?.[featureParts[key]] : null;
    const place = sub && !Array.isArray(sub.views) ? sub.views?.[view] : null;
    if (typeof place === 'function') solid = place(solid, p, d);
    const b = solid.boundingBox();
    const r3 = (n) => Math.round(n * 1000) / 1000;
    out.push({ key, part: featureParts?.[key] ?? null, bbox: { min: b.min.map(r3), max: b.max.map(r3) } });
  }
  return out;
}
