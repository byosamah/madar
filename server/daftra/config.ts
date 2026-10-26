/**
 * The secrets of the Daftra link (the Daftra link, owner 2026-10-26). Each sub-company has its own Daftra account and its own key
 * (Bunah, MAZJ, Tuba, Vado, Zuraa). An account has two values, and they come all or none (the rule of the VAPID keys):
 *   DAFTRA_<NAME>_KEY    the key of that Daftra account
 *   DAFTRA_<NAME>_SITE   the site name of that account, for example `name.daftra.com`
 * <NAME> is the English name of the sub-company in capitals, only A to Z and 0 to 9 (`DAFTRA_ACCOUNT_PATTERN`, server/daftra/account.ts).
 * The server reads every pair that the environment holds, so a new sub-company needs two new secrets and no code change.
 * Madar only reads Daftra with them (server/daftra/client.ts). An error here names a variable, never a value.
 *
 * This file imports nothing, so the deploy scripts (scripts/deploy/secrets.ts) can use it too.
 */

export type DaftraAccountConfig = { key: string; site: string };
/** The accounts of a copy, by account name. A copy with none has no Daftra config (undefined, never an empty object). */
export type DaftraConfig = Record<string, DaftraAccountConfig>;

/** The account name: the same rule as DAFTRA_ACCOUNT_PATTERN in src/api/contract/limits.ts (a test keeps the two equal). */
export const DAFTRA_NAME_SOURCE = '[A-Z][A-Z0-9]{1,19}';
/** A secret name of the link. The first group is the account name, the second the part. */
export const DAFTRA_VAR_PATTERN = new RegExp(`^DAFTRA_(${DAFTRA_NAME_SOURCE})_(KEY|SITE)$`);

/** The key: 20 to 128 letters and digits. */
export const DAFTRA_KEY_PATTERN = /^[A-Za-z0-9]{20,128}$/;
/** The site: a name on daftra.com or daftara.com. No scheme, no slash, no port. */
export const DAFTRA_SITE_PATTERN = /^[A-Za-z0-9-]+\.(daftra|daftara)\.com$/;

export const daftraKeyName = (account: string): string => `DAFTRA_${account}_KEY`;
export const daftraSiteName = (account: string): string => `DAFTRA_${account}_SITE`;

/** True when this is a secret name of the link (a name that fits the pattern). */
export const isDaftraName = (name: string): boolean => DAFTRA_VAR_PATTERN.test(name);

/** The account names that these variable names mention, once each, in order. A name that does not fit the pattern is no account. */
export function daftraAccountsIn(names: Iterable<string>): string[] {
  const found = new Set<string>();
  for (const name of names) {
    const match = DAFTRA_VAR_PATTERN.exec(name);
    if (match) found.add(match[1]);
  }
  return [...found].sort();
}

/** The variables that an account lacks: the half that is missing. None when the pair is whole. */
function lacking(read: (name: string) => string | undefined, account: string): string[] {
  const key = daftraKeyName(account);
  const site = daftraSiteName(account);
  const haveKey = read(key) !== undefined;
  const haveSite = read(site) !== undefined;
  if (haveKey === haveSite) return [];
  return haveKey ? [site] : [key];
}

/** The names of the variables that stop the start: for every account with one half only, the other half. */
export function daftraMissing(read: (name: string) => string | undefined, names: Iterable<string>): string[] {
  return daftraAccountsIn(names).flatMap((account) => lacking(read, account));
}

/**
 * The accounts from the environment: `names` are the names that the environment holds. None set means Daftra is off (undefined).
 * An account with one half only is a mistake: it throws a DaftraConfigError that names the missing variable.
 */
export function daftraConfigOf(read: (name: string) => string | undefined, names: Iterable<string>): DaftraConfig | undefined {
  const missing = daftraMissing(read, names);
  if (missing.length > 0) throw new DaftraConfigError(`The Daftra link needs the key and the site of each account. Missing: ${missing.join(', ')}.`);
  const config: DaftraConfig = {};
  for (const account of daftraAccountsIn(names)) {
    const key = read(daftraKeyName(account));
    const site = read(daftraSiteName(account));
    if (key !== undefined && site !== undefined) config[account] = { key, site };
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

/** A Daftra config that is wrong. The message names the variable, never a value. */
export class DaftraConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaftraConfigError';
  }
}
