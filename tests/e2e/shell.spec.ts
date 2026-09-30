import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = ['/', '/work', '/dashboard', '/inbox', '/search', '/settings'];
const WIDTHS = [390, 820, 1440];

for (const width of WIDTHS) {
  for (const lang of ['en', 'ar'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`shell at ${width}px, ${lang}, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/#/settings');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (lang === 'ar') {
          await page.getByRole('radio', { name: 'العربية' }).click();
          await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        }
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        for (const route of ROUTES) {
          await page.goto(`/#${route}`);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          const name = route === '/' ? 'projects' : route.slice(1);
          await page.screenshot({ path: `test-results/shell/${width}-${lang}-${theme}-${name}.png`, fullPage: true });
          const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
          expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        }
      });
    }
  }
}

test('keyboard users reach the main navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  let reached = false;
  for (let i = 0; i < 20 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.textContent?.includes('My Work') ?? false);
  }
  expect(reached).toBe(true);
});

test('reduce motion removes the press animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const duration = await page.locator('.pressable').first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration).toBe('0s');
});
