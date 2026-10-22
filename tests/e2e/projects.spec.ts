import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DESK_TABS = ['overview', 'tasks', 'activity', 'tracker', 'schedule', 'files', 'team'];
// A phone has five tabs. The last three entries open a page of More (phone D).
const PHONE_TABS = ['overview', 'tasks', 'tracker', 'files', 'more', 'activity', 'schedule', 'team'];

async function expectNoSeriousA11yIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  // Soft: the sweep goes on to the next tab, so every problem and every screenshot shows in one run.
  expect.soft(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** The task Filter dialog holds the View choice. Pick Board, then close the dialog. */
async function chooseBoard(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('radio', { name: 'Board' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Filter' })).toHaveCount(0);
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
      for (const tab of width < 640 ? PHONE_TABS : DESK_TABS) {
        await page.goto(`/#/projects/prj_001?tab=${tab}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `test-results/projects/${width}-${lang}-${tab}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page);
      }
    });
  }
}

test('the project page on a phone has five tabs, one navy button and no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/projects/prj_001');
  await expect(page.getByRole('tablist', { name: 'Project sections' }).getByRole('tab')).toHaveText(['Overview', 'To-dos', 'Tracker', 'Files & Links', 'More']);
  await expect(page.locator('main .signature')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const tab of ['tasks', 'tracker', 'files', 'more', 'schedule']) {
    await page.goto(`/#/projects/prj_001?tab=${tab}`);
    await expect(page.getByRole('tablist', { name: 'Project sections' })).toBeVisible();
    // One navy button on each tab.
    await expect(page.locator('main .signature')).toHaveCount(1);
  }
});

test('the tab row stays at the top while the page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/projects/prj_001');
  const row = page.getByRole('tablist', { name: 'Project sections' });
  await expect(row).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(300);
  // The safe area is 0 in this browser, so the sticky row sits at the top edge.
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeLessThanOrEqual(1);
});

test('five tab words fit in 360 px in Arabic, with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await useArabic(page);
  for (const tab of PHONE_TABS) {
    await page.goto(`/#/projects/prj_001?tab=${tab}`);
    // The screen is Arabic, so the tab row has its Arabic name.
    const tabs = page.getByRole('tablist', { name: 'أقسام المشروع' }).getByRole('tab');
    await expect(tabs).toHaveCount(5);
    for (const box of await tabs.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(360);
    }
    // No tab word is cut: a word that does not fit would be wider than its tab.
    expect(await tabs.evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth).length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});

test('Back from the project chat returns to the project tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/projects/prj_001?tab=files');
  await page.getByRole('link', { name: 'Project chat' }).click();
  await expect(page).toHaveURL(/#\/inbox\//);
  await page.goBack();
  await expect(page).toHaveURL(/#\/projects\/prj_001\?tab=files/);
});

test('the projects list is one column of rows, with no cards and no grid switch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects');
  const rows = page.getByRole('list', { name: 'Projects' }).getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(4);
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /Grid|List/ })).toHaveCount(0);
  const tops = await rows.evaluateAll((items) => items.slice(0, 5).map((item) => Math.round(item.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(5);
});

test('the Filter button opens one dialog with every choice, and a choice changes the rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects');
  const rows = page.getByRole('list', { name: 'Projects' }).getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Filter' });
  await expect(dialog).toBeVisible();
  for (const name of ['All', 'My projects', 'Needs attention']) await expect(dialog.getByRole('radio', { name })).toBeVisible();
  for (const name of ['Stage', 'Status', 'Sort']) await expect(dialog.getByRole('combobox', { name })).toBeVisible();
  await dialog.getByRole('radio', { name: 'Needs attention' }).click();
  await expect(rows).toHaveCount(5);
  expect(before).toBeGreaterThan(5);
  await expect(page.getByRole('button', { name: 'Filter, 1 active' })).toBeVisible();
});

test('an old filter link redirects to the Projects screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/?filter=at_risk');
  await expect(page).toHaveURL(/#\/projects\?filter=at_risk/);
  await expect(page.getByRole('list', { name: 'Projects' }).getByRole('listitem')).toHaveCount(5);
});

test('a person creates a project and lands on it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects');
  await page.getByRole('button', { name: 'New Project' }).click();
  const sheet = page.getByRole('dialog', { name: 'New Project' });
  await sheet.getByLabel('Name', { exact: true }).fill('Harbour Gate Offices');
  // A new project needs its code parts (owner, 2026-10-05).
  await sheet.getByLabel('Client initials').fill('HGO');
  await sheet.getByLabel('Classification').selectOption('COM');
  await sheet.getByLabel('Building type').fill('Offices');
  // The sample office has two sub-companies, and a new project names one: one tap on a logo choice (PRJ-17).
  await sheet.getByRole('radiogroup', { name: 'Sub-company' }).getByRole('radio').first().click();
  await sheet.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Harbour Gate Offices' })).toBeVisible();
});

test('the New Project sheet is a bottom sheet on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/projects');
  await page.getByRole('button', { name: 'New Project' }).click();
  const box = await page.getByRole('dialog', { name: 'New Project' }).boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(840);
});

test('the board moves a card with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects/prj_001?tab=tasks');
  await chooseBoard(page);
  await page.getByRole('button', { name: 'Drag Specifications draft' }).focus();
  await page.keyboard.press('Space');
  // The keyboard drag reads the column positions after the lift. Wait for the drop target to light up before each move.
  await expect(page.getByRole('region', { name: 'To do: 4' })).toHaveClass(/bg-fill-strong/);
  await page.waitForTimeout(500); // the lift animation finishes before the arrow key counts
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('region', { name: 'In progress: 2' })).toHaveClass(/bg-fill-strong/);
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', { name: 'In progress: 3' }).getByText('Specifications draft')).toBeVisible({ timeout: 15_000 }); // the drop settles slower when four workers share the machine
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
