import AxeBuilder from '@axe-core/playwright';
import { expect, test, useArabic } from './fixtures';
import { goto, settle } from './goto';

/** tests/e2e/shell.spec.ts on the remote build (task X2). */

const ROUTES = ['/', '/projects', '/work', '/dashboard', '/inbox', '/notifications', '/admin', '/search', '/settings', '/me'];
const WIDTHS = [390, 820, 1440];

for (const width of WIDTHS) {
  for (const lang of ['en', 'ar'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`shell at ${width}px, ${lang}, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await goto(page, '/settings');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (lang === 'ar') await useArabic(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        for (const route of ROUTES) {
          await goto(page, route);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          if (route === '/' || route === '/projects') await expect(page.locator('main ul li').first()).toBeVisible();
          await settle(page);
          const name = route === '/' ? 'home' : route.slice(1);
          await page.screenshot({ path: `test-results/e2e-deploy-shots/shell/${width}-${lang}-${theme}-${name}.png`, fullPage: true });
          const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
          expect(serious.map((v) => `${route}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        }
      });
    }
  }
}

test('keyboard users reach the floating navigation pill', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  let reached = false;
  for (let i = 0; i < 20 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim() === 'Dashboard' && !!document.activeElement?.closest('nav[aria-label="Main navigation"]'));
  }
  expect(reached).toBe(true);
});

test('reduce motion removes the press animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await goto(page, '/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const duration = await page.locator('.pressable').first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration).toBe('0s');
});
