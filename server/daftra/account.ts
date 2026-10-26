import { DAFTRA_ACCOUNT_PATTERN } from '../../src/api/contract/limits';

/**
 * Which Daftra account a project belongs to (the Daftra link, owner 2026-10-26). Each sub-company keeps its books in its own Daftra account.
 * The account of a project is the account of its sub-company: the English name of the sub-company in capitals, with every character that is
 * not A to Z or 0 to 9 taken out ("MAZJ" is MAZJ, "Vado" is VADO, "Al Noor Design" is ALNOORDESIGN). Pure: no database, no clock, no network.
 * Every path uses these functions (the calls, the preflight of the link, the job), so no path has its own idea of the name.
 */

export { DAFTRA_ACCOUNT_PATTERN };

/** The account name of a sub-company, or undefined when its English name gives no valid name (for example a name of one letter). */
export function accountNameOf(subCompanyName: string): string | undefined {
  const name = subCompanyName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return DAFTRA_ACCOUNT_PATTERN.test(name) ? name : undefined;
}

/** Why a project has no Daftra account. The sheet says it in one line. */
export type NoAccount = 'no_sub_company' | 'no_daftra_account';

export type AccountOfProject = { account: string; noAccount: null } | { account: null; noAccount: NoAccount };

/**
 * The account of a project. `subCompanies` is the list of sub-companies by id, `configured` the account names that the copy holds keys for.
 * A project with no sub-company, or a sub-company whose name matches no configured account, has no account.
 */
export function accountOfProject(
  project: { subCompanyId?: string | null },
  subCompanies: Readonly<Record<string, { name: string } | undefined>>,
  configured: Iterable<string>,
): AccountOfProject {
  const sub = project.subCompanyId ? subCompanies[project.subCompanyId] : undefined;
  if (!sub) return { account: null, noAccount: 'no_sub_company' };
  const name = accountNameOf(sub.name);
  if (name === undefined || ![...configured].includes(name)) return { account: null, noAccount: 'no_daftra_account' };
  return { account: name, noAccount: null };
}
