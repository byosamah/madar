import { expect, test as setup } from '@playwright/test';
import { DEPLOY_ACCOUNTS, DEPLOY_ROLES, storageStateOf } from './accounts';

/**
 * Signs in once for each office role on the Sign in screen and keeps the session for the specs (task X1). The password comes
 * from the secret that accounts.ts names; scripts/seed-test-office.ts set the same password on the test project.
 */

for (const role of DEPLOY_ROLES) {
  setup(`sign in as ${role}`, async ({ page }) => {
    const account = DEPLOY_ACCOUNTS[role];
    const password = process.env[account.passwordSecret];
    if (!password) throw new Error(`${account.passwordSecret} is missing: load ~/dev/madar/.env.local (or the CI secret) first.`);
    await page.goto('/sign-in');
    await page.locator('#sign-in-email').fill(account.email);
    await page.locator('#sign-in-password').fill(password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/sign-in/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.context().storageState({ path: storageStateOf(role) });
  });
}
