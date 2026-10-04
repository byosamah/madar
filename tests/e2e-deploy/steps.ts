import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import { goto, urlPattern } from './goto';
import { word } from './words';

/** Steps that several specs of task X2 share. */

export type Lang = 'en' | 'ar';
export type Theme = 'light' | 'dark';
export const WIDTHS = [390, 820, 1440] as const;
export const LANGS: readonly Lang[] = ['en', 'ar'];
export const THEMES: readonly Theme[] = ['light', 'dark'];

/** A browser with no session: test.use({ storageState: NO_SESSION }). */
export const NO_SESSION = { cookies: [], origins: [] };

/** The language of the sign-in screens before a sign-in: the choice saved in this browser (AuthPage, LANGUAGE_KEY). */
export async function signedOutLanguage(page: Page, lang: Lang): Promise<void> {
  await page.addInitScript((value) => {
    try { window.localStorage.setItem('madar.lang', value); } catch { /* blocked storage */ }
  }, lang);
}

/** No serious or critical axe finding (WCAG 2.2 AA), as today's specs check. Soft, so a sweep shows every screen. */
export async function expectNoSeriousA11y(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(serious.map((v) => `${label}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/**
 * The calm checks of plan 6.1, rule 8, on a screen at rest: one page title and at most one main button (the signature fill).
 * The jsdom tests of each screen check the rest (one colored highlight, no physical left or right styles).
 */
export async function expectCalm(page: Page, label: string): Promise<void> {
  await expect.soft(page.locator('h1:visible'), `${label}: one page title`).toHaveCount(1);
  const main = await page.locator('button.signature:visible, a.signature:visible').count();
  expect.soft(main, `${label}: at most one main button`).toBeLessThanOrEqual(1);
}

/** Signs in on the Sign in screen and waits until the screen behind it shows. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  if (!/\/sign-in/.test(page.url())) await goto(page, '/sign-in');
  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Signs out with the person menu, as a person does, and lands on Sign in with "You signed out." */
export async function signOut(page: Page, person: string, lang: Lang): Promise<void> {
  await page.getByRole('button', { name: person, exact: true }).click();
  await page.getByRole('dialog', { name: person }).getByRole('button', { name: word(lang, 'auth.signOut') }).click();
  await expect(page).toHaveURL(urlPattern('/sign-in?reason=signed_out'));
  await expect(page.getByText(word(lang, 'auth.reasons.signed_out'))).toBeVisible();
}

/** A new name for this run, so a second run on the same office never meets the first one's rows. */
export function runId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}
