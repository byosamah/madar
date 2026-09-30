import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TABS = ['overview', 'tasks', 'schedule', 'files', 'team'];

async function expectNoSeriousA11yIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  // Soft: the sweep goes on to the next tab, so every problem and every screenshot shows in one run.
  expect.soft(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function useArabic(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

for (const width of [390, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`project tabs at ${width}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await useArabic(page);
      for (const tab of TABS) {
        await page.goto(`/#/projects/prj_001?tab=${tab}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `test-results/projects/${width}-${lang}-${tab}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page);
      }
    });
  }
}

test('the grid shows four columns at 1440 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('article').first()).toBeVisible();
  const tops = await page.getByRole('article').evaluateAll((cards) => cards.slice(0, 5).map((card) => Math.round(card.getBoundingClientRect().top)));
  expect(new Set(tops.slice(0, 4)).size).toBe(1);
  expect(tops[4]).toBeGreaterThan(tops[0]);
});

test('a person creates a project and lands on it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByRole('button', { name: 'New Project' }).click();
  const sheet = page.getByRole('dialog', { name: 'New Project' });
  await sheet.getByLabel('Name', { exact: true }).fill('Harbour Gate Offices');
  await sheet.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Harbour Gate Offices' })).toBeVisible();
});

test('the New Project sheet is a bottom sheet on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/');
  await page.getByRole('button', { name: 'New Project' }).click();
  const box = await page.getByRole('dialog', { name: 'New Project' }).boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(840);
});

test('the board moves a card with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects/prj_001?tab=tasks');
  await page.getByRole('radio', { name: 'Board' }).click();
  await page.getByRole('button', { name: 'Drag Specifications draft' }).focus();
  await page.keyboard.press('Space');
  // The keyboard drag reads the column positions after the lift. Wait for the drop target to light up before each move.
  await expect(page.getByRole('region', { name: 'To do: 4' })).toHaveClass(/bg-fill-strong/);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('region', { name: 'In progress: 2' })).toHaveClass(/bg-fill-strong/);
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', { name: 'In progress: 3' }).getByText('Specifications draft')).toBeVisible();
});

test('the schedule changes a stage end by a drag', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects/prj_001?tab=schedule');
  const handle = page.getByRole('slider', { name: 'End of Permits' });
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText('Dates changed.')).toBeVisible();
});
