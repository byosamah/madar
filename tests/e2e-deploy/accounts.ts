import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The 4 sign-in accounts of the test office (task X1), one for each office role. scripts/seed-test-office.ts makes them in Auth
 * and links each to its person of the sample office; playwright.deploy.config.ts signs in once with each and keeps the session.
 * The emails are role addresses (owner, 2026-10-05): testOffice in scripts/seed-test-office.ts gives them to the 4 people, and
 * the sample office of the prototype keeps its own emails. The passwords never sit in the repository: each account names the
 * secret that holds it.
 */
export const DEPLOY_ROLES = ['admin', 'management', 'accounting', 'member'] as const;
export type DeployRole = (typeof DEPLOY_ROLES)[number];

export type DeployAccount = { role: DeployRole; userId: string; email: string; passwordSecret: string };

export const DEPLOY_ACCOUNTS: Record<DeployRole, DeployAccount> = {
  admin: { role: 'admin', userId: 'usr_001', email: 'admin@madar.test', passwordSecret: 'MADAR_TEST_PASSWORD_ADMIN' },
  management: { role: 'management', userId: 'usr_010', email: 'management@madar.test', passwordSecret: 'MADAR_TEST_PASSWORD_MANAGEMENT' },
  accounting: { role: 'accounting', userId: 'usr_011', email: 'accounting@madar.test', passwordSecret: 'MADAR_TEST_PASSWORD_ACCOUNTING' },
  member: { role: 'member', userId: 'usr_002', email: 'member@madar.test', passwordSecret: 'MADAR_TEST_PASSWORD_MEMBER' },
};

/**
 * Where the setup project keeps the signed-in session of a role (Playwright storageState). A session holds a refresh token, the
 * Admin's among them, so the folder is outside test-results/: a CI job that uploads the run output never uploads a session.
 * prepareAuthDir puts a .gitignore of "*" in the folder, so git ignores the sessions also without a line in the root .gitignore.
 */
export const AUTH_DIR = 'playwright/.auth';

export function prepareAuthDir(root: string = process.cwd()): void {
  const dir = join(root, AUTH_DIR);
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
}

export function storageStateOf(role: DeployRole): string {
  return `${AUTH_DIR}/${role}.json`;
}
