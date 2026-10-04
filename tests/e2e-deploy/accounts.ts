/**
 * The 4 sign-in accounts of the test office (task X1), one for each office role. scripts/seed-test-office.ts makes them in Auth
 * and links each to its person of the sample office; playwright.deploy.config.ts signs in once with each and keeps the session.
 * The emails are the sample office's own emails (src/data/seed.ts), and scripts/seed-test-office-args.test.ts checks that they
 * still are. The passwords never sit in the repository: each account names the secret that holds it.
 */
export const DEPLOY_ROLES = ['admin', 'management', 'accounting', 'member'] as const;
export type DeployRole = (typeof DEPLOY_ROLES)[number];

export type DeployAccount = { role: DeployRole; userId: string; email: string; passwordSecret: string };

export const DEPLOY_ACCOUNTS: Record<DeployRole, DeployAccount> = {
  admin: { role: 'admin', userId: 'usr_001', email: 'hala.nasser@madar.test', passwordSecret: 'MADAR_TEST_PASSWORD_ADMIN' },
  management: { role: 'management', userId: 'usr_010', email: 'turki.al.otaibi@madar.test', passwordSecret: 'MADAR_TEST_PASSWORD_MANAGEMENT' },
  accounting: { role: 'accounting', userId: 'usr_011', email: 'noura.al.shammari@madar.test', passwordSecret: 'MADAR_TEST_PASSWORD_ACCOUNTING' },
  member: { role: 'member', userId: 'usr_002', email: 'faisal.al.harbi@madar.test', passwordSecret: 'MADAR_TEST_PASSWORD_MEMBER' },
};

/** Where the setup project keeps the signed-in session of a role (Playwright storageState). git ignores test-results/. */
export const AUTH_DIR = 'test-results/e2e-deploy/.auth';
export function storageStateOf(role: DeployRole): string {
  return `${AUTH_DIR}/${role}.json`;
}
