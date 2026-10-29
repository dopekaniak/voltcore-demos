import type { ForgeReport } from '../types';
export interface DfmProfile { key: string; label: string; bed: [number, number, number]; minWall: number; overhangDeg: number; process: Record<string, unknown> }
export const DFM_PROFILES: Record<'fdm-0.4mm-nozzle', DfmProfile>;
export const DEFAULT_PROFILE: 'fdm-0.4mm-nozzle';
export function defaultView(part: unknown): string;
export function subpartsFor(part: unknown, view: string, params?: Record<string, unknown>): string[];
export function inspectPart(kernel: unknown, part: unknown, params?: Record<string, unknown>, profileKey?: string): ForgeReport;
export function summarize(m: unknown, v: unknown, profile: DfmProfile, verifyError?: string | null): ForgeReport;
export function mergeBinaryStl(buffers: Uint8Array[]): Uint8Array;
