import type { Browser, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { goto } from './goto';
import { lastMailId, linkPath, waitForMail } from './mail';
import { appOrigin } from './targets';
import { NO_SESSION, runId, signIn, signOut, type Lang, type Theme } from './steps';
import { word } from './words';

/**
 * One person from the Admin's invitation to the first sign-in, then a new password three ways (plan 5.1; task X2):
 *   1. the Admin adds the person, and the invitation mail lands in mail_outbox (MAIL_DRIVER=outbox on the test deployment);
 *   2. the Welcome link sets the first password (proof.md Z0a, item 2, case 1), and the person signs in with it;
 *   3. Settings, Password changes it;
 *   4. Forgot sends a reset mail, and the Reset link sets a new password (Z0a, item 2, case 2), and the person signs in with it.
 * Z1 turns on "require current password" only after cases 1 and 2 pass on madar-test with that setting on; the local stack
 * cannot turn it on (supabase/cli issue 5846), so on the local stack these cases prove the flows with the setting off.
 *
 * The flow runs twice: in English at 1440 px in light mode, and in Arabic at 390 px in dark mode. Its steps find the fields by
 * their ids and the texts through words.ts, so one flow serves both languages. The person's own steps run in a browser with no
 * session; the invitation runs as the Admin.
 */

type Variant = { lang: Lang; width: number; theme: Theme };
const VARIANTS: Variant[] = [
  { lang: 'en', width: 1440, theme: 'light' },
  { lang: 'ar', width: 390, theme: 'dark' },
];

async function personPage(browser: Browser, v: Variant): Promise<Page> {
  const context = await browser.newContext({ storageState: NO_SESSION, viewport: { width: v.width, height: 900 }, colorScheme: v.theme });
  // The screens before a sign-in open in the language of the invitation.
  await context.addInitScript((lang) => {
    try { window.localStorage.setItem('madar.lang', lang); } catch { /* blocked storage */ }
  }, v.lang);
  return context.newPage();
}

/** The violations of a page of this spec's own contexts fail the test too, as the fixture does for the default page. */
async function guard(page: Page, found: string[]): Promise<void> {
  await page.exposeBinding('__x2Csp', (_source, line: string) => { found.push(line); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __x2Csp?: (line: string) => void }).__x2Csp?.(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
}

for (const v of VARIANTS) {
  test.describe.serial(`a new person in ${v.lang}, from the invitation to a reset password`, () => {
    const id = runId();
    const person = { name: `Lina X2 ${v.lang} ${id}`, nameAr: `لينا ${v.lang} ${id}`, email: `x2-${v.lang}-${id}@madar.test` };
    // The person's own screens show the name in the screen language (owner item 12).
    const shownName = v.lang === 'ar' ? person.nameAr : person.name;
    const passwords = { first: `Welcome-${id}-pass`, second: `Changed-${id}-pass`, third: `Reset-${id}-pass` };
    const violations: string[] = [];

    test.afterAll(() => {
      expect(violations, 'the Content-Security-Policy blocked something').toEqual([]);
    });

    test('the Admin adds the person, and the invitation mail lands in the outbox', async ({ page, baseURL }) => {
      const before = await lastMailId();
      await page.setViewportSize({ width: 1440, height: 900 });
      await goto(page, '/admin/people');
      await page.getByRole('button', { name: 'Add person' }).click();
      const sheet = page.getByRole('dialog', { name: 'Add person' });
      await sheet.locator('#person-name').fill(person.name);
      // A new person needs both names (owner item 12).
      await sheet.locator('#person-name-ar').fill(person.nameAr);
      await sheet.locator('#person-email').fill(person.email);
      await sheet.locator('#person-gender').selectOption('female');
      await sheet.locator('#person-language').selectOption(v.lang);
      await sheet.locator('#person-discipline').fill('Architect');
      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText(`${person.name} added.`)).toBeVisible();
      const mail = await waitForMail({ to: person.email, tag: 'invite', after: before });
      // The link opens the app of the run: linkPath refuses a link to another origin, where the token would go.
      // It carries the renew key of security fix 7 (52 base32 characters), for a new link when this one is out of date.
      expect(linkPath(mail.text, 'welcome', appOrigin(process.env, baseURL))).toMatch(/^\/welcome\?token_hash=[^&]+&type=invite&renew=[a-z2-7]{52}$/);
      // The row of the person shows Invited until the first sign-in.
      await expect(page.getByRole('listitem').filter({ hasText: person.name }).getByText('Invited')).toBeVisible();
    });

    test('the Welcome link sets the first password (Z0a case 1), and the person signs in with it', async ({ browser, baseURL }) => {
      const mail = await waitForMail({ to: person.email, tag: 'invite', after: 0 });
      const page = await personPage(browser, v);
      await guard(page, violations);
      await goto(page, linkPath(mail.text, 'welcome', appOrigin(process.env, baseURL)));
      await expect(page.getByRole('heading', { level: 1, name: word(v.lang, 'auth.welcome.title') })).toBeVisible();
      // The token is used only on this press, so a mail scanner that opens the link does not use it.
      await page.getByRole('button', { name: word(v.lang, 'auth.welcome.open') }).click();
      await expect(page.getByText(word(v.lang, 'auth.welcome.greeting', { name: shownName }))).toBeVisible();
      await page.locator('#welcome-password').fill(passwords.first);
      await page.locator('form button[type="submit"]').click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', v.lang);
      await signOut(page, shownName, v.lang);
      await signIn(page, person.email, passwords.first);
      await page.context().close();
    });

    test('Settings, Password changes the password', async ({ browser }) => {
      const page = await personPage(browser, v);
      await guard(page, violations);
      await signIn(page, person.email, passwords.first);
      // /me/password is the phone page of the Password section. From 640 px it sends the person to /settings, where the section is.
      await goto(page, '/me/password');
      await expect(page.getByRole('heading', { name: word(v.lang, 'password.title'), exact: true }).first()).toBeVisible();
      // A wrong current password shows under its own field.
      await page.locator('#password-current').fill('not-the-password-1');
      await page.locator('#password-new').fill(passwords.second);
      await page.getByRole('button', { name: word(v.lang, 'password.save') }).click();
      await expect(page.getByText(word(v.lang, 'auth.errors.wrongPassword'))).toBeVisible();
      await page.locator('#password-current').fill(passwords.first);
      await page.getByRole('button', { name: word(v.lang, 'password.save') }).click();
      await expect(page.getByText(word(v.lang, 'password.changed'))).toBeVisible();
      await signOut(page, shownName, v.lang);
      await signIn(page, person.email, passwords.second);
      await page.context().close();
    });

    test('Forgot sends a reset mail, the Reset link sets a new password (Z0a case 2), and the person signs in with it', async ({ browser, baseURL }) => {
      const before = await lastMailId();
      const page = await personPage(browser, v);
      await guard(page, violations);
      await goto(page, '/forgot');
      await page.locator('#forgot-email').fill(person.email);
      await page.locator('form button[type="submit"]').click();
      await expect(page.getByRole('status')).toHaveText(word(v.lang, 'auth.forgot.sent'));
      const mail = await waitForMail({ to: person.email, tag: 'reset', after: before });
      await goto(page, linkPath(mail.text, 'reset', appOrigin(process.env, baseURL)));
      await expect(page.getByRole('heading', { level: 1, name: word(v.lang, 'auth.reset.title') })).toBeVisible();
      await page.locator('#reset-password').fill(passwords.third);
      await page.locator('form button[type="submit"]').click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await signOut(page, shownName, v.lang);
      // The old password no longer works; the new one does.
      await page.locator('#sign-in-email').fill(person.email);
      await page.locator('#sign-in-password').fill(passwords.second);
      await page.locator('form button[type="submit"]').click();
      await expect(page.getByText(word(v.lang, 'auth.errors.wrong'))).toBeVisible();
      await signIn(page, person.email, passwords.third);
      await page.context().close();
    });
  });
}
