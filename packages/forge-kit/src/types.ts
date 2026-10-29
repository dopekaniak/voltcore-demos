export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface ForgeCheck {
  id: string;
  status: CheckStatus;
  title: string;
  message: string;
  measured?: number | number[];
  limit?: number | number[];
  subpart?: string;
}

export interface ForgeSubpartSummary {
  name: string;
  bbox: number[];
  volumeMm3: number;
  surfaceAreaMm2: number;
  triangles: number;
  watertight: boolean;
  minWall: number | null;
  overhangAreaMm2: number;
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
