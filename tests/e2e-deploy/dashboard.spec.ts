import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test, useArabic } from './fixtures';
import { goto, settle } from './goto';

/** tests/e2e/dashboard.spec.ts on the remote build (task X2), at 820 px too. */

async function expectNoSeriousA11yIssues(page: Page, route: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(serious.map((v) => `${route}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const SCREENS = [
  { name: 'dashboard', route: '/dashboard' },
  { name: 'dashboard-people', route: '/dashboard?view=people' },
  { name: 'dashboard-schedule', route: '/dashboard?view=schedule' },
  { name: 'task-list', route: '/tasks?filter=overdue' },
  { name: 'deadlines', route: '/tasks?mode=deadlines' },
  { name: 'settings-admin', route: '/settings' },
];
// The Me hub and its Profile page are the phone shape of Settings (Direction D). A desk sends both to /settings.
const PHONE_SCREENS = [
  { name: 'me', route: '/me' },
  { name: 'me-profile', route: '/me/profile' },
];

for (const width of [390, 820, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`dashboard screens at ${width}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await useArabic(page);
      for (const screen of width < 640 ? [...SCREENS, ...PHONE_SCREENS] : SCREENS) {
        await goto(page, screen.route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await settle(page);
        await page.screenshot({ path: `test-results/e2e-deploy-shots/dashboard/${width}-${lang}-${screen.name}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page, screen.route);
      }
    });
  }
}

test('a tile and a workload cell open the lists behind them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/dashboard');
  await page.getByRole('link', { name: /Past-due to-dos/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Past-due to-dos' })).toBeVisible();
  await page.goBack();
  await page.getByRole('tab', { name: 'People' }).click();
  // The first cell of a row is Past due (owner, 2026-10-06). A week cell opens the person's tasks.
  await page.getByRole('region', { name: 'Workload' }).getByRole('link', { name: /, week of / }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('To-dos of');
});

test('the office schedule runs right to left in Arabic', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useArabic(page);
  await goto(page, '/dashboard?view=schedule');
  const schedule = page.getByRole('region', { name: 'جدول المكتب' });
  await expect(schedule).toBeVisible();
  const ticks = await schedule.locator('span.border-s').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left)); // rtl-ok: screen positions
  expect(ticks[0]).toBeGreaterThan(ticks[ticks.length - 1]);
});
