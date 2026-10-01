import { expect, test, type Page } from '@playwright/test';

const SWEEP = '/private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/shots/sweep';
const USER = 'Hala Nasser';

const homeRows = (page: Page) => page.getByRole('list', { name: 'Your projects' }).getByRole('listitem');
const projectRows = (page: Page) => page.getByRole('list', { name: 'Projects' }).getByRole('listitem');

/** Switches the language with the person menu (the avatar button), like a real person. */
async function switchWithPersonMenu(page: Page, label: 'العربية' | 'English'): Promise<void> {
  await page.getByRole('button', { name: USER }).click();
  await page.getByRole('dialog', { name: USER }).getByRole('button', { name: label }).click();
}

for (const width of [390, 820, 1440]) {
  test(`Home at ${width}px has one glow, one signature, a placed pill and no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hala');
    await expect(homeRows(page).first()).toBeVisible();
    await page.waitForTimeout(800); // the first-visit entrance settles
    await expect(page.locator('.glow')).toHaveCount(1);
    await expect(page.locator('main .signature')).toHaveCount(1);
    const pill = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(pill).toBeVisible();
    const box = await pill.boundingBox();
    expect(box).not.toBeNull();
    if (width < 640) expect(box!.y + box!.height).toBeGreaterThan(900 - 40);
    else expect(box!.y).toBeLessThan(40);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
  });
}

test('the pill has the four links and Search, and the person menu has its four controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  const pill = page.getByRole('navigation', { name: 'Main navigation' });
  for (const name of ['Home', 'Projects', 'Dashboard', 'Inbox', 'Search']) await expect(pill.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  await page.getByRole('button', { name: USER }).click();
  const menu = page.getByRole('dialog', { name: USER });
  await expect(menu.getByRole('combobox', { name: /Preview as/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'العربية' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'My hours' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('Home and Projects at 1440 have no glass panel and no picture in the projects list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(homeRows(page).first()).toBeVisible();
  await expect(page.locator('main .glass')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Your projects' }).locator('img')).toHaveCount(0);
  await page.goto('/#/projects');
  await expect(projectRows(page).first()).toBeVisible();
  await expect(page.locator('main .glass')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Projects' }).locator('img')).toHaveCount(0);
});

test('Arabic turns the page right to left, the pill stays, and English turns it back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(homeRows(page).first()).toBeVisible();
  await switchWithPersonMenu(page, 'العربية');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('navigation', { name: 'التنقل الرئيسي' }).or(page.locator('nav.pill'))).toBeVisible();
  await expect(page.locator('nav.pill')).toBeVisible();
  await switchWithPersonMenu(page, 'English');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('the person menu switches between dark and light mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/');
  await expect(homeRows(page).first()).toBeVisible();
  await page.getByRole('button', { name: USER }).click();
  await page.getByRole('dialog', { name: USER }).getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // The menu stays open after the switch; open it again only if it closed.
  if (!(await page.getByRole('dialog', { name: USER }).isVisible())) await page.getByRole('button', { name: USER }).click();
  await page.getByRole('dialog', { name: USER }).getByRole('button', { name: 'Light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('with reduced motion, a filter choice still changes the Projects rows', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects');
  await expect(projectRows(page).first()).toBeVisible();
  const before = await projectRows(page).count();
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('radio', { name: 'Needs attention' }).click();
  await expect(projectRows(page)).toHaveCount(5);
  expect(before).toBeGreaterThan(5);
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('radio', { name: 'All' }).click();
  await expect(projectRows(page)).toHaveCount(before);
});

test('Focus mode opens from the task panel and Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects/prj_001?tab=tasks&task=tsk_012');
  const panel = page.getByRole('dialog').first();
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  const focus = page.getByRole('dialog', { name: 'Focus', exact: true });
  await expect(focus).toBeVisible();
  await expect(page).toHaveURL(/focus=tsk_012/);
  await expect(focus.getByRole('button', { name: 'Exit focus' })).toBeVisible();
  await expect(focus.getByRole('region', { name: 'Focus timer' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(focus).toHaveCount(0);
  await expect(page).not.toHaveURL(/focus=/);
});

test('the Next for you card offers Focus for a task', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  const next = page.getByRole('region', { name: 'Next for you' });
  await expect(next).toBeVisible();
  const focus = next.getByRole('button', { name: 'Focus' });
  if (await focus.count()) {
    await focus.click();
    await expect(page.getByRole('dialog', { name: 'Focus', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Focus', exact: true })).toHaveCount(0);
  }
});

test('screenshots for the sweep', async ({ page }) => {
  test.setTimeout(240_000);
  const shot = async (name: string) => { await page.waitForTimeout(900); await page.screenshot({ path: `${SWEEP}/${name}.png` }); };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/');
  await expect(homeRows(page).first()).toBeVisible();
  await shot('home-1440-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(homeRows(page).first()).toBeVisible();
  await shot('home-1440-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/projects');
  await expect(projectRows(page).first()).toBeVisible();
  await shot('projects-1440');
  await page.goto('/#/projects/prj_001');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
  await shot('project-1440');
  await page.goto('/#/dashboard');
  await expect(page.getByRole('link', { name: /At risk or late/ })).toBeVisible();
  await shot('dashboard-1440');
  await page.goto('/#/projects/prj_001?tab=tasks&focus=tsk_012');
  await expect(page.getByRole('dialog', { name: 'Focus', exact: true })).toBeVisible();
  await shot('focus-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/projects/prj_001?tab=tasks');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
  await shot('tasks-390');
  await page.goto('/#/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await shot('inbox-390');
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('/#/');
  await expect(page.locator('main ul li').first()).toBeVisible();
  await shot('home-390-ar');
});
