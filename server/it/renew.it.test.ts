import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { RENEW_PARAM } from '../auth/invite';
import { createRenewRoute, RENEW_PATH } from '../auth/renew';
import { runCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { setEnvSource } from '../env';
import { authOf, linkIn, localStack } from './authStack';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * Security fix 7 on the local stack [Docker]: an Auth link lives 1 hour (otp_expiry), so an invitation that is out of date asks
 * for a new link on the Welcome screen with the renew key of its mail (server/auth/renew.ts). users.create through runCall as
 * madar_server, the invitation effect and the renew route with the real Auth of the local stack, and the mail in the fake.
 * The test makes a link out of date as time does: Auth compares auth.users.confirmation_sent_at with otp_expiry (verify.go).
 * Run it after "supabase db reset" from this worktree.
 */

const stack = localStack();
const auth = authOf(stack, 'h-renew');
const route = createRenewRoute({ minMs: 0 });
const OK = JSON.stringify({ v: 1, ok: true });
let office: ItOffice;
let deps: ReturnType<ItOffice['isolate']>;
let ip = 0;

const call = (userId: string, name: string, input: unknown) => runCall(deps, { principal: { userId }, name, input, batch: newBatch() });

function okOf<T>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

const mailsTo = (email: string) => deps.mail.sent.filter((mail) => mail.to === email);
const lastTo = (email: string) => mailsTo(email).at(-1)!;
const keyOf = (text: string) => linkIn(text).searchParams.get(RENEW_PARAM)!;
const tokenHashOf = (text: string) => linkIn(text).searchParams.get('token_hash')!;

async function invite(label: string): Promise<{ user: User; email: string }> {
  const email = auth.email(label);
  const user = okOf<User>(await call('usr_001', 'users.create', { name: `Person ${label}`, email, discipline: 'Architect' }));
  return { user, email };
}

/** Time passes for the link of this person: Auth sent it two days ago. */
async function outOfDate(userId: string): Promise<void> {
  await office.sql("update auth.users set confirmation_sent_at = now() - interval '2 days' where id = (select auth_user_id from users where id = $1)", [userId]);
}

/** The Welcome screen asks for a new link with the key of the mail. */
async function renew(key: string): Promise<string> {
  ip += 1;
  const response = await route(new Request(`http://127.0.0.1${RENEW_PATH}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `198.51.100.${ip}` }, body: JSON.stringify({ key }),
  }), deps);
  return `${response.status} ${await response.text()}`;
}

beforeAll(async () => {
  setEnvSource({ SUPABASE_URL: stack.apiUrl });
  office = await startOffice('hrenew');
  deps = office.isolate();
  deps.authAdmin = auth.admin as unknown as typeof deps.authAdmin;
  deps.clock.set(new Date());
}, 60_000);

afterAll(async () => {
  setEnvSource(undefined);
  await auth.cleanup();
  await office?.close();
});

describe('security fix 7: a new link for an invitation that is out of date', () => {
  it('the link is out of date at Auth; the key of its mail sends a new invitation to the same address, and the new link sets a password', async () => {
    const { user, email } = await invite('late');
    const first = lastTo(email).text;
    await outOfDate(user.id);
    const old = await auth.useLink('invite', tokenHashOf(first));
    expect([old.status, auth.codeOf(old)]).toEqual([403, 'otp_expired']);

    expect(await renew(keyOf(first))).toBe(`200 ${OK}`);
    expect(mailsTo(email)).toHaveLength(2);
    const second = lastTo(email).text;
    expect(linkIn(second).pathname).toBe('/welcome');
    expect(keyOf(second)).not.toBe(keyOf(first));
    const used = await auth.useLink('invite', tokenHashOf(second));
    expect(used.status).toBe(200);
    expect(await auth.setPassword(auth.tokenOf(used))).toBe(200);
    expect((await auth.signIn(email)).status).toBe(200);

    // Madar keeps only the sha256 of each key, and the renewal counts against the daily mail quota as sign-in mail.
    const outbox = await office.sql<{ payload: string }>("select payload::text as payload from outbox where payload->>'userId' = $1", [user.id]);
    expect(outbox.length).toBeGreaterThan(1);
    for (const row of outbox) {
      expect(row.payload).not.toContain(keyOf(first));
      expect(row.payload).not.toContain(keyOf(second));
    }
    const counted = await office.sql<{ kind: string }>('select kind from mail_log where user_id = $1', [user.id]);
    expect(counted.map((row) => row.kind)).toEqual(['signin']);
  });

  it('a used key, an unknown key, the key of a person who accepted and the key of a removed person get the same answer and send nothing', async () => {
    const { user, email } = await invite('same');
    const first = lastTo(email).text;
    await outOfDate(user.id);
    expect(await renew(keyOf(first))).toBe(`200 ${OK}`);
    const accepted = lastTo(email).text;
    const used = await auth.useLink('invite', tokenHashOf(accepted));
    expect(await auth.setPassword(auth.tokenOf(used))).toBe(200);

    const removed = await invite('removed');
    const removedKey = keyOf(lastTo(removed.email).text);
    expect(await call('usr_001', 'users.deactivate', { id: removed.user.id })).toMatchObject({ ok: true });

    const before = deps.mail.sent.length;
    const answers = [
      await renew(keyOf(first)),
      await renew('abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst'),
      await renew(keyOf(accepted)),
      await renew(removedKey),
    ];
    expect(new Set(answers)).toEqual(new Set([`200 ${OK}`]));
    expect(deps.mail.sent).toHaveLength(before);
  });

  it('two presses of the button at the same moment send one invitation', async () => {
    const { user, email } = await invite('twice');
    const key = keyOf(lastTo(email).text);
    await outOfDate(user.id);
    const answers = await Promise.all([renew(key), renew(key)]);
    expect(answers).toEqual([`200 ${OK}`, `200 ${OK}`]);
    expect(mailsTo(email)).toHaveLength(2);
  });
});
