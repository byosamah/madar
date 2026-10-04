import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test, useArabic } from './fixtures';
import { goto } from './goto';

/** tests/e2e/full.spec.ts on the remote build (task X2): every screen in both languages, both themes, at 390, 820 and 1440 px. */

const ROUTES = [
  '/', '/projects', '/projects/prj_001', '/projects/prj_001?tab=tasks', '/projects/prj_001?tab=activity', '/projects/prj_001?tab=schedule', '/projects/prj_001?tab=files',
  '/projects/prj_001?tab=team', '/work', '/dashboard', '/dashboard?view=people', '/dashboard?view=schedule', '/tasks?filter=overdue', '/tasks?mode=deadlines', '/inbox', '/notifications', '/admin', '/search', '/settings',
];

async function sweep(page: Page, folder: string): Promise<void> {
  for (const route of ROUTES) {
    await goto(page, route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(1200);
    const name = route === '/' ? 'home' : route.slice(1).replace(/[/?=&]/g, '-');
    await page.screenshot({ path: `test-results/e2e-deploy-shots/full/${folder}/${name}.png`, fullPage: true });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect.soft(serious.map((v) => `${route}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  }
}

for (const width of [390, 820, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`every screen at ${width}px, ${lang}, ${theme}`, async ({ page }) => {
        test.setTimeout(300_000);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        if (lang === 'ar') await useArabic(page);
        await sweep(page, `${width}-${lang}-${theme}`);
      });
    }
  }
}

test('every screen with reduced transparency and more contrast', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ contrast: 'more', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes('prefers-reduced-transparency')
      ? ({ ...original(query), matches: true, media: query } as MediaQueryList)
      : original(query));
  });
  await sweep(page, 'high-contrast');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
});

test('reduce motion stops the project row from growing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/projects');
  await page.getByRole('list', { name: 'Projects' }).getByRole('link').first().click();
  const header = page.locator('header h1 > span');
  await expect(header).toBeVisible();
  const early = await header.boundingBox();
  await page.waitForTimeout(700);
  const settled = await header.boundingBox();
  expect(Math.round(early!.width)).toBe(Math.round(settled!.width));
});

test('reduce motion keeps the bars still while the page scrolls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await goto(page, '/');
  await expect(page.getByRole('list', { name: 'Your projects' }).getByRole('listitem').first()).toBeVisible();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);
  const moved = await page.evaluate(() => [...document.querySelectorAll('[data-compact]')].map((el) => {
    const style = getComputedStyle(el);
    return `${el.tagName}:${style.transform}:${style.scale}:${style.translate}`;
  }));
  expect(moved.length).toBeGreaterThan(0);
  for (const line of moved) expect(line).toMatch(/:none:none:none$/);
});
