import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The guard of every spec (task X2): a securitypolicyviolation event fails the test. A page served with a Content-Security-Policy
 * that blocks inline scripts runs one.
 * - The first test proves the guard records the violation, then empties the list, so its own end passes.
 * - The second test keeps the violation. It is marked test.fail(): Playwright passes it only when the guard's end fails it, so
 *   a guard that stops failing a test makes this spec red.
 */
const BLOCKED_PAGE = 'http://csp-guard.madar.test/';

async function openBlockedPage(page: Page): Promise<void> {
  await page.route(BLOCKED_PAGE, (route) => route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'none'" },
    body: '<!doctype html><title>CSP guard</title><h1>CSP guard</h1><script>document.title = "ran";</script>',
  }));
  await page.goto(BLOCKED_PAGE);
  await expect(page.getByRole('heading', { name: 'CSP guard' })).toBeVisible();
}

test('the guard records a Content-Security-Policy violation of the page', async ({ page, cspGuard }) => {
  await openBlockedPage(page);
  await expect.poll(() => cspGuard.length).toBeGreaterThan(0);
  expect(cspGuard[0].directive).toBe('script-src-elem');
  expect(await page.title()).toBe('CSP guard');
  cspGuard.length = 0;
});

test('the guard fails a test that met a violation', async ({ page, cspGuard }) => {
  test.fail(true, 'The guard must fail this test at its end, because the page met a violation.');
  await openBlockedPage(page);
  // The body itself passes: only the guard's end can fail this test.
  await expect.poll(() => cspGuard.length).toBeGreaterThan(0);
});
