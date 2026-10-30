export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface ForgeCheck {
  id: string;
  status: CheckStatus;
  title: string;
  message: string;
  measured?: number | number[];
  limit?: number | number[];
  subpart?: string;
  /** Where in the model (mm) the reading was taken, for a viewer highlight. */
  location?: number[];
  /** Estimates carry ESTIMATE_NOT_CERTIFIED (a warning code, never a blocker). */
  code?: string;
}

export interface ForgeSubpartSummary {
  name: string;
  bbox: number[];
  volumeMm3: number;
  surfaceAreaMm2: number;
  triangles: number;
  watertight: boolean;
  minWall: number | null;
  minWallAt?: number[] | null;
  overhangAreaMm2: number;
  overhangPct?: number;
  overhangAt?: number[] | null;
  centerOfMass?: number[] | null;
  bounds?: { min: number[]; max: number[] } | null;
}

export interface ForgeReport {
  view: string;
  profile: string;
  bbox: number[];
  subparts: ForgeSubpartSummary[];
  checks: ForgeCheck[];
  /** No failing checks. */
  ok: boolean;
  verifyOk: boolean;
}
