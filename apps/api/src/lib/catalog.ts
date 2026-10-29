import { AppError, assertPrintOrderAllowed, FIT_DISCLAIMER, renderAttribution, SAFETY_WARNING, toApiId, type LicenseFacts, type SafetyClass } from '@sw/shared';
import type { Db, LicenseTerms, ModelLicense, Part } from '@sw/db';

const SAFETY_TERMS = /\b(brake|brakes|brake line|caliper|steering|tie rod|suspension|control arm|strut|wheel (hub|nut|stud|spacer)|lug|seat ?belt|anchorage|airbag|restraint|fuel (line|tank|rail|pump|filter)|tow (hook|hitch)|crash)\b/i;

/** Owners may propose a class; anything that reads like a safety system is forced to SAFETY_CRITICAL. */
export function classify(proposed: SafetyClass, text: string): SafetyClass {
  return SAFETY_TERMS.test(text) ? 'SAFETY_CRITICAL' : proposed;
}

export function licenseFacts(l: LicenseTerms | null): LicenseFacts | null {
  return l ? { code: l.code, allowsCommercial: l.allowsCommercial, allowsDerivatives: l.allowsDerivatives, allowsPrintOrder: l.allowsPrintOrder } : null;
}

export function licenseBlock(l: LicenseTerms, ml: ModelLicense | null, v: { title: string; author: string }) {
  return {
    code: l.code,
    name: l.name,
    attribution: ml?.attributionText || renderAttribution(l.attributionTemplate, v),
    allows_print_order: l.allowsPrintOrder,
    allows_derivatives: l.allowsDerivatives,
    allows_commercial: l.allowsCommercial,
  };
}

export function printStatus(p: Part, l: LicenseTerms | null): { orderable: boolean; reason: string | null } {
  try {
    assertPrintOrderAllowed({ safetyClass: p.safetyClass, printOrderAllowed: p.printOrderAllowed, license: licenseFacts(l) });
    return { orderable: true, reason: null };
  } catch (e) {
    return { orderable: false, reason: (e as Error).message };
  }
}

export async function serializeCatalogPart(db: Db, p: Part, viewerId: string | null) {
  const l = p.licenseId ? await db.licenseTerms.findUnique({ where: { id: p.licenseId } }) : null;
  const ml = p.assetId ? await db.modelLicense.findUnique({ where: { assetId: p.assetId } }) : null;
  const owner = await db.user.findUnique({ where: { id: p.ownerId }, select: { name: true, email: true } });
  return {
    id: toApiId('catalogPart', p.id),
    title: p.title,
    description: p.description,
    category: p.category,
    part_number_text: p.partNumberText,
    safety_class: p.safetyClass,
    status: p.status,
    license: l ? licenseBlock(l, ml, { title: p.title, author: owner?.name ?? 'a Shapewright creator' }) : null,
    asset_id: p.assetId ? toApiId('asset', p.assetId) : null,
    print: { ...printStatus(p, l), allowed_materials: p.allowedMaterials },
    safety_warning: p.safetyClass === 'SAFETY_CRITICAL' ? SAFETY_WARNING : null,
    fit_disclaimer: FIT_DISCLAIMER,
    is_owner: viewerId === p.ownerId,
  };
}

/** Server-side gate for anything printed from the catalog (cart, checkout, routing). */
export async function assertCatalogPrintable(db: Db, catalogPartId: string | null, fitAcknowledgedAt: Date | null): Promise<void> {
  if (!catalogPartId) return;
  const p = await db.part.findUnique({ where: { id: catalogPartId } });
  if (!p) throw new AppError('PART_NOT_PRINTABLE', 'The catalog part no longer exists');
  const l = p.licenseId ? await db.licenseTerms.findUnique({ where: { id: p.licenseId } }) : null;
  assertPrintOrderAllowed({ safetyClass: p.safetyClass, printOrderAllowed: p.printOrderAllowed, license: licenseFacts(l) });
  if (!fitAcknowledgedAt) throw new AppError('FIT_DISCLAIMER_REQUIRED', 'Acknowledge the fit disclaimer first');
}

/** Assets referenced by a safety-critical catalog part cannot be printed by another route. */
export async function assertAssetNotSafetyCritical(db: Db, assetId: string): Promise<void> {
  const critical = await db.part.findFirst({ where: { assetId, safetyClass: 'SAFETY_CRITICAL' } });
  if (critical) throw new AppError('PART_NOT_PRINTABLE', 'This model is a safety-critical part and cannot be printed.');
}
