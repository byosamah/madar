// P1 cloud proof: the Realtime facts of the chat presence design (docs/superpowers/specs/2026-10-21-madar-chat-presence-design.md,
// "Facts to prove before the build"). It runs on madar-test only (lib.ts refuses any other project for SQL).
//
//   set -a; . ~/dev/madar/.env.local; . ~/dev/madar/secrets/test-accounts.env; set +a
//   npx tsx scripts/proof/presence.ts <step|all>     steps: policies status agent typing drop counts usage cleanup
//
// Needs the migration 20261022000200_platform_presence.sql on madar-test. Each step prints pass or fail lines. No secret reaches the
// output: say() redacts the passwords and the tokens. The script leaves nothing on madar-test except the two policies of the
// migration: the cleanup step removes the OAuth client of the agent probe and the typing rows of the run.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { DEPLOY_ACCOUNTS, type DeployRole } from '../../tests/e2e-deploy/accounts.ts';
import { redact } from './lib.ts';
import { REF, SUPABASE_URL, adminClient, need, sleep } from './cloud.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const MARK = 'p1-presence';
const used: string[] = [];

/** One line of output, with every password and token that the run used replaced. */
function say(text: string): void {
  console.log(redact(text, used));
}

const results: { fact: string; pass: boolean | null; note: string }[] = [];
function verdict(fact: string, pass: boolean | null, note: string): void {
  results.push({ fact, pass, note });
  say(`${pass === null ? 'NOT PROBED' : pass ? 'PASS' : 'FAIL'}  ${fact}: ${note}`);
}

function publishableKey(): string {
  const line = readFileSync(`${root}config/remote.test.env`, 'utf8').split('\n').find((l) => l.startsWith('VITE_SUPABASE_PUBLISHABLE_KEY='));
  const value = line?.slice(line.indexOf('=') + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!value) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is missing in config/remote.test.env');
  return value;
}

// ---- Frame counting: every frame that Realtime sends to a client, by event name (the messages that the free plan counts).

type Frames = { total: number; by: Record<string, number> };
class Counter {
  frames: Frames = { total: 0, by: {} };
  add(data: unknown, binary: boolean): void {
    let label = 'binary';
    if (!binary) {
      try {
        const m = JSON.parse(String(data));
        const topic: string = Array.isArray(m) ? m[2] : m.topic;
        const event: string = Array.isArray(m) ? m[3] : m.event;
        if (topic === 'phoenix') return; // heartbeat
        label = event;
      } catch {
        label = 'text';
      }
    }
    this.frames.total += 1;
    this.frames.by[label] = (this.frames.by[label] ?? 0) + 1;
  }
  snapshot(): Frames {
    return { total: this.frames.total, by: { ...this.frames.by } };
  }
  since(before: Frames): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(this.frames.by)) {
      const d = v - (before.by[k] ?? 0);
      if (d) parts.push(`${k}=${d}`);
    }
    return `${this.frames.total - before.total} [${parts.join(' ') || '-'}]`;
  }
}

function countingTransport(counter: Counter) {
  // The WebSocket of Node (undici). A text frame gives a string, a binary frame gives a Blob or a buffer.
  return class extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols);
      this.addEventListener('message', (event: MessageEvent) => counter.add(event.data, typeof event.data !== 'string'));
    }
  };
}

type Person = { role: DeployRole; id: string; client: SupabaseClient; counter: Counter };

async function signIn(role: DeployRole, opts: { countFrames?: boolean } = {}): Promise<Person> {
  const account = DEPLOY_ACCOUNTS[role];
  const password = need(account.passwordSecret);
  used.push(password);
  const counter = new Counter();
  const client = createClient(SUPABASE_URL, publishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: countingTransport(counter) as never },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: account.email, password });
  if (error || !data.session) throw new Error(`The sign-in of ${account.email} failed (${error?.status ?? 'no session'}).`);
  used.push(data.session.access_token, data.session.refresh_token);
  await client.realtime.setAuth(data.session.access_token);
  void opts;
  return { role, id: account.userId, client, counter };
}

type Joined = { channel: RealtimeChannel; status: string; error: string | null; events: { type: string; at: number; keys: string[] }[] };

/** Joins a private status topic and records every presence event. Resolves on the first status that ends the join. */
function joinStatus(client: SupabaseClient, topicId: string, key: string, waitMs = 10000): Promise<Joined> {
  return new Promise((resolve) => {
    const channel = client.channel(`status:${topicId}`, { config: { private: true, presence: { key } } });
    const joined: Joined = { channel, status: 'pending', error: null, events: [] };
    for (const type of ['sync', 'join', 'leave'] as const) {
      (channel as any).on('presence', { event: type }, (payload: { key?: string }) => {
        joined.events.push({ type, at: Date.now(), keys: [String(payload?.key ?? '')] });
      });
    }
    const timer = setTimeout(() => {
      joined.status = joined.status === 'pending' ? 'NO_ANSWER' : joined.status;
      resolve(joined);
    }, waitMs);
    channel.subscribe((status, err) => {
      joined.status = status;
      joined.error = err ? String(err.message ?? err) : null;
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timer);
        resolve(joined);
      }
    });
  });
}

async function leave(client: SupabaseClient, joined: Joined | undefined): Promise<void> {
  if (joined) await client.removeChannel(joined.channel).catch(() => undefined);
}

const keysOf = (j: Joined) => Object.keys(j.channel.presenceState());

async function waitFor(cond: () => boolean, ms: number, step = 100): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(step);
  }
  return cond();
}

// ---- Fact 1 and 2: tracking on the own topic, and a track on another topic.

async function statusStep(): Promise<void> {
  const [admin, member] = await Promise.all([signIn('admin'), signIn('member')]);
  let listenOwn: Joined | undefined;
  let own: Joined | undefined;
  let listenOther: Joined | undefined;
  let other: Joined | undefined;
  try {
    // Control: the admin tracks on the own topic, and the member must see it (read works for every active person).
    listenOwn = await joinStatus(admin.client, member.id, 'admin-reads');
    own = await joinStatus(member.client, member.id, 'member-device-1');
    const trackOwn = await own.channel.track({ state: 'online', probe: MARK });
    const adminSees = await waitFor(() => keysOf(listenOwn!).includes('member-device-1'), 6000);
    verdict(
      '1 track on the own topic, read by another person',
      listenOwn.status === 'SUBSCRIBED' && own.status === 'SUBSCRIBED' && trackOwn === 'ok' && adminSees,
      `member join ${own.status}, track "${trackOwn}", admin join ${listenOwn.status}, admin sees the key of the member: ${adminSees}`,
    );

    // A track on the topic of another person: the member joins status:<admin id>.
    listenOther = await joinStatus(admin.client, admin.id, 'admin-device-1');
    other = await joinStatus(member.client, admin.id, 'member-intruder');
    const trackOther = await other.channel.track({ state: 'online', probe: MARK }).catch((e) => `throws: ${String(e?.message ?? e)}`);
    const intruderSeen = await waitFor(() => keysOf(listenOther!).includes('member-intruder'), 6000);
    // Positive control for the same listener: the admin tracks on the own topic and the admin listener sees it.
    const trackAdmin = await listenOther.channel.track({ state: 'online', probe: MARK });
    const controlSeen = await waitFor(() => keysOf(listenOther!).includes('admin-device-1'), 6000);
    verdict(
      '2 a track on the topic of another person fails',
      !intruderSeen && trackOther !== 'ok' && controlSeen,
      `member join of the other topic ${other.status}${other.error ? ` (${other.error})` : ''}, track "${trackOther}", intruder key seen by the owner: ${intruderSeen}; control: the owner track "${trackAdmin}" seen: ${controlSeen}; member channel state after the track: ${other.channel.state}`,
    );
  } finally {
    await leave(member.client, own);
    await leave(member.client, other);
    await leave(admin.client, listenOwn);
    await leave(admin.client, listenOther);
    await Promise.all([admin.client.auth.signOut().catch(() => undefined), member.client.auth.signOut().catch(() => undefined)]);
    await Promise.all([admin.client.realtime.disconnect(), member.client.realtime.disconnect()]);
  }
}

// ---- Fact 3: a token with client_id (an agent token) cannot track. The OAuth flow of the agent, as in scripts/proof/function/index.ts.

const AGENT_NAME = `${MARK} agent`;
const REDIRECT = 'https://example.invalid/p1-presence';

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const { createHash, randomBytes } = await import('node:crypto');
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Makes an agent token for the member through the OAuth 2.1 server of Auth. Returns null with the reason when a step fails. */
async function agentToken(member: Person): Promise<{ token: string; clientId: string } | { error: string }> {
  const key = publishableKey();
  const reg = await fetch(`${SUPABASE_URL}/auth/v1/oauth/clients/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key },
    body: JSON.stringify({ client_name: AGENT_NAME, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  const regBody = (await reg.json().catch(() => ({}))) as { client_id?: string };
  if (!reg.ok || !regBody.client_id) return { error: `client registration answered HTTP ${reg.status}` };
  const clientId = regBody.client_id;
  const { verifier, challenge } = await pkce();
  const authorize = new URL(`${SUPABASE_URL}/auth/v1/oauth/authorize`);
  authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: MARK, scope: 'openid email' }).toString();
  const auth = await fetch(authorize, { redirect: 'manual' });
  const location = auth.headers.get('location') ?? '';
  const authorizationId = location ? new URL(location, SUPABASE_URL).searchParams.get('authorization_id') : null;
  if (!authorizationId) return { error: `authorize answered HTTP ${auth.status} with no authorization_id` };
  const details = await member.client.auth.oauth.getAuthorizationDetails(authorizationId);
  if (details.error) return { error: `authorization details failed: ${details.error.message}` };
  const approved = await member.client.auth.oauth.approveAuthorization(authorizationId);
  if (approved.error || !approved.data) return { error: `consent failed: ${approved.error?.message ?? 'no data'}` };
  const code = new URL(approved.data.redirect_url).searchParams.get('code');
  if (!code) return { error: 'consent gave no code' };
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string };
  if (!tokenRes.ok || !tokens.access_token) return { error: `token exchange answered HTTP ${tokenRes.status}` };
  used.push(tokens.access_token, tokens.refresh_token ?? '');
  return { token: tokens.access_token, clientId };
}

async function oauthCounts(): Promise<string> {
  const a = await adminClient();
  try {
    const r = await a.query(`select (select count(*) from auth.oauth_clients)::int clients, (select count(*) from auth.oauth_authorizations)::int authorizations, (select count(*) from auth.oauth_consents)::int consents, (select count(*) from auth.sessions where oauth_client_id is not null)::int agent_sessions`);
    return JSON.stringify(r.rows[0]);
  } finally {
    await a.end();
  }
}

async function agentStep(): Promise<void> {
  say(`  OAuth rows before the probe: ${await oauthCounts()}`);
  const [admin, member] = await Promise.all([signIn('admin'), signIn('member')]);
  let listen: Joined | undefined;
  let agentJoin: Joined | undefined;
  let agentClient: SupabaseClient | undefined;
  try {
    const made = await agentToken(member);
    if ('error' in made) {
      verdict('3 a token with client_id cannot track', null, `not probed: ${made.error}`);
      return;
    }
    const claims = claimsOf(made.token);
    say(`agent token claims: client_id ${claims.client_id ? 'present' : 'absent'}, role ${String(claims.role)}, aud ${String(claims.aud)}`);
    listen = await joinStatus(admin.client, member.id, 'admin-reads-agent');
    const counter = new Counter();
    agentClient = createClient(SUPABASE_URL, publishableKey(), { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: countingTransport(counter) as never } });
    await agentClient.realtime.setAuth(made.token);
    agentJoin = await joinStatus(agentClient, member.id, 'agent-device');
    const tracked = agentJoin.status === 'SUBSCRIBED' ? await agentJoin.channel.track({ state: 'online', probe: MARK }).catch((e) => `throws: ${String(e?.message ?? e)}`) : 'not tried (join refused)';
    const seen = await waitFor(() => keysOf(listen!).includes('agent-device'), 5000);
    verdict(
      '3 a token with client_id cannot track (and cannot join to read)',
      Boolean(claims.client_id) && !seen && tracked !== 'ok',
      `client_id in the token: ${Boolean(claims.client_id)}; agent join of the own-id topic of its person: ${agentJoin.status}${agentJoin.error ? ` (${agentJoin.error})` : ''}; track: "${tracked}"; entry seen by the admin: ${seen}`,
    );
  } finally {
    await leave(admin.client, listen);
    if (agentClient) {
      await leave(agentClient, agentJoin);
      await agentClient.realtime.disconnect();
    }
    await Promise.all([admin.client.realtime.disconnect(), member.client.realtime.disconnect()]);
  }
}

// ---- The same policies evaluated in SQL (a rolled-back transaction): the turned-off person and the person who is gone.

async function policiesStep(): Promise<void> {
  const a = await adminClient();
  try {
    const users = await a.query<{ id: string; auth_user_id: string; active: boolean }>(`select id, auth_user_id::text, active from public.users where id = any($1)`, [['usr_001', 'usr_002']]);
    const byId = Object.fromEntries(users.rows.map((r) => [r.id, r]));
    const member = byId.usr_002;
    const adminRow = byId.usr_001;
    if (!member || !adminRow) throw new Error('usr_001 or usr_002 is missing on madar-test');
    const claims = (sub: string, extra: object = {}) => JSON.stringify({ sub, role: 'authenticated', aud: 'authenticated', ...extra });
    const goneSub = '00000000-0000-4000-8000-000000000001';

    const tryInsert = async (label: string, sub: string, topic: string, extra: object = {}, prepare?: string): Promise<boolean> => {
      await a.query('begin');
      try {
        if (prepare) await a.query(prepare);
        await a.query('set local role authenticated');
        await a.query(`select set_config('request.jwt.claims', $1, true), set_config('realtime.topic', $2, true)`, [claims(sub, extra), topic]);
        await a.query(`insert into realtime.messages (topic, extension, payload, event, private) values ($1, 'presence', '{}'::jsonb, 'p1', true)`, [topic]);
        return true;
      } catch (e) {
        const message = String((e as Error).message);
        if (!/row-level security/i.test(message)) say(`  (${label}: unexpected error: ${message})`);
        return false;
      } finally {
        await a.query('rollback');
      }
    };
    const tryRead = async (sub: string, extra: object = {}, prepare?: string): Promise<number> => {
      await a.query('begin');
      try {
        await a.query(`insert into realtime.messages (topic, extension, payload, event, private) values ('status:usr_002', 'presence', '{}'::jsonb, 'p1', true)`);
        if (prepare) await a.query(prepare);
        await a.query('set local role authenticated');
        await a.query(`select set_config('request.jwt.claims', $1, true), set_config('realtime.topic', 'status:usr_002', true)`, [claims(sub, extra)]);
        const r = await a.query(`select count(*)::int n from realtime.messages where topic = 'status:usr_002' and extension = 'presence'`);
        return r.rows[0].n;
      } finally {
        await a.query('rollback');
      }
    };

    const ownOk = await tryInsert('own', member.auth_user_id, 'status:usr_002');
    const otherDenied = !(await tryInsert('other', member.auth_user_id, 'status:usr_001'));
    const agentDenied = !(await tryInsert('agent', member.auth_user_id, 'status:usr_002', { client_id: '11111111-1111-4111-8111-111111111111' }));
    const goneDenied = !(await tryInsert('gone', goneSub, 'status:usr_002'));
    const offDenied = !(await tryInsert('turned off', member.auth_user_id, 'status:usr_002', {}, `update public.users set doc = jsonb_set(doc, '{active}', 'false') where id = 'usr_002'`));
    // An insert with the extension broadcast on a status topic: no insert policy lets authenticated do it.
    const broadcastDenied = await (async () => {
      await a.query('begin');
      try {
        await a.query('set local role authenticated');
        await a.query(`select set_config('request.jwt.claims', $1, true), set_config('realtime.topic', 'status:usr_002', true)`, [claims(member.auth_user_id)]);
        await a.query(`insert into realtime.messages (topic, extension, payload, event, private) values ('status:usr_002', 'broadcast', '{}'::jsonb, 'p1', true)`);
        return false;
      } catch {
        return true;
      } finally {
        await a.query('rollback');
      }
    })();
    verdict(
      '1/2/3 policy evaluation in SQL, insert (track)',
      ownOk && otherDenied && agentDenied && goneDenied && offDenied && broadcastDenied,
      `own id allowed: ${ownOk}; another id denied: ${otherDenied}; client_id denied: ${agentDenied}; person with no Madar user denied: ${goneDenied}; turned-off person (active=false in a rolled-back transaction) denied: ${offDenied}; a broadcast insert on a status topic denied: ${broadcastDenied}`,
    );

    const readActive = await tryRead(adminRow.auth_user_id);
    const readAgent = await tryRead(adminRow.auth_user_id, { client_id: '11111111-1111-4111-8111-111111111111' });
    const readGone = await tryRead(goneSub);
    const readOff = await tryRead(adminRow.auth_user_id, {}, `update public.users set doc = jsonb_set(doc, '{active}', 'false') where id = 'usr_001'`);
    verdict(
      '1 policy evaluation in SQL, select (read)',
      readActive === 1 && readAgent === 0 && readGone === 0 && readOff === 0,
      `rows visible to an active person: ${readActive}; with client_id: ${readAgent}; a person with no Madar user: ${readGone}; a turned-off person: ${readOff}`,
    );
  } finally {
    await a.end();
  }
}

// ---- Fact 4: the typing event on person:<id>, sent as madar_server.

async function typingStep(): Promise<void> {
  const [member, admin] = await Promise.all([signIn('member'), signIn('admin')]);
  const second = await signIn('member');
  const typingSeen: { at: number; payload: unknown }[] = [];
  const changedSeen: { at: number; payload: unknown }[] = [];
  const stray: unknown[] = [];
  const a = await adminClient();
  let typingChannel: RealtimeChannel | undefined;
  let changedChannel: RealtimeChannel | undefined;
  let adminChannel: RealtimeChannel | undefined;
  let membershipBefore = false;
  let grantedMembership = false;
  try {
    const join = (client: SupabaseClient, topic: string, on: (c: RealtimeChannel) => void) =>
      new Promise<{ channel: RealtimeChannel; status: string }>((resolve) => {
        const channel = client.channel(topic, { config: { private: true } });
        on(channel);
        const timer = setTimeout(() => resolve({ channel, status: 'NO_ANSWER' }), 10000);
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(timer);
            resolve({ channel, status });
          }
        });
      });
    // The typing listener hears only "typing". The change source listens only to "changed", like channel.ts.
    const t = await join(member.client, `person:${member.id}`, (c) => c.on('broadcast', { event: 'typing' }, (m) => typingSeen.push({ at: Date.now(), payload: m })));
    const c = await join(second.client, `person:${member.id}`, (ch) => {
      ch.on('broadcast', { event: 'changed' }, (m) => changedSeen.push({ at: Date.now(), payload: m }));
    });
    typingChannel = t.channel;
    changedChannel = c.channel;
    // Control: the admin cannot join the person topic of the member.
    const x = await join(admin.client, `person:${member.id}`, (ch) => ch.on('broadcast', { event: 'typing' }, (m) => stray.push(m)));
    adminChannel = x.channel;

    // Send as madar_server: the same role as the server, set inside one transaction. The admin login may not SET ROLE to it, so the
    // probe grants the membership for the run and revokes it in the finally block (it checks the membership before and after).
    // The existing membership (granted by supabase_admin) has the SET option off. The probe adds its own grant, made by postgres, with
    // the SET option on. REVOKE by postgres removes only that grant of its own, so the original row stays as it was.
    const own = async () => (await a.query(`select count(*)::int n from pg_auth_members m where m.roleid = 'madar_server'::regrole and m.member = 'postgres'::regrole and m.grantor = 'postgres'::regrole`)).rows[0].n as number;
    membershipBefore = (await own()) > 0;
    if (!membershipBefore) {
      await a.query('grant madar_server to postgres with set true');
      grantedMembership = true;
    }
    const notices: string[] = [];
    a.on('notice', (n) => notices.push(n.message ?? String(n)));
    const send = async (event: string, payload: object): Promise<{ at: number; error: string | null }> => {
      await a.query('begin');
      try {
        await a.query('set local role madar_server');
        const at = Date.now();
        await a.query(`select realtime.send($1::jsonb, $2, $3, true)`, [JSON.stringify(payload), event, `person:${member.id}`]);
        await a.query('commit');
        return { at, error: null };
      } catch (e) {
        await a.query('rollback').catch(() => undefined);
        return { at: 0, error: String((e as Error).message) };
      }
    };
    notices.length = 0;
    const sentTyping = await send('typing', { v: 1, probe: MARK });
    const warning = notices.filter((n) => /Warn/i.test(n));
    const got = await waitFor(() => typingSeen.length > 0, 8000);
    // The change source must still hear "changed" next to it (the control).
    const sentChanged = await send('changed', { v: 1, probe: MARK, kinds: ['p1'] });
    const gotChanged = await waitFor(() => changedSeen.length > 0, 8000);
    await sleep(1500);
    const typingPayload = typingSeen[0]?.payload as { event?: string; payload?: { v?: number } } | undefined;
    verdict(
      '4 the typing event reaches person:<id>, and a listener of only "changed" does not get it',
      !sentTyping.error && warning.length === 0 && got && typingPayload?.event === 'typing' && typingPayload?.payload?.v === 1 && changedSeen.length === 1 && gotChanged && stray.length === 0 && x.status !== 'SUBSCRIBED',
      `send as madar_server: ${sentTyping.error ?? 'ok'}, warnings ${warning.length}; the "typing" listener joined ${t.status} and got ${typingSeen.length} event(s) (event ${typingPayload?.event}, v ${typingPayload?.payload?.v}) after ${typingSeen[0] ? typingSeen[0].at - sentTyping.at : 'none'} ms; the "changed"-only listener (a second socket) joined ${c.status} and got ${changedSeen.length} event(s), all of them "changed" (control sent after: ${changedSeen[0] ? changedSeen[0].at - sentChanged.at : 'none'} ms); the admin joining person:${member.id}: ${x.status}, stray events ${stray.length}`,
    );
    say(`  frames at the "changed"-only client (second socket of the member): ${second.counter.snapshot().total} (${JSON.stringify(second.counter.snapshot().by)}); at the "typing" client: ${member.counter.snapshot().total}`);
  } finally {
    for (const [client, ch] of [[member.client, typingChannel], [second.client, changedChannel], [admin.client, adminChannel]] as const) if (ch) await client.removeChannel(ch).catch(() => undefined);
    if (grantedMembership) {
      await a.query('revoke madar_server from postgres');
      const left = await a.query(`select count(*)::int n from pg_auth_members m where m.roleid = 'madar_server'::regrole and m.member = 'postgres'::regrole`);
      say(`  cleanup: grants of madar_server to postgres after the revoke: ${left.rows[0].n} (the one of supabase_admin stays)`);
    }
    // Remove the rows of this run in realtime.messages (the partition drops them after 3 days anyway).
    const del = await a.query(`delete from realtime.messages where payload->>'probe' = $1`, [MARK]).catch((e) => ({ rowCount: `not deleted: ${String((e as Error).message)}` }));
    say(`  cleanup: rows of the run in realtime.messages deleted: ${del.rowCount}`);
    await a.end();
    await Promise.all([member.client.realtime.disconnect(), second.client.realtime.disconnect(), admin.client.realtime.disconnect()]);
  }
}

// ---- Fact 5: the time from a dead socket to the leave event at another client.

/** The child process: the member joins and tracks on the own topic, prints READY, and stays until it is killed. */
async function childMain(key: string): Promise<void> {
  const member = await signIn('member');
  const joined = await joinStatus(member.client, member.id, key);
  const tracked = await joined.channel.track({ state: 'online', probe: MARK });
  console.log(`READY ${joined.status} ${tracked}`);
  setInterval(() => undefined, 1 << 30);
}

async function dropOnce(how: 'freeze' | 'kill' | 'leave', admin: Person, memberId: string, n: number): Promise<{ how: string; seconds: number | null; note: string }> {
  const key = `drop-${how}-${n}-${Date.now() % 100000}`;
  const listen = await joinStatus(admin.client, memberId, `admin-reads-${how}-${n}`);
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), 'child', key], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += String(d)));
  child.stderr.on('data', (d) => (out += `ERR ${String(d).slice(0, 200)}`));
  try {
    const ready = await waitFor(() => out.includes('READY'), 30000);
    if (!ready) return { how, seconds: null, note: `the child did not get ready: ${out.slice(0, 200)}` };
    const joinSeen = await waitFor(() => listen.events.some((e) => e.type === 'join' && e.keys.includes(key)), 8000);
    if (!joinSeen) return { how, seconds: null, note: 'the listener never saw the join of the child' };
    // The client sends a heartbeat every 25 s. A different wait before each freeze puts the freeze at a different point of that cycle.
    await sleep(how === 'freeze' ? [1000, 9000, 17000, 24000][(n - 1) % 4] : 0);
    const t0 = Date.now();
    if (how === 'freeze') child.kill('SIGSTOP'); // the process stops answering; the TCP connection stays open, no close frame
    else if (how === 'kill') child.kill('SIGKILL'); // the operating system closes the socket at once
    else child.kill('SIGTERM'); // not used: leave is done by the child's own exit below
    const seen = await waitFor(() => listen.events.some((e) => e.type === 'leave' && e.keys.includes(key)), 240000, 250);
    const leaveEvent = listen.events.find((e) => e.type === 'leave' && e.keys.includes(key));
    return { how, seconds: seen && leaveEvent ? (leaveEvent.at - t0) / 1000 : null, note: seen ? 'leave seen' : 'no leave within 240 s' };
  } finally {
    child.kill('SIGCONT');
    child.kill('SIGKILL');
    await leave(admin.client, listen);
  }
}

async function dropStep(): Promise<void> {
  const admin = await signIn('admin');
  const memberId = DEPLOY_ACCOUNTS.member.userId;
  const rows: { how: string; seconds: number | null; note: string }[] = [];
  try {
    for (let n = 1; n <= 3; n += 1) {
      const r = await dropOnce('freeze', admin, memberId, n);
      rows.push(r);
      say(`  drop run ${n} (socket frozen with SIGSTOP, no close frame): ${r.seconds === null ? r.note : `${r.seconds.toFixed(1)} s`}`);
      await sleep(3000);
    }
    const k = await dropOnce('kill', admin, memberId, 1);
    say(`  control (process killed, the operating system closes the socket): ${k.seconds === null ? k.note : `${k.seconds.toFixed(1)} s`}`);
    const times = rows.map((r) => r.seconds).filter((s): s is number => s !== null);
    verdict('5 the time from a dead socket to the leave event', times.length === 3, `three runs: ${rows.map((r) => (r.seconds === null ? 'none' : `${r.seconds.toFixed(1)} s`)).join(', ')}; killed process: ${k.seconds === null ? 'none' : `${k.seconds.toFixed(1)} s`}`);
  } finally {
    await admin.client.realtime.disconnect();
  }
}

// ---- Fact 6: the presence frames that one track, one untrack and one join give to each of 3 listeners.

async function countsStep(): Promise<void> {
  const listeners = await Promise.all((['admin', 'management', 'accounting'] as const).map((r) => signIn(r)));
  const [m1, m2] = await Promise.all([signIn('member'), signIn('member')]);
  const topic = DEPLOY_ACCOUNTS.member.userId;
  const joinedL: Joined[] = [];
  const all = [...listeners, m1, m2];
  let j1: Joined | undefined;
  let j2: Joined | undefined;
  const lines: string[] = [];
  try {
    // The listeners join. Each one gets the state at the join.
    const before = listeners.map((p) => p.counter.snapshot());
    for (const p of listeners) joinedL.push(await joinStatus(p.client, topic, `reader-${p.role}`));
    await sleep(2000);
    lines.push(`a listener joins an empty topic (the state at a join): ${listeners.map((p, i) => `${p.role} ${p.counter.since(before[i])}`).join('; ')}`);

    const measure = async (label: string, act: () => Promise<unknown>, extra: Person[] = []) => {
      const snaps = [...listeners, ...extra].map((p) => p.counter.snapshot());
      const evBefore = joinedL.map((j) => ({ sync: j.events.filter((e) => e.type === 'sync').length, join: j.events.filter((e) => e.type === 'join').length, leave: j.events.filter((e) => e.type === 'leave').length }));
      await act();
      await sleep(3000);
      const ev = joinedL.map((j, i) => `sync ${j.events.filter((e) => e.type === 'sync').length - evBefore[i].sync}/join ${j.events.filter((e) => e.type === 'join').length - evBefore[i].join}/leave ${j.events.filter((e) => e.type === 'leave').length - evBefore[i].leave}`);
      const text = `${label}: frames to ${[...listeners, ...extra].map((p, i) => `${p.role} ${p.counter.since(snaps[i])}`).join('; ')}; callbacks of the 3 listeners ${ev.join(' | ')}`;
      lines.push(text);
    };

    // The member device 1 joins the topic and tracks, in the order of a screen.
    await measure('the member device joins the topic (no track yet)', async () => {
      j1 = await joinStatus(m1.client, topic, 'device-1');
    }, [m1]);
    await measure('one track (online)', async () => {
      await j1!.channel.track({ state: 'online' });
    }, [m1]);
    await measure('one more track (a state change online to away)', async () => {
      await j1!.channel.track({ state: 'away' });
    }, [m1]);
    await measure('a second device of the same person joins and tracks', async () => {
      j2 = await joinStatus(m2.client, topic, 'device-2');
      await j2.channel.track({ state: 'online' });
    }, [m1]);
    await measure('one untrack (device 2)', async () => {
      await j2!.channel.untrack();
    }, [m1]);
    await measure('device 2 tracks again after the untrack', async () => {
      await j2!.channel.track({ state: 'online' });
    }, [m1]);
    await measure('a tracked device leaves the channel (the same as a closed page)', async () => {
      await m2.client.removeChannel(j2!.channel);
      j2 = undefined;
    }, [m1]);
    for (const line of lines) say(`  ${line}`);
    verdict('6 presence frames for one track, one untrack and one join', true, 'the counts are in the lines above (each frame that Realtime sends to a client)');
  } finally {
    await leave(m1.client, j1);
    if (j2) await leave(m2.client, j2);
    for (let i = 0; i < listeners.length; i += 1) await leave(listeners[i].client, joinedL[i]);
    await Promise.all(all.map((p) => p.client.realtime.disconnect()));
  }
}

// ---- Step 3: the usage of the month, if the Management API gives it.

async function usageStep(): Promise<void> {
  const token = need('SUPABASE_ACCESS_TOKEN');
  const get = async (path: string) => {
    const r = await fetch(`https://api.supabase.com${path}`, { headers: { authorization: `Bearer ${token}` } });
    const t = await r.text();
    let body: unknown = t;
    try {
      body = JSON.parse(t);
    } catch {
      // plain text
    }
    return { status: r.status, body: body as any };
  };
  const org = (await get('/v1/organizations')).body?.[0]?.slug as string | undefined;
  say(`  organization endpoints: platform usage with a Management token -> ${org ? (await get(`/platform/organizations/${org}/usage`)).status : 'no org'}; /v1/organizations/<slug>/usage -> ${org ? (await get(`/v1/organizations/${org}/usage`)).status : 'no org'}`);
  // Read-only GET calls on both projects (the task asks for both). Nothing is written.
  for (const [name, ref] of [['madar-test', REF], ['madar (production, read only)', 'oprkvdjudjxxhvodkzgs']] as const) {
    const counts = await get(`/v1/projects/${ref}/analytics/endpoints/usage.api-counts?interval=7day`);
    const rows: { total_realtime_requests?: number; total_auth_requests?: number; total_rest_requests?: number; total_storage_requests?: number }[] = counts.body?.result ?? [];
    const sum = (k: 'total_realtime_requests' | 'total_auth_requests' | 'total_rest_requests' | 'total_storage_requests') => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
    say(`  ${name}: usage.api-counts 7 days (${counts.status}): ${rows.length} day buckets, realtime requests ${sum('total_realtime_requests')}, auth ${sum('total_auth_requests')}, rest ${sum('total_rest_requests')}, storage ${sum('total_storage_requests')}`);
    const fn = await get(`/v1/projects/${ref}/analytics/endpoints/logs?sql=${encodeURIComponent('select count(*) as n from function_edge_logs')}&iso_timestamp_start=${new Date(Date.now() - 86400000).toISOString()}&iso_timestamp_end=${new Date().toISOString()}`);
    say(`  ${name}: logs table function_edge_logs -> ${typeof fn.body?.error === 'string' ? fn.body.error : 'answered'}`);
  }
  verdict('step 3 the Realtime messages and the Edge Function calls of the month', null, 'not found by API: the usage endpoints of the dashboard (/platform/.../usage) refuse a Management token (401), the logs endpoint has no function table and a 24-hour window, and usage.api-counts gives only requests (no message count, no function count)');
}

// ---- Cleanup: the OAuth client of the agent probe, and a check that only the two policies of the migration are left.

async function cleanupStep(): Promise<void> {
  const a = await adminClient();
  try {
    const clients = await a.query<{ id: string }>(`select id::text from auth.oauth_clients where client_name = $1`, [AGENT_NAME]);
    for (const row of clients.rows) {
      const del = await a.query(`delete from auth.oauth_clients where id = $1::uuid`, [row.id]).catch((e) => ({ rowCount: `failed: ${String((e as Error).message)}` }));
      say(`  deleted the OAuth client of the agent probe: ${del.rowCount}`);
    }
    const left = await a.query(`select (select count(*) from auth.oauth_clients where client_name = $1)::int clients, (select count(*) from auth.oauth_clients)::int clients_total, (select count(*) from auth.oauth_authorizations)::int authorizations, (select count(*) from auth.oauth_consents)::int consents, (select count(*) from auth.sessions where oauth_client_id is not null)::int agent_sessions, (select count(*) from realtime.messages where payload->>'probe' = $2)::int rows`, [AGENT_NAME, MARK]).catch((e) => ({ rows: [{ error: String((e as Error).message) }] }));
    const policies = await a.query(`select polname from pg_policy where polrelid = 'realtime.messages'::regclass order by 1`);
    say(`  left over: ${JSON.stringify(left.rows[0])}; policies on realtime.messages: ${policies.rows.map((r) => r.polname).join(', ')}`);
  } finally {
    await a.end();
  }
}

const steps: Record<string, () => Promise<void>> = { policies: policiesStep, status: statusStep, agent: agentStep, typing: typingStep, drop: dropStep, counts: countsStep, usage: usageStep, cleanup: cleanupStep };

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const which = process.argv[2];
  if (which === 'child') {
    await childMain(process.argv[3] ?? 'child-device');
  } else {
    const chosen = which === 'all' ? ['policies', 'status', 'agent', 'typing', 'counts', 'drop', 'usage', 'cleanup'] : which && steps[which] ? [which] : [];
    if (!chosen.length) {
      console.error(`Usage: npx tsx scripts/proof/presence.ts <${Object.keys(steps).join('|')}|all>`);
      process.exit(2);
    }
    try {
      for (const name of chosen) {
        say(`--- ${name}`);
        await steps[name]();
      }
    } finally {
      if (which === 'all' || which === 'agent') await cleanupStep().catch((e) => say(`cleanup failed: ${String((e as Error).message)}`));
    }
    say(`--- summary\n${results.map((r) => `${r.pass === null ? 'NOT PROBED' : r.pass ? 'PASS' : 'FAIL'}  ${r.fact}`).join('\n')}`);
    process.exit(results.some((r) => r.pass === false) ? 1 : 0);
  }
}
