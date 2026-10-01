import { expect, test, type Page } from '@playwright/test';

/** Presses Tab until the focused element matches, like a keyboard-only person. */
async function tabTo(page: Page, matches: (text: string, role: string | null) => boolean, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    const found = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { text: (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim(), role: el?.getAttribute('role') ?? el?.tagName.toLowerCase() ?? null };
    });
    if (matches(found.text, found.role)) return;
  }
  throw new Error('The keyboard did not reach the control.');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('Admin overview: the at-risk and late projects in one step from the first screen', async ({ page }) => {
  // The dashboard shows "At risk or late" as one of three numbers. One keypress opens the list behind it.
  await page.goto('/#/dashboard');
  await expect(page.getByRole('link', { name: /At risk or late/ })).toBeVisible();
  await tabTo(page, (text, role) => role === 'a' && text.startsWith('At risk or late'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/projects\?filter=at_risk/);
  await expect(page.getByRole('list', { name: 'Projects' }).getByRole('listitem')).toHaveCount(5);
});

test("Member daily work: today's tasks with one step from any screen", async ({ page }) => {
  // The Tasks page is /#/work. The link "See all my tasks" sits under the Today panel.
  await page.goto('/#/');
  await expect(page.getByRole('region', { name: 'Today' })).toBeVisible();
  await tabTo(page, (text) => text === 'See all my tasks');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('region').first()).toBeVisible();
});

test('Leader review: approve from Notifications with two steps', async ({ page }) => {
  // Setup: Sara sends a task to review, which puts a review notice in Faisal's Inbox.
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: /Preview as/ }).first().selectOption({ label: 'Sara Al-Qahtani · Member' });
  await page.goto('/#/projects/prj_001?tab=tasks');
  await page.getByRole('checkbox', { name: 'Complete Civil Defense drawings' }).click();
  await expect(page.getByText('Sent to review. The leader checks it next.')).toBeVisible();
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: /Preview as/ }).first().selectOption({ label: 'Faisal Al-Harbi · Leader' });
  // The two steps: reach Approve, press Enter.
  await page.goto('/#/notifications');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  // The list loads after the heading shows, so wait for the first Approve button before counting.
  await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeVisible();
  const before = await page.getByRole('button', { name: 'Approve' }).count();
  expect(before).toBeGreaterThan(0);
  await tabTo(page, (text) => text === 'Approve');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(before - 1);
});
