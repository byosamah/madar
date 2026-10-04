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
  const early = await name.boundingBox();
  await page.waitForTimeout(700);
  const settled = await name.boundingBox();
  expect(rowName && early && settled).toBeTruthy();
  // Mid-move, the name is still smaller than its settled size: it grew out of the row.
  expect(early!.width).toBeLessThan(settled!.width);
  await page.goBack();
  await expect(rows.first()).toBeVisible();
});
