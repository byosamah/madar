import { expect, test, useLanguage } from './fixtures';
import { goto } from './goto';
import { expectCalm, expectNoSeriousA11y, LANGS, THEMES, WIDTHS } from './steps';
import { word } from './words';

/**
 * The Settings and Admin parts of the remote build (task X2): Notifications with two switches for each trigger (N2.2), Password
 * (U), and the person form with the invitation language (U3), each at 390, 820 and 1440 px in both languages and both themes,
 * with the calm checks of plan 6.1, rule 8.
 */

for (const width of WIDTHS) {
  for (const lang of LANGS) {
    for (const theme of THEMES) {
      test(`Settings and the person form at ${width}px, ${lang}, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        if (lang === 'ar') await useLanguage(page, 'ar');
        await goto(page, '/settings');
        for (const key of ['settings.notifications', 'password.title']) {
          await expect(page.getByRole('heading', { level: 2, name: word(lang, key) })).toBeVisible();
        }
        await expect(page.getByRole('switch', { name: word(lang, 'notices.summary') })).toBeVisible();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `test-results/e2e-deploy-shots/settings/${width}-${lang}-${theme}-settings.png`, fullPage: true });
        await expectCalm(page, 'settings');
        await expectNoSeriousA11y(page, 'settings');

        await goto(page, '/admin');
        await page.getByRole('button', { name: word(lang, 'admin.addPerson') }).click();
        const sheet = page.getByRole('dialog', { name: word(lang, 'admin.addPerson') });
        await expect(sheet.locator('#person-language')).toBeVisible();
        await expect(sheet.getByText(word(lang, 'people.languageHint'))).toBeVisible();
        await page.waitForTimeout(600);
        await page.screenshot({ path: `test-results/e2e-deploy-shots/settings/${width}-${lang}-${theme}-person-form.png`, fullPage: true });
        expect.soft(await sheet.locator('button.signature:visible').count(), 'person form: at most one main button').toBeLessThanOrEqual(1);
        await expectNoSeriousA11y(page, 'person form');
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
      });
    }
  }
}

test('a notice switch saves on the server, and the email switch waits for the in-app one', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/settings');
  await expect(page.getByRole('switch', { name: /, in the app$/ }).first()).toBeVisible();
  const first = page.locator('[role="switch"][aria-checked="true"][aria-label$=", in the app"]').first();
  const label = (await first.getAttribute('aria-label'))!.replace(/, in the app$/, '');
  const inApp = page.getByRole('switch', { name: `${label}, in the app`, exact: true });
  const email = page.getByRole('switch', { name: `${label}, by email`, exact: true });
  await expect(email).toBeEnabled();

  await inApp.click();
  await expect(inApp).toHaveAttribute('aria-checked', 'false');
  await expect(email).toBeDisabled();
  await expect(page.getByText(word('en', 'notices.emailNeedsApp'))).toBeVisible();
  // The choice is the person's own on the server: a new load shows it.
  await page.reload();
  await expect(inApp).toHaveAttribute('aria-checked', 'false');

  await inApp.click();
  await expect(inApp).toHaveAttribute('aria-checked', 'true');
  await expect(email).toBeEnabled();
});

test('the remote build has no prototype controls in Settings', async ({ page }) => {
  await goto(page, '/settings');
  await expect(page.getByRole('heading', { level: 2, name: word('en', 'password.title') })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: word('en', 'settings.prototype') })).toHaveCount(0);
  await expect(page.getByLabel('Preview as')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: word('en', 'settings.simulateErrors') })).toHaveCount(0);
});
