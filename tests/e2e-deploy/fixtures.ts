import { test as base, expect, type Page } from '@playwright/test';
import { DEPLOY_ACCOUNTS, storageStateOf, type DeployRole } from './accounts';
import { goto, REMOTE } from './goto';

/**
 * The test of every spec of tests/e2e-deploy (task X2). Import { test, expect } from here, never from @playwright/test.
 *
 * - cspGuard (automatic): every page of the test reports each securitypolicyviolation event, and the test fails when one came.
 *   The test deployment serves the Content-Security-Policy of the remote build (plan 5.9), so a blocked script, style, frame
 *   or picture fails the run.
 * - preferences (automatic): in the remote build the language and the theme are the signed-in person's own preferences on the
 *   server, so a test that changed them (useLanguage, useTheme, or markPreferences) puts English and System back at its end.
 *   The specs run one at a time (workers: 1 in playwright.deploy.config.ts), so no other test sees the change meanwhile.
 */
export type CspViolation = { directive: string; blocked: string; source: string };

const touched = new WeakSet<Page>();

/** Notes that this test changed the person's language or theme, so the fixture puts them back. */
export function markPreferences(page: Page): void {
  touched.add(page);
}

export const test = base.extend<{ cspGuard: CspViolation[]; preferences: void }>({
  cspGuard: [async ({ context }, use) => {
    const violations: CspViolation[] = [];
    await context.exposeBinding('__madarCspViolation', (_source, violation: CspViolation) => {
      violations.push(violation);
    });
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        const report = (window as unknown as { __madarCspViolation?: (v: unknown) => void }).__madarCspViolation;
        report?.({ directive: event.effectiveDirective, blocked: event.blockedURI, source: `${event.sourceFile}:${event.lineNumber}` });
      });
    });
    await use(violations);
    expect(violations, 'the Content-Security-Policy blocked something').toEqual([]);
  }, { auto: true }],
  preferences: [async ({ page }, use) => {
    await use();
    if (REMOTE && touched.has(page)) await restorePreferences(page);
  }, { auto: true }],
});

export { expect };

/** The Settings radio of a language. Both languages name the two languages the same way. */
const LANGUAGE_LABEL = { en: 'English', ar: 'العربية' } as const;

async function restorePreferences(page: Page): Promise<void> {
  await goto(page, '/settings');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const english = page.getByRole('radio', { name: LANGUAGE_LABEL.en });
  if ((await english.getAttribute('aria-checked')) !== 'true') await english.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // The second radio group of Settings is the theme; its first choice is System.
  const system = page.getByRole('radiogroup').nth(1).getByRole('radio').first();
  if ((await system.getAttribute('aria-checked')) !== 'true') await system.click();
  await expect(system).toHaveAttribute('aria-checked', 'true');
}

/** Switches the interface language in Settings, as a person does. */
export async function useLanguage(page: Page, lang: 'en' | 'ar'): Promise<void> {
  markPreferences(page);
  await goto(page, '/settings');
  await page.getByRole('radio', { name: LANGUAGE_LABEL[lang] }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
}

/** The prototype's Arabic step of today's specs. */
export const useArabic = (page: Page) => useLanguage(page, 'ar');

/**
 * The signed-in session of an office role (Playwright storageState). In the remote build a sign-in for each role replaces
 * Preview as (plan X2): test.use(asRole('member')).
 */
export function asRole(role: DeployRole): { storageState: string } {
  return { storageState: storageStateOf(role) };
}

/** The name of the person of a role in the sample office, as the person button shows it. */
export const PERSON_OF: Record<DeployRole, string> = {
  admin: 'Hala Nasser',
  management: 'Turki Al-Otaibi',
  accounting: 'Noura Al-Shammari',
  member: 'Faisal Al-Harbi',
};

/** The Arabic name of the person of a role, as the Arabic screens show it (owner, 2026-10-05, item 12). */
export const PERSON_AR_OF: Record<DeployRole, string> = {
  admin: 'هالة ناصر',
  management: 'تركي العتيبي',
  accounting: 'نورة الشمري',
  member: 'فيصل الحربي',
};

/** A check of Preview as: the prototype has it, the remote build has no such control (client map 6). */
export function skipPreviewAs(): void {
  test.skip(REMOTE, 'Preview as is a prototype control. In the remote build a sign-in for each role replaces it.');
}

/** The password of a role's account, from the secret that accounts.ts names. */
export function passwordOf(role: DeployRole): string {
  const name = DEPLOY_ACCOUNTS[role].passwordSecret;
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing: load the passwords of the test accounts first.`);
  return value;
}

/** The specs that need track G (agents) run after the merge lead merges rb/G and sets MADAR_E2E_AFTER_G=1. */
export const AFTER_G = process.env.MADAR_E2E_AFTER_G === '1';
/** The Usage spec needs track M (usage meters); it runs after the merge of rb/M, with MADAR_E2E_AFTER_M=1. */
export const AFTER_M = process.env.MADAR_E2E_AFTER_M === '1';
