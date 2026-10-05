import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
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

/**
 * The theme saved on this device for the screens before sign-in (src/app/appearance.ts, THEME_KEY). With nothing saved they are
 * light, also on a dark device (owner, 2026-10-05, item 11).
 */
export async function signedOutTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((value) => {
    try { window.localStorage.setItem('madar.theme', value); } catch { /* blocked storage */ }
  }, theme);
}

/**
 * No serious or critical axe finding (WCAG 2.2 AA), as today's specs check. Soft, so a sweep shows every screen. `within` limits
 * the check to one part of the page, such as an open sheet ('[role="dialog"]').
 */
export async function expectNoSeriousA11y(page: Page, label: string, within?: string): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);
  const results = await (within ? builder.include(within) : builder).analyze();
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

/**
 * Opens a "…" menu (src/components/Menu.tsx) and checks that it stays open. The list has a fixed place, so it closes when the page
 * under it scrolls, and a Playwright click scrolls to its button first: at 390 px a button low in a long list (Admin, People)
 * opened its menu and closed it at once. So the button goes to the middle of the screen (never under a sticky bar), the click
 * waits until the button held still for a few frames, and only then clicks.
 */
export async function openMenu(button: Locator): Promise<void> {
  await button.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const settled = await button.evaluate((element) => new Promise<boolean>((resolve) => {
    let last = '';
    let still = 0;
    const until = performance.now() + 3000;
    const frame = () => {
      const box = element.getBoundingClientRect();
      const now = `${box.x},${box.y},${window.scrollX},${window.scrollY}`;
      still = now === last ? still + 1 : 0;
      last = now;
      if (still >= 5) resolve(true);
      else if (performance.now() > until) resolve(false);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
  expect(settled, 'the "…" button held still before the click').toBe(true);
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** One call of a batch: the name and the input, as the screens send it. */
export type BatchCall = { name: string; input: unknown };

/**
 * Sends calls to the api function as the signed-in person of the page, from inside the page (its origin, its CSP), with the
 * headers that the page's own last batch carried. `open` is the route whose first batch gives those headers.
 */
export async function batchAs(page: Page, open: string, calls: BatchCall[]): Promise<{ ok: boolean; error?: { code: string } }[]> {
  // The first batch that gets an ANSWER: on the live copy the old page sent one more batch as the new load started, the load
  // cancelled it, and the headers of a cancelled request never come (deploy suite on the test copy, 2026-10-04).
  const answered = page.waitForResponse((response) => /\/functions\/v1\/api\/batch/.test(response.url()) && response.request().method() === 'POST');
  await goto(page, open);
  const request = (await answered).request();
  const all = await request.allHeaders();
  const headers = Object.fromEntries(['authorization', 'apikey', 'x-madar-build', 'content-type'].filter((name) => all[name]).map((name) => [name, all[name]]));
  const body = JSON.stringify({ v: 1, calls: calls.map((call, i) => ({ i, name: call.name, input: call.input })) });
  const answer = await page.evaluate(async ({ url, headers, body }) => {
    const response = await fetch(url, { method: 'POST', headers, body });
    return { status: response.status, json: await response.json() as { results?: { ok: boolean; error?: { code: string } }[] } };
  }, { url: request.url(), headers, body });
  expect(answer.status, 'the batch answer').toBe(200);
  return answer.json.results ?? [];
}
