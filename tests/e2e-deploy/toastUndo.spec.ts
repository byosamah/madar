import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { goto } from './goto';

/** tests/e2e/toastUndo.spec.ts on the remote build (task X2). */

// A phone with touch: the task opens as a blocking bottom sheet (audit 2026-10-03, V-11).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Opens Stair details, posts a comment, deletes it, and returns the sheet with the "Comment deleted." toast on screen. */
async function deleteAComment(page: Page, text: string) {
  await goto(page, '/projects/prj_001?tab=tasks&task=tsk_007');
  const sheet = page.getByRole('dialog', { name: 'Stair details' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('tab', { name: /Conversation/ }).click();
  await sheet.getByRole('textbox', { name: 'Add a comment' }).fill(text);
  await sheet.getByRole('button', { name: 'Send' }).click();
  await expect(sheet.getByText(text)).toBeVisible();
  // The office keeps the comments of earlier tests, and a restored comment may not be the last one: pick the menu of this one.
  await sheet.getByRole('listitem').filter({ hasText: text }).getByRole('button', { name: 'Actions for this comment' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('Comment deleted.')).toBeVisible();
  await expect(sheet.getByText(text)).toHaveCount(0);
  return sheet;
}

for (const press of ['click', 'tap'] as const) {
  test(`a ${press} on Undo in a toast keeps the task sheet open on a phone`, async ({ page }) => {
    // A text of its own for each run, so a comment of an earlier run on the same office never matches.
    const text = `Undo by ${press} ${Date.now()}`;
    const sheet = await deleteAComment(page, text);
    const undo = page.getByRole('button', { name: 'Undo' });
    if (press === 'tap') await undo.tap();
    else await undo.click();
    await expect(sheet.getByText(text)).toBeVisible();
    await page.waitForTimeout(500);
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/task=tsk_007/);
  });
}

test('a tap outside the task sheet on a phone still closes it', async ({ page }) => {
  await goto(page, '/projects/prj_001?tab=tasks&task=tsk_007');
  const sheet = page.getByRole('dialog', { name: 'Stair details' });
  await expect(sheet).toBeVisible();
  // The sheet leaves a strip of the page at the top: a tap there is a tap outside.
  await page.touchscreen.tap(195, 20);
  await expect(sheet).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=tsk_007/);
});
