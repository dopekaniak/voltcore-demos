import type { ForgeReport } from '../types';
export interface DfmProfile { key: string; label: string; bed: number[]; minWall: number; overhangDeg: number; process: Record<string, unknown> }
export const DFM_PROFILES: Record<'fdm-0.4mm-nozzle', DfmProfile>;
export const DEFAULT_PROFILE: 'fdm-0.4mm-nozzle';
export function defaultView(part: unknown): string;
export function subpartsFor(part: unknown, view: string, params?: Record<string, unknown>): string[];
export function inspectPart(kernel: unknown, part: unknown, params?: Record<string, unknown>, profileKey?: string | DfmProfile): ForgeReport;
export function summarize(m: unknown, v: unknown, profile: DfmProfile, verifyError?: string | null): ForgeReport;
export function mergeBinaryStl(buffers: Uint8Array[]): Uint8Array;
export interface FeatureBoxRow {
  key: string;
  part: string | null;
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
}
export function featureBoxes(kernel: unknown, part: unknown, features: Record<string, unknown>, featureParts: Record<string, string | null>, params?: Record<string, unknown>): FeatureBoxRow[];
