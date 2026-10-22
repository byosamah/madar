import { expect, test, type Page } from '@playwright/test';

// A phone with touch: the task opens as a blocking bottom sheet (audit 2026-10-03, V-11).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Opens Stair details, posts a comment, deletes it, and returns the sheet with the "Comment deleted." toast on screen. */
async function deleteAComment(page: Page, text: string) {
  await page.goto('/#/projects/prj_001?tab=tasks&task=tsk_007');
  const sheet = page.getByRole('dialog', { name: 'Stair details' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('tab', { name: /Conversation/ }).click();
  // Direction D: the comment box is docked at the bottom of the sheet, so it sits within the last 160 px of it.
  const box = await sheet.getByRole('textbox', { name: 'Add a comment' }).boundingBox();
  const frame = await sheet.boundingBox();
  expect(frame!.y + frame!.height - (box!.y + box!.height)).toBeLessThan(160);
  await sheet.getByRole('textbox', { name: 'Add a comment' }).fill(text);
  await sheet.getByRole('button', { name: 'Send' }).click();
  await expect(sheet.getByText(text)).toBeVisible();
  // The new comment shows above the box. Before, it sat under the box, and a press on its "..." scrolled the sheet and closed the menu.
  await expect.poll(() => sheet.evaluate((root, words) => {
    const dock = root.querySelector('[data-comment-dock]')?.getBoundingClientRect();
    const mine = [...root.querySelectorAll('li')].find((item) => item.textContent?.includes(words))?.getBoundingClientRect();
    return Boolean(dock && mine && mine.bottom <= dock.top + 1);
  }, text)).toBe(true);
  // The comment shows at once while it goes (instant send), and gets its menu when it is saved: wait for the menu of this comment.
  await sheet.getByRole('listitem').filter({ hasText: text }).getByRole('button', { name: 'Actions for this comment' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('Comment deleted.')).toBeVisible();
  await expect(sheet.getByText(text)).toHaveCount(0);
  return sheet;
}

for (const press of ['click', 'tap'] as const) {
  test(`a ${press} on Undo in a toast keeps the task sheet open on a phone`, async ({ page }) => {
    const sheet = await deleteAComment(page, `Undo by ${press}`);
    const undo = page.getByRole('button', { name: 'Undo' });
    if (press === 'tap') await undo.tap();
    else await undo.click();
    await expect(sheet.getByText(`Undo by ${press}`)).toBeVisible();
    await page.waitForTimeout(500);
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/task=tsk_007/);
  });
}

test('a tap outside the task sheet on a phone still closes it', async ({ page }) => {
  await page.goto('/#/projects/prj_001?tab=tasks&task=tsk_007');
  const sheet = page.getByRole('dialog', { name: 'Stair details' });
  await expect(sheet).toBeVisible();
  // The sheet leaves a strip of the page at the top: a tap there is a tap outside.
  await page.touchscreen.tap(195, 20);
  await expect(sheet).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=tsk_007/);
});
