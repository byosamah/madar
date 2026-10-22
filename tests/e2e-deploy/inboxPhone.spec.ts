import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { goto, urlPattern } from './goto';

/** tests/e2e/inboxPhone.spec.ts on the remote build: the phone Inbox and the chat page (Direction D, track I). 390 px wide. */
test.use({ viewport: { width: 390, height: 560 } });

/** Presses a link of the list and waits for the chat page. */
async function openChat(page: Page, link = page.getByRole('list', { name: 'Chats' }).getByRole('link').first()) {
  await link.click();
  await expect(page).toHaveURL(urlPattern('/inbox/'));
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
}

test('Back from a chat keeps the scroll place of the list', async ({ page }) => {
  await goto(page, '/inbox');
  const list = page.getByRole('list', { name: 'Chats' });
  await expect(list.getByRole('link').first()).toBeVisible();
  const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  test.skip(room <= 0, 'the page does not scroll with the sample chats');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const placeBefore = await page.evaluate(() => window.scrollY);
  const visible = list.getByRole('link').filter({ visible: true });
  await openChat(page, visible.last());
  await page.getByRole('link', { name: 'Back to chats' }).click();
  await expect(page).toHaveURL(urlPattern('/inbox', { end: true }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(placeBefore - 120);
});

test('an open chat has no tab bar, and the box sits inside the screen', async ({ page }) => {
  await goto(page, '/inbox');
  await openChat(page);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
  const composer = await page.getByRole('textbox', { name: 'Message' }).boundingBox();
  expect(composer).not.toBeNull();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
  await page.getByRole('link', { name: 'Back to chats' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('the Notifications segment opens the notices under the title Inbox', async ({ page }) => {
  await goto(page, '/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await page.getByRole('radio', { name: /^Notifications/ }).click();
  await expect(page).toHaveURL(urlPattern('/notifications'));
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Notifications/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /^Chats/ }).click();
  await expect(page).toHaveURL(urlPattern('/inbox', { end: true }));
});

test('chips filter the list', async ({ page }) => {
  await goto(page, '/inbox');
  const list = page.getByRole('list', { name: 'Chats' });
  await expect(list.getByRole('link').first()).toBeVisible();
  const all = await list.getByRole('link').count();
  await page.getByRole('radio', { name: 'Projects' }).click();
  await expect(page.getByRole('radio', { name: 'Projects' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => list.getByRole('link').count()).toBeLessThanOrEqual(all);
  await page.getByRole('radio', { name: 'All' }).click();
  await expect.poll(() => list.getByRole('link').count()).toBe(all);
});

test('chips, segments, Back, Search and options are 44 px or more', async ({ page }) => {
  await goto(page, '/inbox');
  await expect(page.getByRole('list', { name: 'Chats' }).getByRole('link').first()).toBeVisible();
  for (const name of ['All', 'Projects', 'To-dos', 'People']) {
    const box = await page.getByRole('radio', { name, exact: true }).boundingBox();
    expect(box!.width, name).toBeGreaterThanOrEqual(44);
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }
  for (const name of [/^Chats/, /^Notifications/]) {
    const box = await page.getByRole('radio', { name }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await openChat(page);
  for (const [name, role] of [['Back to chats', 'link'], ['Search messages', 'link'], [/^Options for /, 'button']] as const) {
    const box = await page.getByRole(role, { name }).first().boundingBox();
    expect(box!.width, String(name)).toBeGreaterThanOrEqual(44);
    expect(box!.height, String(name)).toBeGreaterThanOrEqual(44);
  }
});
