import { DEPLOY_ACCOUNTS } from './accounts';
import { expect, passwordOf, test, useLanguage } from './fixtures';
import { goto, urlPattern } from './goto';
import { expectCalm, expectNoSeriousA11y, LANGS, NO_SESSION, runId, signedOutLanguage, signedOutTheme, signIn, THEMES, WIDTHS } from './steps';
import { word } from './words';

/**
 * The sign-in screens of the remote build (plan 5.1; task X2): Sign in, Forgot, Reset and Welcome with no session, the way back
 * to the screen of a link after sign-in, Sign out, and the session sheet when the session ends.
 *
 * These tests type the Admin's password, and a trace keeps the value of each fill in clear text. So this file records no trace,
 * as the setup project does (scripts/playwright-deploy-config.test.ts checks every spec that calls passwordOf).
 */
test.use({ trace: 'off' });

const admin = DEPLOY_ACCOUNTS.admin;

test.describe('with no session', () => {
  test.use({ storageState: NO_SESSION });

  for (const width of WIDTHS) {
    for (const lang of LANGS) {
      for (const theme of THEMES) {
        test(`the sign-in screens at ${width}px, ${lang}, ${theme}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme: theme });
          await signedOutLanguage(page, lang);
          await signedOutTheme(page, theme);
          const screens: [string, string][] = [
            ['/sign-in', 'auth.signIn.title'],
            ['/forgot', 'auth.forgot.title'],
            ['/reset', 'auth.reset.title'],
            ['/welcome', 'auth.welcome.title'],
          ];
          for (const [route, title] of screens) {
            await goto(page, route);
            await expect(page.getByRole('heading', { level: 1, name: word(lang, title) })).toBeVisible();
            await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await page.waitForTimeout(600);
            await page.screenshot({ path: `test-results/e2e-deploy-shots/signin/${width}-${lang}-${theme}${route.replace('/', '-')}.png`, fullPage: true });
            await expectCalm(page, route);
            await expectNoSeriousA11y(page, route);
            expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), `${route} scrolls sideways`).toBeLessThanOrEqual(width);
          }
        });
      }
    }
  }

  test('the sign-in screen is light on a dark device when this device saved no theme (owner, 2026-10-05, item 11)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await goto(page, '/sign-in');
    await expect(page.getByRole('heading', { level: 1, name: word('en', 'auth.signIn.title') })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('a link with no session goes to Sign in, refuses a wrong password, and comes back after the sign-in', async ({ page }) => {
    await goto(page, '/projects?filter=at_risk');
    await expect(page).toHaveURL(urlPattern('/sign-in?next='));
    await page.locator('#sign-in-email').fill(admin.email);
    await page.locator('#sign-in-password').fill('not-the-password-1');
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByText(word('en', 'auth.errors.wrong'))).toBeVisible();
    await page.locator('#sign-in-password').fill(passwordOf('admin'));
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(urlPattern('/projects?filter=at_risk'));
    await expect(page.getByRole('list', { name: 'Projects' }).getByRole('listitem').first()).toBeVisible();
  });

  test('Sign out ends the session on this device and a screen link then asks for a sign-in', async ({ page }) => {
    await signIn(page, admin.email, passwordOf('admin'));
    await page.getByRole('button', { name: 'Hala Nasser', exact: true }).click();
    await page.getByRole('dialog', { name: 'Hala Nasser' }).getByRole('button', { name: word('en', 'auth.signOut') }).click();
    await expect(page).toHaveURL(urlPattern('/sign-in?reason=signed_out'));
    await expect(page.getByText(word('en', 'auth.reasons.signed_out'))).toBeVisible();
    await goto(page, '/dashboard');
    await expect(page).toHaveURL(urlPattern('/sign-in?next=%2Fdashboard'));
  });

  test('Forgot gives the same calm answer for an email with no account', async ({ page }) => {
    await goto(page, '/forgot');
    await page.locator('#forgot-email').fill(`x2-nobody-${runId()}@madar.test`);
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole('status')).toHaveText(word('en', 'auth.forgot.sent'));
  });

  test('a reset link that Auth refuses shows the ended line and the way to a new link', async ({ page }) => {
    await goto(page, '/reset?token_hash=x2-not-a-real-token&type=recovery');
    await page.locator('#reset-password').fill('A-new-password-x2');
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole('alert')).toHaveText(word('en', 'auth.reset.ended'));
    await expect(page.getByRole('link', { name: word('en', 'auth.reset.again') })).toBeVisible();
  });

  test('an invitation link that Auth refuses shows the ended line', async ({ page }) => {
    await goto(page, '/welcome?token_hash=x2-not-a-real-token&type=invite');
    await page.getByRole('button', { name: word('en', 'auth.welcome.open') }).click();
    await expect(page.getByRole('alert')).toHaveText(word('en', 'auth.welcome.ended'));
  });
});

const escapeText = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The sheet stays open while the viewport takes each width, so one ended session (and one sign-in with the password) serves the 3
// widths of a language and a theme. That keeps the password sign-ins of a run under the Auth limit.
for (const lang of LANGS) {
  for (const theme of THEMES) {
    test(`an ended session opens the session sheet over the screen at ${WIDTHS.join(', ')}px, ${lang}, ${theme}, and the password closes it`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      // The preferences fixture puts the Admin's English back at the end.
      if (lang === 'ar') await useLanguage(page, 'ar');
      await goto(page, '/');
      await expect(page.getByRole('list', { name: word(lang, 'home.projects') }).getByRole('listitem').first()).toBeVisible();
      // The kept session ends: its access token is old and Auth refuses its refresh token. The real Auth answers the refresh.
      await page.evaluate(() => {
        const kept = JSON.parse(window.localStorage.getItem('madar.auth') ?? 'null') as Record<string, unknown> | null;
        if (!kept) throw new Error('No kept session in this browser.');
        window.localStorage.setItem('madar.auth', JSON.stringify({ ...kept, expires_at: 1, refresh_token: 'x2-ended-refresh-token' }));
      });
      await page.getByRole('navigation', { name: word(lang, 'nav.main') }).getByRole('link', { name: new RegExp(`^${escapeText(word(lang, 'nav.projects'))}`) }).click();
      const sheet = page.getByRole('dialog', { name: word(lang, 'auth.expired.title') });
      await expect(sheet).toBeVisible({ timeout: 20_000 });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const label = `session sheet ${width}px ${lang} ${theme}`;
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(sheet.getByRole('button', { name: word(lang, 'auth.expired.submit') })).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `test-results/e2e-deploy-shots/signin/session-${width}-${lang}-${theme}.png`, fullPage: true });
        // The calm check of the sheet: its one main button is the password button.
        await expect.soft(sheet.locator('button.signature:visible'), `${label}: one main button`).toHaveCount(1);
        await expectNoSeriousA11y(page, label, '[role="dialog"]');
        expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), `${label} scrolls sideways`).toBeLessThanOrEqual(width);
      }
      await sheet.locator('input[type="password"]').fill(passwordOf('admin'));
      await sheet.getByRole('button', { name: word(lang, 'auth.expired.submit') }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByRole('list', { name: word(lang, 'screens.projects') }).getByRole('listitem').first()).toBeVisible();
    });
  }
}
