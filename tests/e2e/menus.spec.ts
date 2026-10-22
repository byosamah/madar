import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOTS = '/private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/shots/plan2-fix';

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
  await page.goto('/#/projects/prj_001');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
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
  await page.goto('/#/projects/prj_001?tab=tasks');
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('radio', { name: 'Board' }).check();
  await page.keyboard.press('Escape');
  const done = page.getByRole('region', { name: /^Done: \d+/ });
  await expect(done).toBeVisible();
  const cards = done.getByRole('listitem');
  expect(await cards.count(), 'the Done column has a card in the sample data').toBeGreaterThan(0);
  const last = cards.last();
  await last.scrollIntoViewIfNeeded();
  await last.getByRole('button', { name: /^Move / }).click();
  const menu = page.getByRole('menu', { name: /^Move / });
  await page.waitForTimeout(400);
  await expectEveryItemReachable(page, menu);
  await page.screenshot({ path: `${SHOTS}/board-move-menu-1440.png` });
  await page.keyboard.press('Escape');
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`a person outside the team sees the task panel as plain text at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // Preview as is on the Me hub on a phone (Direction D) and on the Settings page from 640 px, where /me sends the person.
    await page.goto('/#/me');
    const select = page.getByLabel('Preview as').locator('visible=true').first();
    const value = await select.locator('option', { hasText: 'Omar Haddad' }).getAttribute('value');
    await select.selectOption(value!);
    await page.goto('/#/projects/prj_001?tab=tasks');
    await page.getByText('Toilet details').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(500);
    // Direction D: on a phone the panel of a person outside the team has no control at all, only the read only line.
    if (width === 390) {
      await expect(page.getByRole('dialog').locator('select, textarea, [role="switch"], input:not([type="hidden"])')).toHaveCount(0);
      await expect(page.getByRole('dialog').getByText(/You can view this to-do/)).toBeVisible();
    }
    await page.screenshot({ path: `${SHOTS}/task-sheet-readonly-${width}.png` });
  });
}
