import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function expectNoSeriousA11yIssues(page: Page, scope?: string): Promise<void> {
  const builder = new AxeBuilder({ page });
  if (scope) builder.include(scope);
  const results = await builder.withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function useArabic(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

const SCREENS: { name: string; path: string; ready: (page: Page, lang: 'en' | 'ar') => Promise<void>; scope?: string }[] = [
  { name: 'work', path: '/#/work', ready: async (page) => { await expect(page.getByRole('region').first()).toBeVisible(); } },
  { name: 'meetings', path: '/#/meetings', ready: async (page) => { await expect(page.getByRole('radiogroup').first()).toBeVisible(); } },
  { name: 'projects', path: '/#/projects', ready: async (page, lang) => { await expect(page.getByRole('list', { name: lang === 'ar' ? 'المشاريع' : 'Projects' })).toBeVisible(); } },
  { name: 'inbox', path: '/#/inbox', ready: async (page) => { await expect(page.locator('aside ul li').first()).toBeVisible(); } },
  { name: 'notifications', path: '/#/notifications', ready: async (page) => { await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); } },
  { name: 'search', path: '/#/search', ready: async (page) => { await page.locator('input[role="combobox"]').fill('a'); await expect(page.locator('[cmdk-root] [role="option"]').first()).toBeVisible(); } },
  { name: 'task-comments', path: '/#/projects/prj_001?tab=tasks&task=tsk_007&thread=1', ready: async (page) => { await expect(page.getByRole('dialog')).toBeVisible(); } },
];

for (const width of [390, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`personal work screens at ${width}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await useArabic(page);
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await screen.ready(page, lang);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `test-results/work/${width}-${lang}-${screen.name}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page, screen.scope);
      }
    });
  }
}

test('Ctrl+K opens search, and Enter opens the project', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('list', { name: 'Your projects' }).getByRole('listitem').first()).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('input[role="combobox"]').fill('corniche');
  await expect(page.locator('[cmdk-root]').getByRole('option', { name: /Corniche Office Tower/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
});

test('Mark all read clears the bell count', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/notifications');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  const markAll = page.getByRole('button', { name: 'Mark all read' });
  if (await markAll.isVisible()) await markAll.click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Notifications' }).getByText(/items need action/)).toHaveCount(0);
});

test('Arabic search for a project word shows results or the no-results sentence', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.setViewportSize({ width: 1440, height: 900 });
  await useArabic(page);
  await page.goto('/#/search');
  await page.locator('input[role="combobox"]').fill('برج');
  await page.waitForTimeout(500);
  const hasOption = page.locator('[cmdk-root] [role="option"]').first();
  const noResults = page.locator('[role="status"], p').filter({ hasText: /لا |ما من|لم/ }).first();
  await expect(hasOption.or(noResults)).toBeVisible();
  expect(errors).toEqual([]);
});

test('no screen scrolls sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const paths = [
    '/#/', '/#/projects', '/#/meetings', '/#/projects/prj_001', '/#/projects/prj_001?tab=tasks', '/#/projects/prj_001?tab=activity', '/#/projects/prj_001?tab=schedule', '/#/projects/prj_001?tab=files',
    '/#/projects/prj_001?tab=team', '/#/work', '/#/inbox', '/#/notifications', '/#/admin', '/#/search', '/#/settings', '/#/me', '/#/me/profile',
    '/#/dashboard', '/#/dashboard?view=people', '/#/dashboard?view=schedule', '/#/tasks?filter=overdue', '/#/tasks?mode=deadlines',
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect.soft(width, path).toBeLessThanOrEqual(390);
  }
});

// Phone design D, track W (the Work tab). The builder does not run these; the Playwright agent of the lead does, in Chromium and in WebKit.

/** The press area test: the box is 44 px or more, and the four corners inside it hit the control or a child of it. */
async function expectPressArea(control: Locator): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box, 'the control has a box').not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(43.5);
  expect(box!.height).toBeGreaterThanOrEqual(43.5);
  const hits = await control.evaluate((element) => {
    const r = element.getBoundingClientRect();
    const points: [number, number][] = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
    return points.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit === element || element.contains(hit);
    });
  });
  expect(hits).toEqual([true, true, true, true]);
}

for (const width of [360, 390]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`Work at ${width}px in ${lang}: title, three parts of 44 px, no sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      if (lang === 'ar') await useArabic(page);
      for (const path of ['/#/work', '/#/meetings', '/#/projects']) {
        await page.goto(path);
        const title = page.getByRole('heading', { level: 1 });
        await expect(title, path).toHaveText(lang === 'en' ? 'Work' : 'العمل');
        const group = page.getByRole('radiogroup').first();
        const radios = group.getByRole('radio');
        await expect(radios, path).toHaveCount(3);
        for (let n = 0; n < 3; n += 1) {
          const radio = radios.nth(n);
          const box = await radio.boundingBox();
          expect(box!.height, `${path} part ${n}`).toBeGreaterThanOrEqual(44);
          // A word never cuts inside its part.
          expect(await radio.evaluate((el) => el.scrollWidth <= el.clientWidth), `${path} part ${n} word`).toBe(true);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(width);
        // The title and the main button do not overlap.
        const row = title.locator('xpath=ancestor::div[contains(@class, "justify-between")][1]');
        const button = row.getByRole('button');
        if (await button.count() > 0) {
          const a = await title.boundingBox();
          const b = await button.first().boundingBox();
          const apart = a!.x + a!.width <= b!.x + 1 || b!.x + b!.width <= a!.x + 1 || a!.y + a!.height <= b!.y + 1 || b!.y + b!.height <= a!.y + 1;
          expect(apart, `${path} title and button`).toBe(true);
        }
      }
    });
  }
}

test('the Board lane snaps and shows four dots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/work');
  await page.evaluate(() => localStorage.setItem('madar.work.view', 'board'));
  await page.reload();
  const todo = page.getByRole('region', { name: /^To do/ });
  await expect(todo).toBeVisible();
  // A column is 310 px wide: the lane has 16 px of padding on each side and the column takes the width less 3 rem.
  const box = await todo.boundingBox();
  expect(Math.abs(box!.width - 310)).toBeLessThanOrEqual(2);
  const dots = page.getByRole('button', { name: /^(To do|In progress|In review|Done): \d+$/ });
  await expect(dots).toHaveCount(4);
  for (let n = 0; n < 4; n += 1) {
    const dot = await dots.nth(n).boundingBox();
    expect(dot!.width).toBeGreaterThanOrEqual(44);
    expect(dot!.height).toBeGreaterThanOrEqual(44);
  }
  await dots.nth(3).click();
  await expect(page.getByRole('region', { name: /^Done/ })).toBeInViewport({ ratio: 0.5 });
});

test('the people picture and the tick have a 44 px press area', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/projects/prj_001?tab=tasks');
  const people = page.getByRole('button', { name: /^Lead and helpers of/ }).first();
  await expect(people).toBeVisible();
  await expectPressArea(people);
  await expectPressArea(page.getByRole('checkbox', { name: /^Complete / }).first());
});

test.describe('a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a mouse drag changes the order on a touch phone', async ({ page }) => {
    await page.goto('/#/work');
    await expect(page.getByRole('region').first()).toBeVisible();
    const grips = page.locator('button[aria-roledescription="sortable"]');
    await expect(grips.first()).toBeAttached();
    // The grip stays for the keyboard but is not drawn.
    await expect(grips.first()).toHaveClass(/sr-only/);
    const rows = page.locator('li:has(button[aria-roledescription="sortable"])');
    test.skip(await rows.count() < 2, 'the sample office has no date group with two rows to move');
    const same = await rows.nth(0).evaluate((first, second) => first.parentElement === second.parentElement, await rows.nth(1).elementHandle());
    test.skip(!same, 'the first two rows are not in one group');
    const a = await rows.nth(0).boundingBox();
    const b = await rows.nth(1).boundingBox();
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
    await page.mouse.down();
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2 + 12, { steps: 4 });
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height - 4, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText('Order saved.')).toBeVisible();
  });
});
