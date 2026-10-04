import { expect, test } from './fixtures';

/**
 * The guard of every spec (task X2): a securitypolicyviolation event fails the test. This spec proves the guard sees one. A page
 * served with a Content-Security-Policy that blocks inline scripts runs one; the guard must record the violation. The spec then
 * empties the list, so its own end passes.
 */
test('the guard records a Content-Security-Policy violation of the page', async ({ page, cspGuard }) => {
  await page.route('http://csp-guard.madar.test/', (route) => route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'none'" },
    body: '<!doctype html><title>CSP guard</title><h1>CSP guard</h1><script>document.title = "ran";</script>',
  }));
  await page.goto('http://csp-guard.madar.test/');
  await expect(page.getByRole('heading', { name: 'CSP guard' })).toBeVisible();
  await expect.poll(() => cspGuard.length).toBeGreaterThan(0);
  expect(cspGuard[0].directive).toBe('script-src-elem');
  expect(await page.title()).toBe('CSP guard');
  cspGuard.length = 0;
});
