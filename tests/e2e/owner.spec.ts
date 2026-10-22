import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Checks for the owner changes of 2026-10-01: the phone tab bar, chat Inbox, bell, Overview, Pause and Meeting view. */

/**
 * Preview as answers after the fake network delay. The open screen starts again when the new person arrives (audit 2026-10-03,
 * V-22), so the helper waits for the person button to show the new name. Without the wait, the next screen loaded as the person
 * before and then started again under the test: an open menu closed before its item could be pressed.
 */
async function previewAs(page: Page, label: string): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: /Preview as/ }).first().selectOption({ label });
  await expect(page.getByRole('button', { name: label.split(' · ')[0], exact: true })).toBeVisible();
}

test('the phone tab bar has exactly four tabs with words and no sideways scroll at 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/');
  const pill = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(pill).toBeVisible();
  await expect(pill.getByRole('link')).toHaveCount(4);
  for (const name of ['Today', 'Inbox', 'Work', 'Me']) await expect(pill.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  // Search and the bell sit in the top row on a phone, outside the tab bar.
  await expect(page.getByRole('link', { name: 'Search' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Notifications/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('the chat Inbox sends a message and shows it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/inbox');
  const list = page.getByRole('list', { name: 'Chats' });
  await expect(list.getByRole('link').first()).toBeVisible();
  await list.getByRole('link').first().click();
  const log = page.getByRole('log', { name: 'Messages' });
  await expect(log).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message' });
  await composer.fill('Site visit moved to Thursday.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(log.getByText('Site visit moved to Thursday.')).toBeVisible();
  await expect(composer).toHaveValue('');
  // Enter sends too.
  await composer.fill('Second note by keyboard.');
  await composer.press('Enter');
  await expect(log.getByText('Second note by keyboard.')).toBeVisible();
});

test('a phone opens a chat on its own page and goes back to the list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/inbox');
  const list = page.getByRole('list', { name: 'Chats' });
  await expect(list.getByRole('link').first()).toBeVisible();
  await list.getByRole('link').first().click();
  await expect(page).toHaveURL(/#\/inbox\/.+/);
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to chats' }).click();
  await expect(page).toHaveURL(/#\/inbox$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('New message starts a direct chat', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/inbox');
  await page.getByRole('button', { name: 'New message' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pick a person' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button').filter({ hasText: /\w/ }).filter({ hasNotText: 'New group' }).first().click();
  await expect(page).toHaveURL(/#\/inbox\/cnv_/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
});

test('the bell opens the notifications page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /^Notifications/ }).click();
  await expect(page).toHaveURL(/#\/notifications/);
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
});

test('the project Overview shows where the project stands', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects/prj_001');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
  for (const name of ['Where the project stands', 'Needs attention', 'Who is doing what', 'Coming up', 'Latest update', 'About']) {
    await expect(page.getByRole('region', { name }), name).toBeVisible();
  }
  const tabs = page.getByRole('tablist', { name: 'Project sections' }).getByRole('tab');
  await expect(tabs).toHaveText(['Overview', 'To-dos', 'Activity', 'Tracker', 'Schedule', 'Files & Links', 'Team']);
});

test('a leader pauses and resumes a project', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await previewAs(page, 'Faisal Al-Harbi · Leader');
  await page.goto('/#/projects/prj_001');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Pause project' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pause this project?' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Reason').fill('Waiting for the client to sign the revised brief.');
  await sheet.getByRole('button', { name: 'Pause project' }).click();
  const paused = page.getByRole('region', { name: 'Paused' });
  await expect(paused).toBeVisible();
  await expect(paused.getByText('Waiting for the client to sign the revised brief.')).toBeVisible();
  await paused.getByRole('button', { name: 'Resume project' }).click();
  await expect(page.getByRole('region', { name: 'Paused' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Pause project' })).toBeVisible();
});

test('the Meeting view opens from the Dashboard and Escape returns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: 'Meeting view' }).or(page.getByRole('link', { name: 'Meeting view' })).first().click();
  await expect(page).toHaveURL(/#\/dashboard\/meeting/);
  await expect(page.getByRole('main', { name: 'Meeting view' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByRole('link', { name: /At risk or late/ })).toBeVisible();
});

const AXE_ROUTES: [string, string][] = [
  ['inbox', '/#/inbox'],
  ['notifications', '/#/notifications'],
  ['admin', '/#/admin'],
  ['meeting view', '/#/dashboard/meeting'],
  ['project overview', '/#/projects/prj_001'],
];

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds no serious problem on the new screens in ${theme} mode`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    for (const [name, path] of AXE_ROUTES) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('h1, main[aria-label]').first()).toBeVisible();
      await page.waitForTimeout(1200);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect.soft(serious.map((v) => `${name}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
  });
}
