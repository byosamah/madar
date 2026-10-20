import type { Page } from '@playwright/test';
import { expect, skipPreviewAs, test } from './fixtures';
import { goto, urlPattern } from './goto';

/** tests/e2e/acceptance.spec.ts on the remote build (task X2). */

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

/** Picks a person in Preview as and waits until the app shows that person (prototype only). */
async function previewAs(page: Page, label: string): Promise<void> {
  await goto(page, '/settings');
  await page.getByRole('combobox', { name: /Preview as/ }).first().selectOption({ label });
  await expect(page.getByRole('button', { name: label.split(' · ')[0], exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('Admin overview: the at-risk and late projects in one step from the first screen', async ({ page }) => {
  await goto(page, '/dashboard');
  await expect(page.getByRole('link', { name: /At risk or late/ })).toBeVisible();
  await tabTo(page, (text, role) => role === 'a' && text.startsWith('At risk or late'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(urlPattern('/projects?filter=at_risk'));
  await expect(page.getByRole('list', { name: 'Projects' }).getByRole('listitem')).toHaveCount(5);
});

test("Member daily work: today's tasks with one step from any screen", async ({ page }) => {
  await goto(page, '/');
  // On a day with nothing due today or past due, that panel is "Coming up" (owner, 2026-10-07), so the test takes either
  // name, like the prototype smoke test: it failed on such a day (Friday 2026-10-16).
  await expect(page.getByRole('region', { name: /^(Today|Coming up)$/ })).toBeVisible();
  await tabTo(page, (text) => text === 'See all my to-dos');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('region').first()).toBeVisible();
});

test('Leader review: approve from Notifications with two steps', async ({ page }) => {
  // Sara (a member with no test account) sends the task to review first, so this check needs Preview as.
  skipPreviewAs();
  await previewAs(page, 'Sara Al-Qahtani · Member');
  await goto(page, '/projects/prj_001?tab=tasks');
  await page.getByRole('checkbox', { name: 'Complete Civil Defense drawings' }).click();
  await expect(page.getByText('Sent to review. The leader checks it next.')).toBeVisible();
  await previewAs(page, 'Faisal Al-Harbi · Leader');
  await goto(page, '/notifications');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeVisible();
  const before = await page.getByRole('button', { name: 'Approve' }).count();
  expect(before).toBeGreaterThan(0);
  await tabTo(page, (text, role) => role === 'button' && text.startsWith('Approve'));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(before - 1);
});
