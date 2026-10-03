// @ts-nocheck Deno code for a short-lived probe Edge Function on madar-test. The repo type check does not know Deno or npm: specifiers.
// Z0a (plan, section 6.3, track Z). The function uses the keys that Supabase injects, so no project key ever leaves Supabase.
// Every route needs the header x-probe-token, a random value that the probe run sets as a function secret and removes afterwards.
// scripts/proof/z0a.ts deploys it as "z0a-probe" and deletes it in the cleanup step.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const BASE = Deno.env.get('SUPABASE_URL');

function projectKey(kind) {
  const raw = Deno.env.get(kind === 'secret' ? 'SUPABASE_SECRET_KEYS' : 'SUPABASE_PUBLISHABLE_KEYS');
  if (raw) {
    const keys = JSON.parse(raw);
    return keys.default ?? Object.values(keys)[0];
  }
  return Deno.env.get(kind === 'secret' ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY');
}

const SECRET = projectKey('secret');
const PUBLISHABLE = projectKey('publishable');
const admin = createClient(BASE, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function claimsOf(token) {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
}

async function pkce() {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

async function signIn(email, password) {
  const client = createClient(BASE, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in: ${error.message}`);
  return { client, session: data.session };
}

/** The whole OAuth 2.1 flow of an agent: DCR, authorize with PKCE, consent, code exchange, refresh. Returns claims only, never a token. */
async function oauthFlow({ email, password, redirectUri }) {
  const steps = {};
  const { client, session } = await signIn(email, password);
  steps.browserToken = pick(claimsOf(session.access_token));

  const reg = await fetch(`${BASE}/auth/v1/oauth/clients/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: PUBLISHABLE },
    body: JSON.stringify({ client_name: 'Z0a probe agent', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  const regBody = await reg.json();
  steps.registration = { status: reg.status, clientType: regBody.client_type, registrationType: regBody.registration_type };
  if (!reg.ok) return { steps, error: regBody };
  const clientId = regBody.client_id;
  steps.clientId = clientId;

  try {
    const { verifier, challenge } = await pkce();
    const authorize = new URL(`${BASE}/auth/v1/oauth/authorize`);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 'z0a', scope: 'openid email' }).toString();
    const auth = await fetch(authorize, { redirect: 'manual' });
    const location = auth.headers.get('location') ?? '';
    steps.authorize = { status: auth.status, consentPath: location ? new URL(location).pathname : null };
    const authorizationId = location ? new URL(location).searchParams.get('authorization_id') : null;
    if (!authorizationId) return { steps, error: await auth.text() };

    const details = await client.auth.oauth.getAuthorizationDetails(authorizationId);
    steps.details = { error: details.error?.message ?? null, clientName: details.data?.client?.name ?? null, scope: details.data?.scope ?? null };
    const approved = await client.auth.oauth.approveAuthorization(authorizationId);
    if (approved.error) return { steps, error: approved.error.message };
    const code = new URL(approved.data.redirect_url).searchParams.get('code');
    steps.consent = { gotCode: Boolean(code) };

    const tokenRes = await fetch(`${BASE}/auth/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }),
    });
    const tokens = await tokenRes.json();
    steps.token = { status: tokenRes.status, error: tokens.error ?? null };
    if (!tokenRes.ok) return { steps, error: tokens };
    steps.agentToken = pick(claimsOf(tokens.access_token));

    const refreshRes = await fetch(`${BASE}/auth/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }),
    });
    const refreshed = await refreshRes.json();
    steps.refresh = { status: refreshRes.status, error: refreshed.error ?? null };
    if (refreshRes.ok) steps.refreshedToken = pick(claimsOf(refreshed.access_token));

    // The person's own token, refreshed after the agent flow, must keep aud "authenticated".
    const again = await client.auth.refreshSession({ refresh_token: session.refresh_token });
    if (again.data?.session) steps.browserRefreshed = pick(claimsOf(again.data.session.access_token));

    // Does Auth itself accept the changed aud? getUser asks the Auth server with the agent token.
    const userRes = await fetch(`${BASE}/auth/v1/user`, { headers: { apikey: PUBLISHABLE, authorization: `Bearer ${tokens.access_token}` } });
    steps.authUserWithAgentToken = { status: userRes.status };
    return { steps };
  } finally {
    const del = await fetch(`${BASE}/auth/v1/admin/oauth/clients/${clientId}`, { method: 'DELETE', headers: { apikey: SECRET, authorization: `Bearer ${SECRET}` } });
    steps.clientDeleted = del.status;
  }
}

function pick(c) {
  return { aud: c.aud, client_id: c.client_id ?? null, role: c.role, iss: c.iss, session_id: Boolean(c.session_id) };
}

/** Listens on a Broadcast channel as a signed-in person for a few seconds, and returns what arrived and every join status. */
async function listen({ email, password, topic, seconds, isPrivate = true }) {
  const { session } = await signIn(email, password);
  const logs = [];
  const client = createClient(BASE, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { logger: (kind, msg, data) => logs.length < 40 && logs.push(`${kind} ${msg} ${data ? JSON.stringify(data).slice(0, 300) : ''}`) },
    global: { headers: { authorization: `Bearer ${session.access_token}` } },
  });
  await client.realtime.setAuth(session.access_token);
  const messages = [];
  const statuses = [];
  const channel = client
    .channel(topic, { config: { private: isPrivate } })
    .on('broadcast', { event: '*' }, (msg) => messages.push({ event: msg.event, payload: msg.payload, at: Date.now() }));
  await new Promise((resolve) => {
    channel.subscribe((s, err) => {
      statuses.push(err ? `${s}: ${err.message}` : s);
      if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') resolve(null);
    });
    setTimeout(resolve, 8000);
  });
  const subscribedAt = Date.now();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await client.removeChannel(channel);
  // The raw client logs hold the join token, so only their count leaves the function.
  return { statuses, subscribedAt, messages, logLines: logs.length };
}

async function storageCall(path, init = {}) {
  const res = await fetch(`${BASE}/storage/v1${path}`, {
    ...init,
    headers: { apikey: SECRET, authorization: `Bearer ${SECRET}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const routes = {
  region: async () => ({ sbRegion: Deno.env.get('SB_REGION') ?? null }),
  'user-create': async ({ email, password }) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    return error ? { error: error.message } : { id: data.user.id };
  },
  'user-delete': async ({ id }) => {
    const { error } = await admin.auth.admin.deleteUser(id);
    return { error: error?.message ?? null };
  },
  'oauth-flow': oauthFlow,
  listen,
  'bucket-create': async ({ bucket, fileSizeLimit }) => storageCall('/bucket', { method: 'POST', body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: fileSizeLimit }) }),
  'bucket-delete': async ({ bucket }) => {
    const emptied = await storageCall(`/bucket/${bucket}/empty`, { method: 'POST' });
    const deleted = await storageCall(`/bucket/${bucket}`, { method: 'DELETE' });
    return { emptied: emptied.status, deleted: deleted.status, body: deleted.body };
  },
  // Raw Storage API, so the probe sees exactly what the server adapter will see. expiresIn tells whether the API takes a shorter life.
  'sign-upload': async ({ bucket, key, expiresIn }) =>
    storageCall(`/object/upload/sign/${bucket}/${key}`, { method: 'POST', body: JSON.stringify(expiresIn ? { expiresIn } : {}), headers: expiresIn ? { 'x-expires-in': String(expiresIn) } : {} }),
  'sign-download': async ({ bucket, key, expiresIn }) => storageCall(`/object/sign/${bucket}/${key}`, { method: 'POST', body: JSON.stringify({ expiresIn }) }),
  info: async ({ bucket, key }) => storageCall(`/object/info/${bucket}/${key}`, { method: 'GET' }),
  copy: async ({ bucket, from, to }) => storageCall('/object/copy', { method: 'POST', body: JSON.stringify({ bucketId: bucket, sourceKey: from, destinationKey: to }) }),
  remove: async ({ bucket, keys }) => storageCall(`/object/${bucket}`, { method: 'DELETE', body: JSON.stringify({ prefixes: keys }) }),
  list: async ({ bucket, prefix }) => storageCall(`/object/list/${bucket}`, { method: 'POST', body: JSON.stringify({ prefix, limit: 100 }) }),
};

Deno.serve(async (req) => {
  const expected = Deno.env.get('Z0A_PROBE_TOKEN');
  if (!expected || req.headers.get('x-probe-token') !== expected) return json({ error: 'forbidden' }, 403);
  const name = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  const route = routes[name];
  if (!route) return json({ error: `no route ${name}` }, 404);
  try {
    const input = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    return json(await route(input));
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
