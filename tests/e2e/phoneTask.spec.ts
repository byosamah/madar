import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Direction D, the task panel on a phone: each kind of next step, in English and Arabic, light and dark, at 390 px with touch.
// The shots go to test-results/phone-task. Run this file only through the Playwright agent of the join task (L4 and L5).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const SHOTS = 'test-results/phone-task';

/** The person (as the Preview as list names them), the to-do of the sample office, and the control that the next step must show. */
const KINDS = [
  { kind: 'review', person: 'Faisal Al-Harbi · Leader', task: 'tsk_010', control: { role: 'button', name: 'Approve' } },
  { kind: 'take', person: 'Faisal Al-Harbi · Leader', task: 'tsk_009', control: { role: 'button', name: 'Take it' }, prepare: async (page: Page) => { await page.locator('#task-owner').selectOption(''); } },
  { kind: 'complete', person: 'Yousef Saleh · Member', task: 'tsk_007', control: { role: 'button', name: 'Mark done' } },
  { kind: 'waiting', person: 'Khalid Al-Mutairi · Member', task: 'tsk_008', control: null },
  { kind: 'new version', person: 'Faisal Al-Harbi · Leader', task: 'tsk_005', control: { role: 'button', name: 'New version' } },
  { kind: 'join', person: 'Sara Al-Qahtani · Member', task: 'tsk_011', control: { role: 'button', name: 'Join as a helper' } },
  { kind: 'none', person: 'Omar Haddad · Member', task: 'tsk_010', control: null },
] as const;

/** Picks a person in Preview as and waits until the app shows that person. */
async function previewAs(page: Page, label: string): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: /Preview as/ }).first().selectOption({ label });
  await page.waitForTimeout(600);
}

/** The control is at least 44 px high and is the top element at its centre, so a finger reaches it. */
async function expectTarget(locator: Locator, name: string, minWidth = 0): Promise<void> {
  await expect(locator, name).toBeVisible();
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { height: rect.height, width: rect.width, reached: Boolean(hit) && (element === hit || element.contains(hit) || (hit?.contains(element) ?? false)) };
  });
  expect(box.height, `${name} is 44 px high`).toBeGreaterThanOrEqual(43.5);
  expect(box.width, `${name} is wide enough`).toBeGreaterThanOrEqual(minWidth);
  expect(box.reached, `${name} is the top element at its centre`).toBe(true);
}

for (const lang of ['en', 'ar'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const entry of KINDS) {
      test(`the task panel for ${entry.kind}, ${lang}, ${theme}`, async ({ page }) => {
        mkdirSync(SHOTS, { recursive: true });
        await page.emulateMedia({ colorScheme: theme });
        await previewAs(page, entry.person);
        if (lang === 'ar') {
          await page.getByRole('radio', { name: 'العربية' }).click();
          await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        }
        await page.goto(`/#/projects/prj_001?tab=tasks&task=${entry.task}`);
        const sheet = page.getByRole('dialog');
        await expect(sheet.getByRole('tablist')).toBeVisible();
        expect(await page.evaluate(() => window.innerWidth)).toBe(390);
        if ('prepare' in entry && lang === 'en') await entry.prepare(page);
        if (entry.control && lang === 'en') await expect(sheet.getByRole(entry.control.role, { name: entry.control.name })).toBeVisible();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/${entry.kind.replace(' ', '-')}-${lang}-${theme}.png` });
        // The targets that every panel has.
        await expectTarget(sheet.getByRole('button', { name: lang === 'en' ? 'Focus' : 'ركّز' }), 'Focus');
        await expectTarget(sheet.getByRole('button', { name: lang === 'en' ? 'Close' : 'أغلق' }), 'Close', 43.5);
        for (const tab of await sheet.getByRole('tab').all()) await expectTarget(tab, 'a switch tab');
        const main = sheet.locator('[data-next-step] .signature').first();
        if (await main.count()) await expectTarget(main, 'the main button');
        // One main button for each view.
        expect(await sheet.locator('.signature').count()).toBeLessThanOrEqual(1);
        // No sideways scroll.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      });
    }
  }
}

test('the Remove helper X and the checklist grip are 44 px targets', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  await previewAs(page, 'Faisal Al-Harbi · Leader');
  await page.goto('/#/projects/prj_001?tab=tasks&task=tsk_007');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('tablist')).toBeVisible();
  // A helper, so the row has its X.
  await sheet.getByLabel('Add a helper').selectOption({ label: 'Sara Al-Qahtani' });
  await expect(sheet.getByRole('button', { name: /^Remove helper/ })).toBeVisible();
  await expectTarget(sheet.getByRole('button', { name: /^Remove helper/ }), 'Remove helper', 43.5);
  // Two items, so the checklist has grips.
  const add = sheet.getByRole('textbox', { name: 'Add an item' });
  await add.fill('Check the handrail');
  await add.press('Enter');
  await add.fill('Check the landing');
  await add.press('Enter');
  const grip = sheet.getByRole('button', { name: /^Move .* up or down$/ }).first();
  await grip.scrollIntoViewIfNeeded();
  await expectTarget(grip, 'the checklist grip', 43.5);
  await expect(grip).toHaveAttribute('data-vaul-no-drag', '');
  await page.screenshot({ path: `${SHOTS}/targets.png` });
});
