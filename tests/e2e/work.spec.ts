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

const SCREENS: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  { name: 'work', path: '/#/work', ready: async (page) => { await expect(page.getByRole('region').first()).toBeVisible(); } },
  { name: 'hours', path: '/#/work?tab=hours', ready: async (page) => { await expect(page.getByRole('table')).toBeVisible(); } },
  { name: 'inbox', path: '/#/inbox', ready: async (page) => { await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); } },
  { name: 'search', path: '/#/search', ready: async (page) => { await page.locator('input[role="combobox"]').fill('a'); await expect(page.locator('[cmdk-root] [role="option"]').first()).toBeVisible(); } },
  { name: 'task-comments', path: '/#/projects/prj_001?tab=tasks&task=tsk_007', ready: async (page) => { await expect(page.getByRole('dialog')).toBeVisible(); } },
];

for (const width of [390, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`personal work screens at ${width}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await useArabic(page);
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await screen.ready(page);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `test-results/work/${width}-${lang}-${screen.name}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page);
      }
    });
  }
}

test('hours typed in a cell stay after a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/work?tab=hours');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(page).toHaveURL(/week=/);
  const cell = page.getByRole('textbox', { name: /^Hours for / }).first();
  await cell.fill('7.5');
  await cell.press('Enter');
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('textbox', { name: /^Hours for / }).first()).toHaveValue('7.5');
});

test('Ctrl+K opens search, and Enter opens the project', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('article').first()).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('input[role="combobox"]').fill('corniche');
  await expect(page.locator('[cmdk-root]').getByRole('option', { name: /Corniche Office Tower/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
});

test('Mark all read clears the Inbox badge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/inbox');
  const markAll = page.getByRole('button', { name: 'Mark all read' });
  if (await markAll.isVisible()) await markAll.click();
  await expect(page.getByRole('navigation').first().getByText(/items need action/)).toHaveCount(0);
});

test('Arabic search for a project word shows results or the no-results sentence', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.setViewportSize({ width: 1440, height: 900 });
  await useArabic(page);
  await page.goto('/#/search');
  await page.locator('input[role="combobox"]').fill('برج');
  await page.waitForTimeout(500);
  const hasOption = page.locator('[cmdk-root] [role="option"]').first();
  const noResults = page.locator('[role="status"], p').filter({ hasText: /لا |ما من|لم/ }).first();
  await expect(hasOption.or(noResults)).toBeVisible();
  expect(errors).toEqual([]);
});

test('no screen scrolls sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const paths = [
    '/#/', '/#/projects/prj_001', '/#/projects/prj_001?tab=tasks', '/#/projects/prj_001?tab=schedule', '/#/projects/prj_001?tab=files',
    '/#/projects/prj_001?tab=team', '/#/work', '/#/work?tab=hours', '/#/inbox', '/#/search', '/#/settings',
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect.soft(width, path).toBeLessThanOrEqual(390);
  }
});
