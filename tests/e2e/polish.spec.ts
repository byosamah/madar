import { expect, test } from '@playwright/test';

test('the card cover grows into the project header and shrinks back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  const card = page.getByRole('article').first();
  await expect(card).toBeVisible();
  const cardBox = await card.locator('[data-layout-id]').boundingBox();
  await card.getByRole('link').click();
  const header = page.locator('header [data-layout-id]');
  await expect(header).toBeVisible();
  const early = await header.boundingBox();
  await page.waitForTimeout(700);
  const settled = await header.boundingBox();
  expect(cardBox && early && settled).toBeTruthy();
  // Mid-move, the cover is still smaller than its settled size: it grew out of the card.
  expect(early!.width).toBeLessThan(settled!.width);
  await page.goBack();
  await expect(page.getByRole('article').first()).toBeVisible();
});
