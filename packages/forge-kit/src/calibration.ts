/**
 * Photo calibration (Module 6, section 3). A dimension taken from a photo is valid only
 * after the person draws a line across a known edge and enters its real length. The scale
 * is never estimated from the image content.
 */
export type Point = [number, number];
export type Line = [Point, Point];

export class CalibrationError extends Error {
  readonly code = 'CALIBRATION_INVALID';
}

function checkLine(line: Line, image: { width: number; height: number }): number {
  if (!Array.isArray(line) || line.length !== 2) throw new CalibrationError('A line has two endpoints.');
  for (const p of line) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => Number.isFinite(v))) throw new CalibrationError('Line endpoints must be pixel coordinates.');
    if (p[0] < 0 || p[1] < 0 || p[0] > image.width || p[1] > image.height) throw new CalibrationError(`The line must stay inside the ${image.width} × ${image.height} px photo.`);
  }
  const len = Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]);
  if (len < 1) throw new CalibrationError('The line is too short; draw it across the whole known edge.');
  return len;
}

/** Scale from a line across a known edge: millimetres per pixel. */
export function calibrate(image: { width: number; height: number }, line: Line, realLengthMm: number): { lengthPx: number; mmPerPx: number } {
  if (!Number.isFinite(realLengthMm) || realLengthMm <= 0 || realLengthMm > 10_000) throw new CalibrationError('Enter the real length in millimetres (more than 0).');
  const lengthPx = checkLine(line, image);
  return { lengthPx, mmPerPx: realLengthMm / lengthPx };
}

/** A measured length on the same photo, in mm, rounded to 0.1 mm. */
export function measure(image: { width: number; height: number }, line: Line, mmPerPx: number): number {
  return Math.round(checkLine(line, image) * mmPerPx * 10) / 10;
}
