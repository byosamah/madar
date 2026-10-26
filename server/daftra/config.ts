/**
 * The secrets of the Daftra link (the Daftra link, owner 2026-10-26).
 *
 * Two values, all or none (the rule of the VAPID keys): DAFTRA_API_KEY is the key of the Daftra account, and DAFTRA_SITE is the
 * site name of that account, for example `name.daftra.com`. Madar only reads Daftra with them (server/daftra/client.ts).
 * An error here names a variable, never a value.
 */

export type DaftraConfig = { apiKey: string; site: string };

/** The names of the two function secrets. */
export const DAFTRA_NAMES = ['DAFTRA_API_KEY', 'DAFTRA_SITE'] as const;

/** The key: 20 to 128 letters and digits. */
export const DAFTRA_KEY_PATTERN = /^[A-Za-z0-9]{20,128}$/;
/** The site: a name on daftra.com or daftara.com. No scheme, no slash, no port. */
export const DAFTRA_SITE_PATTERN = /^[A-Za-z0-9-]+\.(daftra|daftara)\.com$/;

/** The two values from the environment. None set means Daftra is off (undefined). Only one is a mistake. */
export function daftraConfigOf(read: (name: string) => string | undefined): DaftraConfig | undefined {
  const [apiKey, site] = DAFTRA_NAMES.map((name) => read(name));
  if (apiKey === undefined && site === undefined) return undefined;
  const missing = DAFTRA_NAMES.filter((name) => read(name) === undefined);
  if (missing.length > 0) throw new DaftraConfigError(`The Daftra link needs all of ${DAFTRA_NAMES.join(', ')}. Missing: ${missing.join(', ')}.`);
  return { apiKey: apiKey!, site: site! };
}

/** A Daftra config that is wrong. The message names the variable, never a value. */
export class DaftraConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaftraConfigError';
  }
}
