import { describe, expect, it } from 'vitest';
import { hashedKey } from '../auth/rateLimit';
import { FORGOT_IP_PER_HOUR } from '../auth/forgot';
import { RENEW_IP_PER_HOUR } from '../auth/renew';
import { SIGNIN_PER_ADDRESS, VERIFY_PER_ADDRESS } from '../auth/own/limits';
import { ENT_VADO } from '../enterprise/ids';
import { httpOf, nodeWorld } from './test/nodeWorld';

/**
 * The limit of one network address in the steps that run before a token (Madar enterprises, design 5.2). The Worker counts it once, in the
 * platform object, before it chooses the enterprise. So the same address stops at the same request, whatever the mix of known emails of
 * two enterprises and unknown emails. The objects count only the limits of the email and of the key.
 */

const SECOND = 'ent_002';
const ADDRESS = '203.0.113.9';
type Kind = 'one' | 'two' | 'unknown';
type World = Awaited<ReturnType<typeof world>>;

async function world() {
  return nodeWorld({ ents: [ENT_VADO, SECOND], minMs: { forgot: 0, renew: 0 }, sleep: async () => undefined });
}

/** The enterprise of a kind: one is ent_001, two is ent_002, unknown is in no directory. */
const entOf = (kind: Kind) => (kind === 'one' ? ENT_VADO : SECOND);

/** An email of the kind that no earlier request used, so the limit of the email never stops the sequence. */
async function emailOf(t: World, kind: Kind, i: number): Promise<string> {
  const email = `person${i}@${kind}.test`;
  if (kind !== 'unknown') await t.platform.reserveEmail({ ent: entOf(kind), email });
  return email;
}

/** The text of a key in a tagged form: ent_001.<secret>, ent_002.<secret>, or a text with no tag. */
const taggedOf = (kind: Kind, i: number) => (kind === 'unknown' ? `plain-${i}-secret` : `${entOf(kind)}.secret-${i}`);

type Step = {
  name: string;
  limit: number;
  send: (t: World, kind: Kind, i: number) => Promise<{ status: number; body: string }>;
};

const STEPS: Step[] = [
  {
    name: 'forgot',
    limit: FORGOT_IP_PER_HOUR,
    send: async (t, kind, i) => t.route(httpOf('POST', '/api/auth/forgot', { email: await emailOf(t, kind, i) }, { 'x-madar-client-address': ADDRESS })),
  },
  {
    name: 'renew',
    limit: RENEW_IP_PER_HOUR,
    send: async (t, kind, i) => t.route(httpOf('POST', '/api/auth/renew-invite', { key: taggedOf(kind, i) }, { 'x-madar-client-address': ADDRESS })),
  },
  {
    name: 'password sign-in',
    limit: SIGNIN_PER_ADDRESS,
    send: async (t, kind, i) => t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: await emailOf(t, kind, i), password: 'a wrong password' }, { 'x-madar-client-address': ADDRESS })),
  },
  {
    name: 'link open',
    limit: VERIFY_PER_ADDRESS,
    send: async (t, kind, i) => t.route(httpOf('POST', '/api/auth/verify', { token_hash: taggedOf(kind, i), type: 'invite' }, { 'x-madar-client-address': ADDRESS })),
  },
];

const KINDS: Kind[] = ['one', 'two', 'unknown'];

/** The request numbers (1 based) at which the answer is a 429. */
async function stops(t: World, step: Step, kinds: (i: number) => Kind, count: number): Promise<number[]> {
  const over: number[] = [];
  for (let i = 1; i <= count; i += 1) {
    const answer = await step.send(t, kinds(i), i);
    if (answer.status === 429) over.push(i);
  }
  return over;
}

describe('the limit of one address is the same for a known email of either enterprise and for an unknown email', () => {
  for (const step of STEPS) {
    it(`${step.name}: an address stops at request ${step.limit + 1} for ent_001, for ent_002, for an unknown email and for a mix of the three`, async () => {
      const sequences: [string, (i: number) => Kind][] = [
        ['only ent_001', () => 'one'],
        ['only ent_002', () => 'two'],
        ['only unknown', () => 'unknown'],
        ['mixed', (i) => KINDS[i % 3]],
        ['mixed, the unknown one last', (i) => (i > step.limit ? 'unknown' : KINDS[i % 2])],
      ];
      for (const [label, kinds] of sequences) {
        const t = await world();
        expect(await stops(t, step, kinds, step.limit + 3), label).toEqual([step.limit + 1, step.limit + 2, step.limit + 3]);
      }
    });
  }

  it('gives a known and an unknown email the same 429 body and status', async () => {
    for (const step of STEPS) {
      const answers: { status: number; body: string }[] = [];
      for (const kind of KINDS) {
        const t = await world();
        for (let i = 1; i <= step.limit; i += 1) await step.send(t, kind, i);
        const over = await step.send(t, kind, step.limit + 1);
        answers.push({ status: over.status, body: over.body });
      }
      expect(answers[0].status, step.name).toBe(429);
      expect(answers[1], step.name).toEqual(answers[0]);
      expect(answers[2], step.name).toEqual(answers[0]);
    }
  });

  it('does not count a request whose body is not a good email or key (as before)', async () => {
    const t = await world();
    for (let i = 0; i < FORGOT_IP_PER_HOUR + 3; i += 1) {
      expect((await t.route(httpOf('POST', '/api/auth/forgot', { email: 'nope' }, { 'x-madar-client-address': ADDRESS }))).status).toBe(400);
    }
    expect((await t.route(httpOf('POST', '/api/auth/forgot', { email: 'good@one.test' }, { 'x-madar-client-address': ADDRESS }))).status).toBe(200);
  });

  it('the answer of an unknown email still equals the answer of a known email below the limit', async () => {
    const t = await world();
    await t.platform.reserveEmail({ ent: ENT_VADO, email: 'known@one.test' });
    for (const [path, body] of [
      ['/api/auth/forgot', (email: string) => ({ email })],
      ['/api/auth/token', (email: string) => ({ grant_type: 'password', email, password: 'a wrong password' })],
    ] as const) {
      const known = await t.route(httpOf('POST', path, body('known@one.test'), { 'x-madar-client-address': '203.0.113.20' }));
      const unknown = await t.route(httpOf('POST', path, body('nobody@nowhere.test'), { 'x-madar-client-address': '203.0.113.21' }));
      expect([unknown.status, unknown.body], path).toEqual([known.status, known.body]);
    }
  });
});

describe('the objects of the enterprises keep no counter of the address', () => {
  const countsOf = (t: World, ent: string, prefix: string, address: string, key?: string) =>
    hashedKey(prefix, key ?? address).then((hashed) => {
      const raw = ent === 'platform' ? t.platformRaw : t.ents.get(ent)!.raw;
      return (raw.prepare('select coalesce(sum(count), 0) as n from rate_limits where key = ?').get(hashed) as { n: number }).n;
    });

  it('a routed forgot, renew, password sign-in and link open count the address in the platform object and not in the object of ent_001', async () => {
    const t = await world();
    await t.platform.reserveEmail({ ent: ENT_VADO, email: 'hala@one.test' });
    await t.route(httpOf('POST', '/api/auth/forgot', { email: 'hala@one.test' }, { 'x-madar-client-address': ADDRESS }));
    await t.route(httpOf('POST', '/api/auth/renew-invite', { key: 'ent_001.the-key' }, { 'x-madar-client-address': ADDRESS }));
    await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'hala@one.test', password: 'a wrong password' }, { 'x-madar-client-address': ADDRESS }));
    await t.route(httpOf('POST', '/api/auth/verify', { token_hash: 'ent_001.the-link', type: 'invite' }, { 'x-madar-client-address': ADDRESS }));
    for (const prefix of ['forgot:ip', 'renew:ip', 'signin:ip', 'verify:ip']) {
      expect(await countsOf(t, 'platform', prefix, ADDRESS), `platform ${prefix}`).toBe(1);
      expect(await countsOf(t, ENT_VADO, prefix, ADDRESS), `ent_001 ${prefix}`).toBe(0);
      expect(await countsOf(t, SECOND, prefix, ADDRESS), `ent_002 ${prefix}`).toBe(0);
    }
    // The limits of the email and of the key stay in the object of the enterprise.
    expect(await countsOf(t, ENT_VADO, 'forgot:email', '', 'hala@one.test')).toBe(1);
    expect(await countsOf(t, ENT_VADO, 'renew:key', '', 'the-key')).toBe(1);
    expect(await countsOf(t, ENT_VADO, 'signin:email', '', 'hala@one.test')).toBe(1);
  });

  it('an object that gets a call with no flag still counts the address itself (the local sign-in path)', async () => {
    const t = await world();
    const one = t.ents.get(ENT_VADO)!;
    await one.parts.signin({ ent: ENT_VADO, signin: 'auth.password', input: { email: 'hala@one.test', password: 'x', address: ADDRESS } });
    await one.parts.mailRoute({ ent: ENT_VADO, route: 'forgot', body: '{"email":"hala@one.test"}', address: ADDRESS }, t.net);
    expect(await countsOf(t, ENT_VADO, 'signin:ip', ADDRESS)).toBe(1);
    expect(await countsOf(t, ENT_VADO, 'forgot:ip', ADDRESS)).toBe(1);
  });

  it('a body field named addressChecked does not switch the count off for an object', async () => {
    const t = await world();
    await t.platform.reserveEmail({ ent: ENT_VADO, email: 'hala@one.test' });
    await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'hala@one.test', password: 'x', addressChecked: true }, { 'x-madar-client-address': ADDRESS }));
    await t.route(httpOf('POST', '/api/auth/forgot', { email: 'hala@one.test', addressChecked: true }, { 'x-madar-client-address': ADDRESS }));
    expect(await countsOf(t, 'platform', 'signin:ip', ADDRESS)).toBe(1);
    expect(await countsOf(t, 'platform', 'forgot:ip', ADDRESS)).toBe(1);
    expect(await countsOf(t, ENT_VADO, 'signin:ip', ADDRESS)).toBe(0);
  });
});
