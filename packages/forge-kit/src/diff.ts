import { analyzeFeatures } from './features';
import type { ParamSchema, ParamValues } from './contract';

export interface DiffLine {
  op: '-' | '+';
  text: string;
}

/** Changed lines between two short texts (LCS over lines); unchanged lines are dropped. */
export function lineDiff(a: string, b: string, max = 40): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  if (n * m > 250_000) return [{ op: '-', text: `(${n} lines)` }, { op: '+', text: `(${m} lines)` }];
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = x[i] === y[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      i++;
      j++;
    } else if (j < m && (i >= n || L[i]![j + 1]! >= L[i + 1]![j]!)) out.push({ op: '+', text: y[j++]!.trim() });
    else out.push({ op: '-', text: x[i++]!.trim() });
  }
  return out.slice(0, max);
}

export interface EditDiff {
  params: { key: string; label: string; from: unknown; to: unknown }[];
  features: { key: string; change: 'changed' | 'added' | 'removed'; lines: DiffLine[] }[];
  bbox: { from: number[] | null; to: number[] };
  code_changed: boolean;
}

/** What a copilot edit changes: parameter values, feature builders, and the overall size. */
export function editDiff(a: {
  oldCode: string;
  newCode: string;
  oldParams: ParamValues;
  newParams: ParamValues;
  newSchema: ParamSchema;
  oldBbox: number[] | null;
  newBbox: number[];
}): EditDiff {
  const params: EditDiff['params'] = [];
  for (const [key, spec] of Object.entries(a.newSchema)) {
    if (JSON.stringify(a.oldParams[key]) !== JSON.stringify(a.newParams[key])) params.push({ key, label: spec.label, from: a.oldParams[key] ?? null, to: a.newParams[key] ?? null });
  }
  const before = new Map(analyzeFeatures(a.oldCode).features.map((f) => [f.key, a.oldCode.slice(f.range[0], f.range[1])]));
  const after = new Map(analyzeFeatures(a.newCode).features.map((f) => [f.key, a.newCode.slice(f.range[0], f.range[1])]));
  const features: EditDiff['features'] = [];
  for (const [key, src] of after) {
    const old = before.get(key);
    if (old === undefined) features.push({ key, change: 'added', lines: lineDiff('', src) });
    else if (old !== src) features.push({ key, change: 'changed', lines: lineDiff(old, src) });
  }
  for (const key of before.keys()) if (!after.has(key)) features.push({ key, change: 'removed', lines: [] });
  return { params, features, bbox: { from: a.oldBbox, to: a.newBbox }, code_changed: a.oldCode !== a.newCode };
}
