import type { Db } from '@sw/db';

export interface ForgeCosts {
  author: number;
  step_export: number;
}

/** Forge credit costs come from seed data (FeatureFlag `forge.costs`), not code. */
export async function forgeCosts(db: Db): Promise<ForgeCosts> {
  const f = await db.featureFlag.findUnique({ where: { key: 'forge.costs' } });
  const d = (f?.data ?? {}) as Partial<ForgeCosts>;
  return { author: d.author ?? 10, step_export: d.step_export ?? 2 };
}

export const FORGE_BUILD_TIMEOUT_MS = 10 * 60_000;
export const FORGE_EXPORT_TIMEOUT_MS = 10 * 60_000;
