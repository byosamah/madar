/** The storage limit is typed in gigabytes and kept in bytes (design 5.9). */
export const GB = 1024 ** 3;

/** Bytes to a typed number of gigabytes, with up to 2 decimals. null: no limit. */
export const gbText = (bytes: number | null): string => (bytes === null ? '' : String(Math.round((bytes / GB) * 100) / 100));

/** A typed number of gigabytes to bytes. An empty text is no limit (null). A text that is no positive number is undefined. */
export function bytesOfGb(text: string): number | null | undefined {
  const clean = text.trim();
  if (clean === '') return null;
  const value = Number(clean);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value * GB)) : undefined;
}

/** A typed people limit. An empty text is no limit (null). A text that is no whole number above 0 is undefined. */
export function peopleOf(text: string): number | null | undefined {
  const clean = text.trim();
  if (clean === '') return null;
  const value = Number(clean);
  return Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** Gigabytes with one decimal, for a line of use. */
export const gbOne = (bytes: number): string => (bytes / GB).toFixed(1);

/**
 * True when the enterprise sent its first status. The list call answers 0 for every count of an enterprise that sent none (a new local
 * stack, a new enterprise), so a row with no person, no invited person, no bytes and no write has no status yet. A real status always
 * holds the first Admin (active or invited), so it is never all zero.
 */
export const hasStatus = (row: { people: number; invited: number; storageBytes: number; lastWriteAt: string | null }): boolean =>
  row.people > 0 || row.invited > 0 || row.storageBytes > 0 || row.lastWriteAt !== null;
