import { AppError } from './errors';

/**
 * Licenses are data, and safety classes are enforced on the server (addendum Module 4/5,
 * rules 2 and 3). Every path that can lead to a print order or a publish calls these.
 */
export type SafetyClass = 'NONE' | 'COSMETIC' | 'ENCLOSURE' | 'SAFETY_CRITICAL';
export const PRINTABLE_SAFETY_CLASSES: readonly SafetyClass[] = ['NONE', 'COSMETIC', 'ENCLOSURE'];

export interface LicenseFacts {
  code: string;
  allowsCommercial: boolean;
  allowsDerivatives: boolean;
  allowsPrintOrder: boolean;
}

export const SAFETY_WARNING =
  'This part is classed as safety-critical (for example brakes, steering, suspension, restraints, or fuel system parts). It is not available for printing on this platform. Printed plastic parts must never be used in these systems.';

export const FIT_DISCLAIMER = 'Printed parts are not OEM and may differ in fit and finish. Check fit before installing.';

/** Throws PART_NOT_PRINTABLE or LICENSE_FORBIDS_PRINT; returns when a print order is allowed. */
export function assertPrintOrderAllowed(p: { safetyClass: SafetyClass; printOrderAllowed: boolean; license: LicenseFacts | null }): void {
  if (!PRINTABLE_SAFETY_CLASSES.includes(p.safetyClass)) {
    throw new AppError('PART_NOT_PRINTABLE', 'This part is safety-critical and cannot be printed or ordered.', { safety_class: p.safetyClass });
  }
  if (!p.license) throw new AppError('LICENSE_MISSING', 'This part has no license.');
  if (!p.license.allowsPrintOrder) {
    throw new AppError('LICENSE_FORBIDS_PRINT', p.license.allowsCommercial ? 'The license does not allow print orders.' : 'non-commercial license', { license: p.license.code });
  }
  if (!p.printOrderAllowed) throw new AppError('PART_NOT_PRINTABLE', 'The owner has not enabled print orders for this part.');
}

/** A model or part can only move to REVIEW/LIVE with a valid license. */
export function assertLicensed(license: LicenseFacts | null): void {
  if (!license) throw new AppError('LICENSE_MISSING', 'Add a license before publishing.');
}

export function assertDerivativeAllowed(license: LicenseFacts | null): void {
  if (!license || !license.allowsDerivatives) {
    throw new AppError('LICENSE_FORBIDS_DERIVATIVE', 'The license of the original does not allow derivatives.', { license: license?.code ?? null });
  }
}

export function renderAttribution(template: string, v: { title: string; author: string; url?: string }): string {
  return template.replaceAll('{title}', v.title).replaceAll('{author}', v.author).replaceAll('{url}', v.url ?? '');
}
