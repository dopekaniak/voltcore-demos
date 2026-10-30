/**
 * Export terms (Module 6 rules 5 and 7). People own what they design. Paid plans include
 * commercial use of designs and prints; the free plan is personal use only. Every export
 * stores a snapshot of these terms. The wording is a draft for counsel.
 */
export const TERMS_VERSION = 'terms-draft-2026-10';
export type ExportFormat = 'stl' | '3mf' | 'step';

export function planExportFormats(planCode: string): ExportFormat[] {
  if (planCode === 'studio') return ['stl', '3mf', 'step'];
  if (planCode === 'free') return ['stl'];
  return ['stl', '3mf'];
}

export const isPaidPlan = (planCode: string) => planCode !== 'free';

export interface LicenseSnapshot {
  terms_version: string;
  plan_code: string;
  ownership: string;
  personal_use: true;
  /** Present only on paid plans. */
  commercial_use_terms?: string;
  model_license: { code: string; name: string } | null;
  is_test_section: boolean;
  exported_at: string;
}

export function exportLicenseSnapshot(a: { planCode: string; modelLicense: { code: string; name: string } | null; isTestSection?: boolean; at: Date }): LicenseSnapshot {
  return {
    terms_version: TERMS_VERSION,
    plan_code: a.planCode,
    ownership: 'You own the designs you make. Shapewright claims no ownership of them.',
    personal_use: true,
    ...(isPaidPlan(a.planCode) ? { commercial_use_terms: 'Your plan includes commercial use: you may sell this design and prints made from it, subject to the model license below.' } : {}),
    model_license: a.modelLicense,
    is_test_section: Boolean(a.isTestSection),
    exported_at: a.at.toISOString(),
  };
}
