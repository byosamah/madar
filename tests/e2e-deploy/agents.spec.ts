import { createHash, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { DEPLOY_ACCOUNTS } from './accounts';
import { AFTER_G, asRole, expect, passwordOf, PERSON_OF, test, useLanguage } from './fixtures';
import { DEPLOYED, goto } from './goto';
import { expectCalm, expectNoSeriousA11y, LANGS, runId, THEMES, WIDTHS } from './steps';
import { officeTarget, supabaseTarget, type SupabaseTarget } from './targets';

/**
 * AI agents on the remote build (plan 5.6; task X2): the consent flow of an MCP client up to the Approve page, Settings, Agents,
 * and proof.md Z0a, item 2, case 3: an agent token gets a refusal on PUT /auth/v1/user with a password and no current_password.
 *
 * - Every test here needs track G (the token hook, the MCP server, the consent screen and Settings, Agents). The merge lead runs
 *   this spec after the merge of rb/G, with MADAR_E2E_AFTER_G=1.
 * - Case 3 runs only on the test deployment (MADAR_DEPLOY_URL): the refusal comes from the Auth setting "require current
 *   password", which the local stack cannot turn on (supabase/cli issue 5846). Z1 turns that setting on in madar-test first.
 * - The steps run as the member account (Faisal), so the Admin keeps no agent. A failed case 3 would change Faisal's password; the
 *   next seed sets it back.
 *
 * Values: MADAR_E2E_SUPABASE_URL (the project URL; the local stack by default, and required on the test deployment),
 * MADAR_E2E_PUBLISHABLE_KEY (for case 3), and MADAR_E2E_MCP_URL (default <project URL>/functions/v1/mcp). targets.ts refuses
 * every project but madar-test and the local stack before the first call, so no run registers a client on another project.
 *
 * On the office path (exit wave 4, MADAR_E2E_OFFICE_URL) the flow uses the own OAuth routes under /mcp of that host, and case 3
 * calls the own password route: no Supabase value is needed.
 */
test.skip(!AFTER_G, 'The agents come with track G. The merge lead runs this spec after the merge of rb/G (MADAR_E2E_AFTER_G=1).');
test.use(asRole('member'));

let checkedTarget: SupabaseTarget | undefined;
/** The project of this spec, checked at its first use: a skipped spec (no track G yet) needs no project values. */
const target = (): SupabaseTarget => (checkedTarget ??= supabaseTarget(process.env));
const office = officeTarget(process.env);
/** The OAuth and MCP endpoints of the run: Supabase Auth today, the own routes under /mcp on the office path (exit wave 4). */
const endpoints = () => (office
  ? { register: `${office.mcpUrl}/oauth/register`, authorize: `${office.mcpUrl}/oauth/authorize`, token: `${office.mcpUrl}/oauth/token`, mcp: office.mcpUrl }
  : { register: `${target().supabaseUrl}/auth/v1/oauth/clients/register`, authorize: `${target().supabaseUrl}/auth/v1/oauth/authorize`, token: `${target().supabaseUrl}/auth/v1/oauth/token`, mcp: target().mcpUrl });
/** A loopback redirect, as a desktop MCP client uses: the consent screen shows no warning for it. */
const REDIRECT_URI = 'http://127.0.0.1:33418/callback';

const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** Dynamic client registration, as an MCP client does it (RFC 7591). */
async function registerClient(name: string): Promise<string> {
  const response = await fetch(endpoints().register, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  const body = (await response.json()) as { client_id?: string };
  if (!response.ok || !body.client_id) throw new Error(`The client registration failed: ${response.status}`);
  return body.client_id;
}

type Flow = { clientId: string; verifier: string; consentRoute: string };

/** The authorize step with PKCE. Auth answers with the consent page of Madar; the spec opens it on the run's own host. */
async function startFlow(clientId: string): Promise<Flow> {
  const verifier = base64url(randomBytes(32));
  const authorize = new URL(endpoints().authorize);
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI, code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256', state: base64url(randomBytes(12)), resource: endpoints().mcp,
  }).toString();
  const start = await fetch(authorize, { redirect: 'manual' });
  const consent = new URL(start.headers.get('location') ?? 'http://x/');
  const authorizationId = consent.searchParams.get('authorization_id');
  if (consent.pathname !== '/oauth/consent' || !authorizationId) throw new Error(`The authorize step gave no consent page: ${start.status}`);
  return { clientId, verifier, consentRoute: `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}` };
}

/** Approves on the consent screen and catches the redirect with the code, as the MCP client's loopback server would. */
async function approve(page: Page): Promise<string> {
  let code: string | null = null;
  await page.route(`${new URL(REDIRECT_URI).origin}/**`, (route) => {
    code = new URL(route.request().url()).searchParams.get('code');
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Madar sent the code.' });
  });
  await page.locator('button.signature:visible').click();
  await expect.poll(() => code, { timeout: 15_000 }).not.toBeNull();
  return code!;
}

async function exchange(flow: Flow, code: string): Promise<string> {
  const response = await fetch(endpoints().token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: flow.clientId, code_verifier: flow.verifier, resource: endpoints().mcp }),
  });
  const body = (await response.json()) as { access_token?: string };
  if (!response.ok || !body.access_token) throw new Error(`The code exchange failed: ${response.status}`);
  return body.access_token;
}

/**
 * Removes the grant of one client on the office path (exit wave 4), as Settings, Agents does: the own revoke route takes only a
 * browser token, so the member signs in once through the own token route. The password goes only in the body of that request.
 */
async function revokeOwnGrant(apiUrl: string, clientId: string): Promise<void> {
  const signin = await fetch(`${apiUrl}/auth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'password', email: DEPLOY_ACCOUNTS.member.email, password: passwordOf('member') }),
  });
  const { access_token: browser } = (await signin.json()) as { access_token?: string };
  if (!signin.ok || !browser) throw new Error(`The member sign-in for the revoke answered ${signin.status}.`);
  const revoked = await fetch(`${apiUrl}/oauth/grants/revoke`, {
    method: 'POST', headers: { Authorization: `Bearer ${browser}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId }),
  });
  if (!revoked.ok) throw new Error(`The revoke of the grant answered ${revoked.status}.`);
}

// Plan 6.1, rule 8: the consent screen in both languages and both themes, at the 3 widths. One flow serves the 3 widths of a
// language and a theme; the preferences fixture puts Faisal's English back at the end.
for (const lang of LANGS) {
  for (const theme of THEMES) {
    test(`the consent screen shows the agent and its one Approve button at ${WIDTHS.join(', ')}px, ${lang}, ${theme}`, async ({ page }) => {
      const name = `X2 consent ${lang} ${theme} ${runId()}`;
      const flow = await startFlow(await registerClient(name));
      await page.emulateMedia({ colorScheme: theme });
      if (lang === 'ar') await useLanguage(page, 'ar');
      for (const width of WIDTHS) {
        const label = `consent ${width}px ${lang} ${theme}`;
        await page.setViewportSize({ width, height: 900 });
        await goto(page, flow.consentRoute);
        await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // The host of the redirect address shows, so a person sees where the agent sends the code.
        await expect(page.getByText('127.0.0.1').first()).toBeVisible();
        await expect(page.locator('button.signature:visible')).toHaveCount(1);
        await page.screenshot({ path: `test-results/e2e-deploy-shots/agents/consent-${width}-${lang}-${theme}.png`, fullPage: true });
        await expectCalm(page, label);
        await expectNoSeriousA11y(page, label);
        expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), `${label} scrolls sideways`).toBeLessThanOrEqual(width);
      }
    });
  }
}

test('an approved agent shows in Settings, Agents after its first call, and Remove takes it away', async ({ page }) => {
  const name = `X2 agent ${runId()}`;
  const flow = await startFlow(await registerClient(name));
  await goto(page, flow.consentRoute);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const token = await exchange(flow, await approve(page));
  // The first MCP call makes the agent link (ensureAgentUser).
  const listed = await fetch(endpoints().mcp, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  expect(listed.status).toBe(200);
  // The agent of a member never gets the Admin tools of requests and bugs (owner, 2026-10-07).
  const tools = await listed.text();
  expect(tools).toContain('projects.list');
  expect(tools).not.toContain('feedback.list');
  // The message tools of every agent (owner, 2026-10-12): it sends and finds a chat, and never reads one.
  for (const name of ['"chats.openDirect"', '"chats.list"', '"chats.send"']) expect(tools, name).toContain(name);
  expect(tools).not.toContain('"chats.messages"');
  await page.unroute(`${new URL(REDIRECT_URI).origin}/**`);
  await goto(page, '/settings');
  await expect(page.getByRole('button', { name: PERSON_OF.member, exact: true })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button').last().click();
  // Remove may ask once; the main button of that question confirms it.
  const confirm = page.getByRole('dialog').locator('button.signature, button.text-late').last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
  const after = await fetch(endpoints().mcp, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  expect(after.status, 'a removed agent is stopped at once').toBe(401);
});

test('Z0a case 3: an agent token cannot set a new password without the current one', async ({ page }) => {
  test.skip(!DEPLOYED && !office, 'The local stack cannot turn on "require current password" (supabase/cli issue 5846); this case runs on the test deployment.');
  if (office) {
    // The own server (wave 2): an agent token on the password route gets 403 agent_token.
    const flow = await startFlow(await registerClient(`X2 password check ${runId()}`));
    await goto(page, flow.consentRoute);
    const token = await exchange(flow, await approve(page));
    try {
      const answer = await fetch(`${office.apiUrl}/auth/password`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: `Agent-set-${runId()}-pass`, current: 'not the password' }),
      });
      const body = (await answer.json().catch(() => ({}))) as { error?: { details?: { reason?: string } } };
      expect(answer.status).toBe(403);
      expect(body.error?.details?.reason).toBe('agent_token');
    } finally {
      // The grant stays in the office object until the next seed: remove it as Settings, Agents does, with a browser token.
      await revokeOwnGrant(office.apiUrl, flow.clientId).catch(() => undefined);
    }
    return;
  }
  const publishable = process.env.MADAR_E2E_PUBLISHABLE_KEY;
  if (!publishable) throw new Error('MADAR_E2E_PUBLISHABLE_KEY is missing: set the publishable key of madar-test.');
  const flow = await startFlow(await registerClient(`X2 password check ${runId()}`));
  await goto(page, flow.consentRoute);
  const token = await exchange(flow, await approve(page));
  try {
    const answer = await fetch(`${target().supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: publishable, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: `Agent-set-${runId()}-pass` }),
    });
    const body = (await answer.json().catch(() => ({}))) as { code?: string; error_code?: string };
    expect(answer.status, 'Auth refuses the new password').toBeGreaterThanOrEqual(400);
    expect(body.error_code ?? body.code).toBe('current_password_required');
  } finally {
    // The grant of this client stays in Auth (auth.oauth_consents), which the seed does not clear, so the walk's Member found
    // "Has access to your account" on Settings, Agents (deploy suite on the test copy, 2026-10-04). Remove it, as the screen does.
    await fetch(`${target().supabaseUrl}/auth/v1/user/oauth/grants?client_id=${encodeURIComponent(flow.clientId)}`, {
      method: 'DELETE',
      headers: { apikey: publishable, Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
});
