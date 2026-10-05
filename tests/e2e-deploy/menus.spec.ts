import type { Locator, Page } from '@playwright/test';
import { expect, skipPreviewAs, test } from './fixtures';
import { goto } from './goto';
import { batchAs, openMenu, runId } from './steps';

/** tests/e2e/menus.spec.ts on the remote build (task X2). */

const SHOTS = 'test-results/e2e-deploy-shots/menus';

/** Every item must be visible, inside the viewport, and the top element at its centre. */
async function expectEveryItemReachable(page: Page, menu: Locator): Promise<string[]> {
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  const labels: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const item = items.nth(i);
    const label = ((await item.textContent()) ?? '').trim();
    labels.push(label);
    await expect(item, `${label} is visible`).toBeVisible();
    const result = await item.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        inside: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
        hit: !!hit && (hit === el || el.contains(hit)),
        box: [r.left, r.top, r.right, r.bottom].map(Math.round),
        vp: [window.innerWidth, window.innerHeight],
      };
    });
    expect(result.inside, `"${label}" is inside the viewport (box ${result.box}, viewport ${result.vp})`).toBe(true);
    expect(result.hit, `"${label}" is the top element at its centre`).toBe(true);
  }
  return labels;
}

async function openHeaderMenu(page: Page, width: number, height: number): Promise<Locator> {
  await page.setViewportSize({ width, height });
  await goto(page, '/projects/prj_001');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
  await openMenu(page.getByRole('button', { name: 'More actions' }));
  const menu = page.getByRole('menu', { name: 'More actions' });
  await expect(menu).toBeVisible();
  await page.waitForTimeout(400); // the open spring settles
  return menu;
}

test('header menu reaches every item at 1440', async ({ page }) => {
  const menu = await openHeaderMenu(page, 1440, 900);
  const labels = await expectEveryItemReachable(page, menu);
  expect(labels[labels.length - 1]).toBe('Delete project');
  await page.screenshot({ path: `${SHOTS}/header-menu-1440.png` });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('header menu reaches every item at 390', async ({ page }) => {
  const menu = await openHeaderMenu(page, 390, 844);
  const labels = await expectEveryItemReachable(page, menu);
  expect(labels).toContain('Delete project');
  await page.screenshot({ path: `${SHOTS}/header-menu-390.png` });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('board Move menu on the last Done card reaches every item', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/projects/prj_001?tab=tasks');
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('radio', { name: 'Board' }).check();
  await page.keyboard.press('Escape');
  const done = page.getByRole('region', { name: /^Done: \d+/ });
  await expect(done).toBeVisible();
  const cards = done.getByRole('listitem');
  expect(await cards.count(), 'the Done column has a card in the sample data').toBeGreaterThan(0);
  const last = cards.last();
  await openMenu(last.getByRole('button', { name: /^Move / }));
  const menu = page.getByRole('menu', { name: /^Move / });
  await page.waitForTimeout(400);
  await expectEveryItemReachable(page, menu);
  await page.screenshot({ path: `${SHOTS}/board-move-menu-1440.png` });
  await page.keyboard.press('Escape');
});

test('a "…" menu low in a long list stays open at 390 (Admin, People, about 20 people)', async ({ page }) => {
  // The steps of the whole-product check after wave 4: a plain click scrolls to the last person's button, the page scroll
  // closes the menu that the click opened, and aria-expanded stays false. openMenu waits for the scroll to settle first.
  await page.setViewportSize({ width: 390, height: 844 });
  const people = page.getByRole('region', { name: 'People', exact: true }).getByRole('button', { name: /^Actions for / });
  await goto(page, '/admin/people');
  await expect(people.first()).toBeVisible();
  const missing = 20 - (await people.count());
  if (missing > 0) {
    const run = runId();
    const results = await batchAs(page, '/admin', Array.from({ length: missing }, (_, n) => ({
      name: 'users.create', input: { name: `Menu Person ${n + 1} ${run}`, email: `menu-${run}-${n + 1}@madar.test`, discipline: 'Architect' },
    })));
    expect(results.map((r) => r.ok)).toEqual(Array.from({ length: missing }, () => true));
    await goto(page, '/admin/people');
  }
  await expect.poll(() => people.count()).toBeGreaterThanOrEqual(20);
  const last = people.last();
  const label = (await last.getAttribute('aria-label')) ?? '';
  await openMenu(last);
  await expect(page.getByRole('menu', { name: label })).toBeVisible();
  await page.waitForTimeout(400);
  await expect(last).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: `${SHOTS}/people-menu-last-390.png` });
  await page.keyboard.press('Escape');
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`a person outside the team sees the task panel as plain text at ${width}`, async ({ page }) => {
    // Omar has no test account: this check needs Preview as.
    skipPreviewAs();
    await page.setViewportSize({ width, height });
    await goto(page, '/settings');
    const select = page.getByLabel('Preview as').locator('visible=true').first();
    const value = await select.locator('option', { hasText: 'Omar Haddad' }).getAttribute('value');
    await select.selectOption(value!);
    await goto(page, '/projects/prj_001?tab=tasks');
    await page.getByText('Toilet details').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/task-sheet-readonly-${width}.png` });
  });
}
