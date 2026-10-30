export interface PrinterProfileRow {
  key: string;
  name: string;
  bed_mm: [number, number, number];
  nozzle_mm: number;
  validated_materials: string[];
  overhang_default_deg: number;
  wall_min_mm: number;
  source_url: string | null;
  retrieved_on: string | null;
  is_generic: boolean;
}
export const PRINTER_PROFILES: PrinterProfileRow[];
export interface DfmProfileObject {
  key: string;
  label: string;
  bed: number[];
  minWall: number;
  overhangDeg: number;
  process: { base: string; bed: number[]; minWall: number };
}
export function dfmFromPrinter(p: Pick<PrinterProfileRow, 'key' | 'name' | 'bed_mm' | 'wall_min_mm' | 'overhang_default_deg' | 'is_generic'>, customBed?: number[] | null): DfmProfileObject;
