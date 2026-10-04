import { expect, test } from './fixtures';
import { goto } from './goto';

/** tests/e2e/polish.spec.ts on the remote build (task X2). */

test('the project name grows from its row into the header and the row returns on back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/projects');
  const rows = page.getByRole('list', { name: 'Projects' }).getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  const rowName = await rows.first().locator('span.truncate').first().boundingBox();
  await rows.first().getByRole('link').click();
  const name = page.locator('header h1 > span');
  await expect(name).toBeVisible();
  await page.waitForTimeout(700);
  const settled = await name.boundingBox();
  expect(rowName && settled).toBeTruthy();
  // The name ends larger than in its row: it grew out of the row. On the live copy the project loads in about 0.6 s, so the
  // growth ends in the loading header before the h1 shows, and a mid-move sample is not possible here (deploy suite,
  // 2026-10-04). tests/e2e/polish.spec.ts keeps the mid-move check on the prototype.
  expect(rowName!.width).toBeLessThan(settled!.width);
  await page.goBack();
  await expect(rows.first()).toBeVisible();
});
