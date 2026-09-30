const EASTERN_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export type ParsedHours = { ok: true; hours: number } | { ok: false };

/**
 * Reads a timesheet cell (spec 6.2): steps of 0.5 from 0 to 24. An empty cell is 0.
 * A comma or the Arabic decimal sign works as the decimal point, and Arabic-Indic digits work.
 */
export function parseHours(text: string): ParsedHours {
  const clean = text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(EASTERN_DIGITS.indexOf(digit)))
    .replace(/[,٫]/, '.');
  if (clean === '') return { ok: true, hours: 0 };
  if (!/^\d{1,2}(\.\d+)?$/.test(clean)) return { ok: false };
  const hours = Number(clean);
  if (hours > 24 || Math.round(hours * 2) !== hours * 2) return { ok: false };
  return { ok: true, hours };
}

/** The text of a cell: empty for 0, Western digits and a point otherwise, in both languages. */
export function hoursText(hours: number): string {
  return hours === 0 ? '' : String(hours);
}
