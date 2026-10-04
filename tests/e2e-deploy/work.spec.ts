import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test, useArabic } from './fixtures';
import { goto } from './goto';

/** tests/e2e/work.spec.ts on the remote build (task X2), at 820 px too. */

async function expectNoSeriousA11yIssues(page: Page, route: string, scope?: string): Promise<void> {
  const builder = new AxeBuilder({ page });
  if (scope) builder.include(scope);
  const results = await builder.withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(serious.map((v) => `${route}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const SCREENS: { name: string; route: string; ready: (page: Page) => Promise<void>; scope?: string }[] = [
  { name: 'work', route: '/work', ready: async (page) => { await expect(page.getByRole('region').first()).toBeVisible(); } },
  { name: 'inbox', route: '/inbox', ready: async (page) => { await expect(page.locator('aside ul li').first()).toBeVisible(); } },
  { name: 'notifications', route: '/notifications', ready: async (page) => { await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); } },
  { name: 'search', route: '/search', ready: async (page) => { await page.locator('input[role="combobox"]').fill('a'); await expect(page.locator('[cmdk-root] [role="option"]').first()).toBeVisible(); } },
  { name: 'task-comments', route: '/projects/prj_001?tab=tasks&task=tsk_007&thread=1', ready: async (page) => { await expect(page.getByRole('dialog')).toBeVisible(); } },
];

for (const width of [390, 820, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`personal work screens at ${width}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await useArabic(page);
      for (const screen of SCREENS) {
        await goto(page, screen.route);
        await screen.ready(page);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `test-results/e2e-deploy-shots/work/${width}-${lang}-${screen.name}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page, screen.route, screen.scope);
      }
    });
  }
}

test('Ctrl+K opens search, and Enter opens the project', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/');
  await expect(page.getByRole('list', { name: 'Your projects' }).getByRole('listitem').first()).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('input[role="combobox"]').fill('corniche');
  await expect(page.locator('[cmdk-root]').getByRole('option', { name: /Corniche Office Tower/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
});

test('Mark all read clears the bell count', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/notifications');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  const markAll = page.getByRole('button', { name: 'Mark all read' });
  if (await markAll.isVisible()) await markAll.click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Notifications' }).getByText(/items need action/)).toHaveCount(0);
});

test('Arabic search for a project word shows results or the no-results sentence', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.setViewportSize({ width: 1440, height: 900 });
  await useArabic(page);
  await goto(page, '/search');
  await page.locator('input[role="combobox"]').fill('برج');
  await page.waitForTimeout(500);
  const hasOption = page.locator('[cmdk-root] [role="option"]').first();
  const noResults = page.locator('[role="status"], p').filter({ hasText: /لا |ما من|لم/ }).first();
  await expect(hasOption.or(noResults)).toBeVisible();
  expect(errors).toEqual([]);
});

test('no screen scrolls sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const routes = [
    '/', '/projects', '/projects/prj_001', '/projects/prj_001?tab=tasks', '/projects/prj_001?tab=activity', '/projects/prj_001?tab=schedule', '/projects/prj_001?tab=files',
    '/projects/prj_001?tab=team', '/work', '/inbox', '/notifications', '/admin', '/search', '/settings',
    '/dashboard', '/dashboard?view=people', '/dashboard?view=schedule', '/tasks?filter=overdue', '/tasks?mode=deadlines',
  ];
  for (const route of routes) {
    await goto(page, route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect.soft(width, route).toBeLessThanOrEqual(390);
  }
});
