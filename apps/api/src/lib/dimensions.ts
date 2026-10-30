import { AppError, toApiId } from '@sw/shared';
import { unconfirmedAssumed, type Dimensions, type ParamValues } from '@sw/forge-kit';
import type { Db, ForgeSource } from '@sw/db';

/** Exports and print orders need every assumed dimension confirmed (Module 6 rule 2). */
export function assertDimensionsConfirmed(src: ForgeSource, versionParams: ParamValues, params: ParamValues): void {
  const keys = unconfirmedAssumed(src.dimensions as unknown as Dimensions | null, versionParams, params);
  if (keys.length) {
    throw new AppError('DIMENSIONS_ASSUMED', `These sizes were assumed, not given: ${keys.join(', ')}. Confirm or change them before exporting.`, { keys });
  }
}

export interface PrinterDto {
  id: string;
  key: string;
  name: string;
  bed_mm: number[];
  nozzle_mm: number;
  wall_min_mm: number;
  overhang_deg: number;
  validated_materials: string[];
  is_generic: boolean;
  source_url: string | null;
  retrieved_on: string | null;
}

/** The forge's printer profile (generic default), with the entered bed for the generic one. */
export async function printerFor(db: Db, a: { printerProfileId: string | null; printerBedMm: unknown }): Promise<PrinterDto> {
  const p = (a.printerProfileId ? await db.printerProfile.findUnique({ where: { id: a.printerProfileId } }) : null) ?? (await db.printerProfile.findFirst({ where: { isGeneric: true }, orderBy: { createdAt: 'asc' } }));
  if (!p) throw new AppError('INTERNAL', 'No printer profiles are configured');
  return serializePrinter(p, a.printerBedMm);
}

export function serializePrinter(
  p: { id: string; key: string; name: string; bedMm: unknown; nozzleMm: number; wallMinMm: number; overhangDefaultDeg: number; validatedMaterials: string[]; isGeneric: boolean; sourceUrl: string | null; retrievedOn: Date | null },
  customBed?: unknown,
): PrinterDto {
  const bed = p.isGeneric && Array.isArray(customBed) && customBed.length === 3 ? (customBed as number[]) : (p.bedMm as number[]);
  return {
    id: toApiId('printerProfile', p.id),
    key: p.key,
    name: p.name,
    bed_mm: bed,
    nozzle_mm: p.nozzleMm,
    wall_min_mm: p.wallMinMm,
    overhang_deg: p.overhangDefaultDeg,
    validated_materials: p.validatedMaterials,
    is_generic: p.isGeneric,
    source_url: p.sourceUrl,
    retrieved_on: p.retrievedOn ? p.retrievedOn.toISOString().slice(0, 10) : null,
  };
}
