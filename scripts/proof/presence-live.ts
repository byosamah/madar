/**
 * The live check of chat presence on the test copy (chat presence design 2026-10-21, plan task J1 step 3). Two sample accounts sign in
 * with the password grant (tests/CLAUDE.md), so no browser is needed. It measures, in ms:
 * - status: the time until the admin sees the member Online, then Away, then Offline (a track, a track, a leave on `status:<member>`);
 * - typing: the time from the member's `chats.typing` call to the `typing` event on `person:<admin>`;
 * - seen: after the admin sends a message, the member's `chats.markRead` with `seen: true`, then the `changed` signal on
 *   `person:<admin>` and the seen entry of the member in the admin's `chats.messages`.
 * It also checks two leaks: the accounting account (not in the chat) gets no typing event, and its `chats.typing` answers not_found.
 * It writes one direct chat (if none) and one message on the test copy; the deploy suite seeds again at its end.
 * Run (sandbox off): node --import tsx scripts/proof/presence-live.ts. It prints names of steps and times, never a password or a token.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { buildId } from '../build-remote.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (file: string) => readFileSync(`${root}${file}`, 'utf8');
function valueIn(text: string, name: string): string {
  const line = text.split('\n').find((l) => l.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

const remote = read('config/remote.test.env');
const accounts = read('secrets/test-accounts.env');
const URL_ = valueIn(remote, 'VITE_SUPABASE_URL');
const KEY = valueIn(remote, 'VITE_SUPABASE_PUBLISHABLE_KEY');
if (!URL_.includes('qdgwpnesxppnqsaabqzd')) throw new Error('This check runs only on madar-test.');
const BUILD = buildId(new Date());

type Person = { label: string; client: SupabaseClient; token: string; id: string };

async function signIn(label: string, email: string, passwordName: string): Promise<Person> {
  const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: valueIn(accounts, passwordName) });
  if (error || !data.session) throw new Error(`The sign-in of ${label} failed (${error?.status ?? 'no session'}).`);
  const token = data.session.access_token;
  await client.realtime.setAuth(token);
  const session = (await call({ label, client, token, id: '' }, 'session.get', {})) as { authority: { id: string } };
  return { label, client, token, id: session.authority.id };
}

async function call(person: Person, name: string, input: unknown, write = false): Promise<unknown> {
  const response = await fetch(`${URL_}/functions/v1/api/batch?forceFunctionRegion=eu-central-1`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${person.token}`, 'Content-Type': 'application/json', 'X-Madar-Build': BUILD },
    body: JSON.stringify({ v: 1, calls: [{ i: 0, name, input, ...(write ? { key: randomUUID() } : {}) }] }),
  });
  const body = (await response.json().catch(() => ({}))) as { results?: { ok: boolean; output?: unknown; error?: { code: string } }[] };
  const entry = body.results?.[0];
  if (!response.ok || !entry) throw new Error(`${person.label} ${name}: HTTP ${response.status}.`);
  if (!entry.ok) throw Object.assign(new Error(`${person.label} ${name}: ${entry.error?.code}`), { code: entry.error?.code });
  return entry.output;
}

function join(person: Person, topic: string, presenceKey?: string): Promise<RealtimeChannel> {
  const channel = person.client.channel(topic, { config: { private: true, ...(presenceKey ? { presence: { key: presenceKey } } : {}) } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${person.label} could not join ${topic} in 10 s.`)), 10_000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(channel); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(`${person.label} ${topic}: ${status}`)); }
    });
  });
}

function until(test: () => boolean, ms = 15_000): Promise<number> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = setInterval(() => {
      if (test()) { clearInterval(tick); resolve(Date.now() - start); }
      else if (Date.now() - start > ms) { clearInterval(tick); reject(new Error(`No answer in ${ms} ms.`)); }
    }, 20);
  });
}

const lines: string[] = [];
const pass = (name: string, detail: string) => lines.push(`PASS ${name}: ${detail}`);
const fail = (name: string, detail: string) => lines.push(`FAIL ${name}: ${detail}`);

const admin = await signIn('admin', 'admin@madar.test', 'MADAR_TEST_PASSWORD_ADMIN');
const member = await signIn('member', 'member@madar.test', 'MADAR_TEST_PASSWORD_MEMBER');
const accounting = await signIn('accounting', 'accounting@madar.test', 'MADAR_TEST_PASSWORD_ACCOUNTING');

// Status: the admin reads the topic of the member; the member tracks on it.
const watched = await join(admin, `status:${member.id}`);
const stateOf = () => Object.values(watched.presenceState()).flat().map((p) => (p as { state?: string }).state);
const own = await join(member, `status:${member.id}`, 'live-check');
try {
  let start = Date.now();
  await own.track({ state: 'online' });
  await until(() => stateOf().includes('online'));
  pass('status online', `${Date.now() - start} ms`);
  start = Date.now();
  await own.track({ state: 'away' });
  await until(() => stateOf().includes('away') && !stateOf().includes('online'));
  pass('status away', `${Date.now() - start} ms`);
  start = Date.now();
  await member.client.removeChannel(own);
  await until(() => stateOf().length === 0);
  pass('status offline after a leave', `${Date.now() - start} ms`);
} catch (error) {
  fail('status', (error as Error).message);
}

// Typing and Seen in the direct chat of the admin and the member.
const opened = (await call(admin, 'chats.openDirect', { userId: member.id }, true)) as { conversationId?: string; id?: string; chat?: { id: string } };
const conversationId = opened.conversationId ?? opened.chat?.id ?? opened.id ?? '';
const typingAt: Record<string, number> = {};
let changedAt = 0;
const adminInbox = admin.client.channel(`person:${admin.id}`, { config: { private: true } })
  .on('broadcast', { event: 'typing' }, (m) => { if ((m.payload as { userId?: string }).userId === member.id) typingAt.admin = Date.now(); })
  .on('broadcast', { event: 'changed' }, () => { changedAt = Date.now(); });
const outsiderInbox = accounting.client.channel(`person:${accounting.id}`, { config: { private: true } })
  .on('broadcast', { event: 'typing' }, () => { typingAt.accounting = Date.now(); });
await Promise.all([
  new Promise<void>((resolve) => adminInbox.subscribe((s) => { if (s === 'SUBSCRIBED') resolve(); })),
  new Promise<void>((resolve) => outsiderInbox.subscribe((s) => { if (s === 'SUBSCRIBED') resolve(); })),
]);
try {
  const start = Date.now();
  const sent = (await call(member, 'chats.typing', { conversationId, typing: true })) as { sent: number };
  await until(() => typingAt.admin !== undefined, 5_000);
  pass('typing', `${typingAt.admin - start} ms from the call to the event, sent to ${sent.sent}`);
  await call(member, 'chats.typing', { conversationId, typing: false });
} catch (error) {
  fail('typing', (error as Error).message);
}
await new Promise((resolve) => setTimeout(resolve, 2000));
if (typingAt.accounting === undefined) pass('typing leak', 'the accounting account got no typing event');
else fail('typing leak', 'the accounting account got a typing event');
try {
  await call(accounting, 'chats.typing', { conversationId, typing: true });
  fail('typing call of an outsider', 'it was answered');
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code === 'not_found') pass('typing call of an outsider', 'not_found');
  else fail('typing call of an outsider', `answered ${code}`);
}
try {
  await call(admin, 'chats.send', { conversationId, body: `Live check ${new Date().toISOString()}` }, true);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  changedAt = 0;
  const start = Date.now();
  await call(member, 'chats.markRead', { conversationId, seen: true }, true);
  await until(() => changedAt > 0, 10_000);
  pass('seen signal', `${changedAt - start} ms from the look to the changed signal of the author`);
  const thread = (await call(admin, 'chats.messages', { conversationId })) as { seen: { userId: string; at: string }[]; messages: { message: { createdAt: string } }[] };
  const last = thread.messages.at(-1)?.message.createdAt ?? '';
  const entry = thread.seen.find((s) => s.userId === member.id);
  if (entry && entry.at >= last) pass('seen', 'the chat view of the admin has the seen time of the member, after the last message');
  else fail('seen', `no seen entry of the member after the last message (${thread.seen.length} entries)`);
} catch (error) {
  fail('seen', (error as Error).message);
}

for (const person of [admin, member, accounting]) {
  await person.client.removeAllChannels();
  await person.client.auth.signOut().catch(() => undefined);
}
console.log(`presence-live on madar-test, ${new Date().toISOString()}, build ${BUILD}`);
for (const line of lines) console.log(line);
process.exit(lines.some((line) => line.startsWith('FAIL')) ? 1 : 0);
