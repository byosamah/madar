import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function expectNoSeriousA11yIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function useArabic(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

const SCREENS = [
  { name: 'dashboard', path: '/#/dashboard' },
  { name: 'dashboard-people', path: '/#/dashboard?view=people' },
  { name: 'dashboard-schedule', path: '/#/dashboard?view=schedule' },
  { name: 'task-list', path: '/#/tasks?filter=overdue' },
  { name: 'deadlines', path: '/#/tasks?mode=deadlines' },
  { name: 'settings-admin', path: '/#/settings' },
];

for (const width of [390, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`dashboard screens at ${width}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await useArabic(page);
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `test-results/dashboard/${width}-${lang}-${screen.name}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page);
      }
    });
  }
}

test('a tile and a workload cell open the lists behind them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/dashboard');
  await page.getByRole('link', { name: /Past-due to-dos/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Past-due to-dos' })).toBeVisible();
  await page.goBack();
  // Workload sits under the People tab.
  await page.getByRole('tab', { name: 'People' }).click();
  // The first cell of a row is Past due (owner, 2026-10-06). A week cell opens the person's tasks.
  await page.getByRole('region', { name: 'Workload' }).getByRole('link', { name: /, week of / }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('To-dos of');
});

test('the office schedule runs right to left in Arabic', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useArabic(page);
  await page.goto('/#/dashboard?view=schedule');
  const schedule = page.getByRole('region', { name: 'جدول المكتب' });
  await expect(schedule).toBeVisible();
  const ticks = await schedule.locator('span.border-s').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left)); // rtl-ok: screen positions
  expect(ticks[0]).toBeGreaterThan(ticks[ticks.length - 1]);
});
