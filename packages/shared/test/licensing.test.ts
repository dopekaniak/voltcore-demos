import { describe, expect, it } from 'vitest';
import { assertDerivativeAllowed, assertLicensed, assertPrintOrderAllowed, renderAttribution } from '../src/licensing';
import { canTransition, libraryItemMachine } from '../src/machines/index';

const by = { code: 'CC-BY-4.0', allowsCommercial: true, allowsDerivatives: true, allowsPrintOrder: true };
const nc = { code: 'CC-BY-NC-4.0', allowsCommercial: false, allowsDerivatives: true, allowsPrintOrder: false };
const nd = { code: 'CC-BY-ND-4.0', allowsCommercial: true, allowsDerivatives: false, allowsPrintOrder: true };

describe('print order gate', () => {
  it.each(['NONE', 'COSMETIC', 'ENCLOSURE'] as const)('allows %s parts with a permissive license', (sc) => {
    expect(() => assertPrintOrderAllowed({ safetyClass: sc, printOrderAllowed: true, license: by })).not.toThrow();
  });
  it('blocks SAFETY_CRITICAL even when everything else allows it', () => {
    expect(() => assertPrintOrderAllowed({ safetyClass: 'SAFETY_CRITICAL', printOrderAllowed: true, license: by })).toThrow(expect.objectContaining({ code: 'PART_NOT_PRINTABLE' }));
  });
  it('blocks non-commercial licenses with the reason "non-commercial license"', () => {
    expect(() => assertPrintOrderAllowed({ safetyClass: 'NONE', printOrderAllowed: true, license: nc })).toThrow(expect.objectContaining({ code: 'LICENSE_FORBIDS_PRINT', message: 'non-commercial license' }));
  });
  it('blocks parts without a license or with print orders off', () => {
    expect(() => assertPrintOrderAllowed({ safetyClass: 'NONE', printOrderAllowed: true, license: null })).toThrow(expect.objectContaining({ code: 'LICENSE_MISSING' }));
    expect(() => assertPrintOrderAllowed({ safetyClass: 'NONE', printOrderAllowed: false, license: by })).toThrow(expect.objectContaining({ code: 'PART_NOT_PRINTABLE' }));
  });
});

describe('publishing and derivatives', () => {
  it('a model with no license cannot be published', () => {
    expect(() => assertLicensed(null)).toThrow(expect.objectContaining({ code: 'LICENSE_MISSING' }));
    expect(() => assertLicensed(by)).not.toThrow();
  });
  it('no-derivative licenses refuse remixes', () => {
    expect(() => assertDerivativeAllowed(nd)).toThrow(expect.objectContaining({ code: 'LICENSE_FORBIDS_DERIVATIVE' }));
    expect(() => assertDerivativeAllowed(by)).not.toThrow();
  });
  it('library items move DRAFT → REVIEW → LIVE, never DRAFT → LIVE', () => {
    expect(canTransition(libraryItemMachine, 'DRAFT', 'LIVE')).toBe(false);
    expect(canTransition(libraryItemMachine, 'DRAFT', 'REVIEW')).toBe(true);
    expect(canTransition(libraryItemMachine, 'REVIEW', 'REJECTED')).toBe(true);
    expect(canTransition(libraryItemMachine, 'REJECTED', 'DRAFT')).toBe(true);
    expect(canTransition(libraryItemMachine, 'LIVE', 'PAUSED')).toBe(true);
  });
  it('renders attribution templates', () => {
    expect(renderAttribution('{title} by {author}, licensed CC BY 4.0', { title: 'Clip', author: 'Ada' })).toBe('Clip by Ada, licensed CC BY 4.0');
  });
});
