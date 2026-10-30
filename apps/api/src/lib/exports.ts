import type { FastifyRequest } from 'fastify';
import { AppError, exportLicenseSnapshot, planExportFormats, type ExportFormat } from '@sw/shared';
import type { Db, Prisma, Tx } from '@sw/db';

/** Format allowed on the caller's plan (STL free; 3MF paid; STEP on Studio, beta). */
export function assertFormatAllowed(req: FastifyRequest, format: ExportFormat): void {
  const allowed = planExportFormats(req.auth.planCode);
  if (!allowed.includes(format)) {
    throw new AppError('PAYMENT_REQUIRED', format === 'step' ? 'STEP export (beta) is on the Studio plan.' : `${format.toUpperCase()} export is on paid plans; the free plan exports STL.`, { allowed });
  }
}

export async function modelLicenseOf(db: Db | Tx, assetId: string, fallbackCode: string) {
  const ml = await db.modelLicense.findUnique({ where: { assetId }, include: { license: true } });
  if (ml) return { code: ml.license.code, name: ml.license.name };
  const l = await db.licenseTerms.findUnique({ where: { code: fallbackCode } });
  return l ? { code: l.code, name: l.name } : { code: fallbackCode, name: fallbackCode };
}

/** Store the plan and license terms of an export (Module 6 rule 5). */
export async function recordExport(
  tx: Tx,
  a: { req: FastifyRequest; ownerId: string; assetId: string; assetLicense: string; assetVersionId: string; format: string; isTestSection?: boolean; source?: 'server' | 'browser'; jobId?: string | null; now: Date },
) {
  const snapshot = exportLicenseSnapshot({ planCode: a.req.auth.planCode, modelLicense: await modelLicenseOf(tx, a.assetId, a.assetLicense), isTestSection: Boolean(a.isTestSection), at: a.now });
  return tx.exportRecord.create({
    data: {
      ownerId: a.ownerId,
      assetVersionId: a.assetVersionId,
      format: a.format,
      planCodeAtExport: a.req.auth.planCode,
      licenseSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      isTestSection: Boolean(a.isTestSection),
      source: a.source ?? 'server',
      jobId: a.jobId ?? null,
    },
  });
}
