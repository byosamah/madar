import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { asRole, expect, PERSON_OF, test } from './fixtures';
import { goto, settle, REMOTE, urlPattern } from './goto';
import { openMenu } from './steps';

/** tests/e2e/owner.spec.ts on the remote build (task X2): the phone tab bar, chat Inbox, bell, Overview, Pause and Meeting view. */

/** Picks a person in Preview as and waits until the app shows that person (prototype only). */
async function previewAs(page: Page, label: string): Promise<void> {
  await goto(page, '/settings');
  await page.getByRole('combobox', { name: /Preview as/ }).first().selectOption({ label });
  const person = label.split(' · ')[0];
  // Under 640 px there is no picture button: the Me hub shows the person as its first row, a link that starts with the name.
  if ((page.viewportSize()?.width ?? 1440) < 640) await expect(page.getByRole('link', { name: new RegExp(`^${person.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toBeVisible();
  else await expect(page.getByRole('button', { name: person, exact: true })).toBeVisible();
}

test('the phone tab bar has exactly four tabs with words and no sideways scroll at 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await goto(page, '/');
  const pill = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(pill).toBeVisible();
  await expect(pill.getByRole('link')).toHaveCount(4);
  for (const name of ['Today', 'Inbox', 'Work', 'Me']) await expect(pill.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Search the whole office' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Notifications/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('the chat Inbox sends a message and shows it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/inbox');
  const list = page.getByRole('list', { name: 'Chats' });
  await expect(list.getByRole('link').first()).toBeVisible();
  await list.getByRole('link').first().click();
  const log = page.getByRole('log', { name: 'Messages' });
  await expect(log).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message' });
  const first = `Site visit moved to Thursday. ${Date.now()}`;
  await composer.fill(first);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(log.getByText(first)).toBeVisible();
  await expect(composer).toHaveValue('');
  const second = `Second note by keyboard. ${Date.now()}`;
  await composer.fill(second);
  await composer.press('Enter');
  await expect(log.getByText(second)).toBeVisible();
});

test('a phone opens a chat on its own page and goes back to the list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await goto(page, '/inbox');
  const list = page.getByRole('list', { name: 'Chats' });
  await expect(list.getByRole('link').first()).toBeVisible();
  await list.getByRole('link').first().click();
  await expect(page).toHaveURL(urlPattern('/inbox/cnv_'));
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to chats' }).click();
  await expect(page).toHaveURL(urlPattern('/inbox', { end: true }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('New message starts a direct chat', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/inbox');
  await page.getByRole('button', { name: 'New message' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pick a person' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button').filter({ hasText: /\w/ }).filter({ hasNotText: 'New group' }).first().click();
  await expect(page).toHaveURL(urlPattern('/inbox/cnv_'));
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
});

test('the bell opens the notifications page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /^Notifications/ }).click();
  await expect(page).toHaveURL(urlPattern('/notifications'));
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
});

test('the project Overview shows where the project stands', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/projects/prj_001');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
  for (const name of ['Where the project stands', 'Needs attention', 'Who is doing what', 'Coming up', 'Latest update', 'About']) {
    await expect(page.getByRole('region', { name }), name).toBeVisible();
  }
  const tabs = page.getByRole('tablist', { name: 'Project sections' }).getByRole('tab');
  await expect(tabs).toHaveText(['Overview', 'To-dos', 'Activity', 'Tracker', 'Schedule', 'Files & Links', 'Team']);
});

test.describe('as the leader of the project', () => {
  // Faisal leads Corniche Office Tower. In the remote build he is the member account; the prototype picks him in Preview as.
  if (REMOTE) test.use(asRole('member'));

  test('a leader pauses and resumes a project', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (REMOTE) {
      await goto(page, '/');
      await expect(page.getByRole('button', { name: PERSON_OF.member, exact: true })).toBeVisible();
    } else {
      await previewAs(page, 'Faisal Al-Harbi · Leader');
    }
    await goto(page, '/projects/prj_001');
    await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
    await openMenu(page.getByRole('button', { name: 'More actions' }));
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
    await openMenu(page.getByRole('button', { name: 'More actions' }));
    await expect(page.getByRole('menuitem', { name: 'Pause project' })).toBeVisible();
  });
});

test('the Meeting view opens from the Dashboard and Escape returns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/dashboard');
  await page.getByRole('button', { name: 'Meeting view' }).or(page.getByRole('link', { name: 'Meeting view' })).first().click();
  await expect(page).toHaveURL(urlPattern('/dashboard/meeting'));
  await expect(page.getByRole('main', { name: 'Meeting view' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(urlPattern('/dashboard', { end: true }));
  await expect(page.getByRole('link', { name: /At risk or late/ })).toBeVisible();
});

const AXE_ROUTES: [string, string][] = [
  ['inbox', '/inbox'],
  ['notifications', '/notifications'],
  ['admin', '/admin'],
  ['meeting view', '/dashboard/meeting'],
  ['project overview', '/projects/prj_001'],
];

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds no serious problem on the new screens in ${theme} mode`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    for (const [name, route] of AXE_ROUTES) {
      await goto(page, route);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('h1, main[aria-label]').first()).toBeVisible();
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect.soft(serious.map((v) => `${name}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
  });
}
