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

/** Picks a person in Preview as and waits until the app shows that person: the open screen starts again when the person changes (V-22). */
async function previewAs(page: Page, label: string): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: /Preview as/ }).first().selectOption({ label });
  const person = label.split(' · ')[0];
  // Under 640 px there is no picture button: the Me hub shows the person as its first row, a link that starts with the name.
  if ((page.viewportSize()?.width ?? 1440) < 640) await expect(page.getByRole('link', { name: new RegExp(`^${person.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toBeVisible();
  else await expect(page.getByRole('button', { name: person, exact: true })).toBeVisible();
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
  // The Tasks page is /#/work. The link "See all my to-dos" sits under the Today panel. On a day with nothing due today or past
  // due, that panel is "Coming up" (owner, 2026-10-07), so the test takes either name: it failed on such a day (2026-10-12).
  await page.goto('/#/');
  await expect(page.getByRole('region', { name: /^(Today|Coming up)$/ })).toBeVisible();
  await tabTo(page, (text) => text === 'See all my to-dos');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('region').first()).toBeVisible();
});

test('Leader review: approve from Notifications with two steps', async ({ page }) => {
  // Setup: Sara sends a task to review, which puts a review notice in Faisal's Inbox.
  await previewAs(page, 'Sara Al-Qahtani · Member');
  await page.goto('/#/projects/prj_001?tab=tasks');
  await page.getByRole('checkbox', { name: 'Complete Civil Defense drawings' }).click();
  await expect(page.getByText('Sent to review. The leader checks it next.')).toBeVisible();
  await previewAs(page, 'Faisal Al-Harbi · Leader');
  // The two steps: reach Approve, press Enter.
  await page.goto('/#/notifications');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  // The list loads after the heading shows, so wait for the first Approve button before counting.
  await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeVisible();
  const before = await page.getByRole('button', { name: 'Approve' }).count();
  expect(before).toBeGreaterThan(0);
  // Each Approve button names its task, for example Approve “Civil Defense drawings” (audit 2026-10-03, BRW-5).
  await tabTo(page, (text, role) => role === 'button' && text.startsWith('Approve'));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(before - 1);
});
