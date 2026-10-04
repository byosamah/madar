import { AFTER_M, asRole, expect, test, useLanguage } from './fixtures';
import { goto } from './goto';
import { expectNoSeriousA11y, LANGS, THEMES, WIDTHS } from './steps';

/**
 * Admin, Usage (plan 5.8; task M1) on the remote build (task X2). It needs track M, which merges after this spec: the merge lead
 * runs it after the merge of rb/M with MADAR_E2E_AFTER_M=1. Its words come from M's word files (usage.<lang>.json), which are not
 * on this branch, so the texts sit here.
 */
test.skip(!AFTER_M, 'Admin, Usage comes with track M. The merge lead runs this spec after the merge of rb/M (MADAR_E2E_AFTER_M=1).');

const USAGE = {
  en: { title: 'Usage', calm: /All within the free plan\.|of the free plan limit|The 15-minute|not run|Check again/ },
  ar: { title: 'الاستخدام', calm: /\S/ },
} as const;

for (const width of WIDTHS) {
  for (const lang of LANGS) {
    for (const theme of THEMES) {
      test(`Admin, Usage at ${width}px, ${lang}, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        if (lang === 'ar') await useLanguage(page, 'ar');
        await goto(page, '/admin');
        const heading = page.getByRole('heading', { level: 2, name: USAGE[lang].title, exact: true });
        await expect(heading).toBeVisible();
        const section = page.locator('section').filter({ has: heading });
        // Calm by default: one line when all is well, else one line or bar for each thing that needs the Admin.
        await expect(section.locator('p, li').first()).toHaveText(USAGE[lang].calm);
        expect.soft(await section.locator('button.signature').count(), 'Usage: no main button').toBe(0);
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await page.screenshot({ path: `test-results/e2e-deploy-shots/usage/${width}-${lang}-${theme}.png`, fullPage: true });
        await expectNoSeriousA11y(page, 'admin usage');
      });
    }
  }
}

test.describe('as a person who is not the Admin', () => {
  test.use(asRole('member'));

  test('Usage does not show', async ({ page }) => {
    await goto(page, '/admin');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Usage', exact: true })).toHaveCount(0);
  });
});
