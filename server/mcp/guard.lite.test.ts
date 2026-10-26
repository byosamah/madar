import { describe, expect, it } from 'vitest';
import { addSignIn, signinOffice, type TestOffice } from '../auth/own/testOffice';
import type { Mail } from '../core/ports';
import type { Deps } from '../core/ports';
import { createRunCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { liteData } from '../data/lite/callData';
import { readLiteOffice } from '../data/lite/office';
import { ensureAgentUser } from './agentUser';
import { CODE_TTL_MS, MAX_NEW_PER_HOUR } from './confirms';

/**
 * The email code guard (owner decision, 2026-10-26; server/mcp/guard.ts), run as an agent on node:sqlite, as the office object runs it.
 * The risky Admin acts of an agent need a code that Madar emails to the PERSON of the agent. Each test reads the code from that mail, as the
 * person would.
 */
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const run = createRunCall({ data: liteData });

type Agent = { agentId: string; clientId: string };

async function agentOf(t: TestOffice, ownerId: string, app = 'Claude'): Promise<Agent> {
  const known = t.raw.prepare('select id from auth_users where user_id = ?').get(ownerId) as { id: string } | undefined;
  const authId = known?.id ?? (await addSignIn(t, ownerId, { password: 'a good password' }));
  const clientId = crypto.randomUUID();
  const now = t.deps.clock.now().toISOString();
  t.raw.prepare('insert into oauth_clients (id, name, redirect_uris, created_at) values (?, ?, ?, ?)').run(clientId, app, JSON.stringify([CALLBACK]), now);
  t.raw.prepare('insert into agent_approvals (client_id, owner_user_id, approved_at) values (?, ?, ?)').run(clientId, ownerId, now);
  t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at, created_at) values (?, ?, ?, 'oauth', ?, '2026-11-17T06:00:00.000Z', ?)").run(`s-${clientId}`, authId, clientId, `h-${clientId}`, now);
  const deps = t.deps as unknown as Deps;
  const made = await ensureAgentUser(deps, { ownerId, clientId, data: liteData(deps) });
  return { agentId: made.agentUserId, clientId };
}

const asAgent = (t: TestOffice, agent: Agent, name: string, input: unknown): Promise<RunResult> =>
  run(t.deps as unknown as Deps, { principal: { userId: agent.agentId, agent: { clientId: agent.clientId } }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });

const officeOf = (t: TestOffice) => t.db.tx('read', (q) => readLiteOffice(t.db, q));
const confirmMails = (t: TestOffice): Mail[] => t.deps.mail.sent.filter((mail) => mail.tag === 'confirm');
const codeOf = (mail: Mail): string => /(?<![\d])(\d{6})(?![\d])/.exec(mail.text)![1];
const reasonOf = (result: RunResult) => (result.ok ? undefined : (result.error.details as { reason?: string } | undefined)?.reason);
const rowsOf = (t: TestOffice) => t.raw.prepare('select * from agent_confirms order by created_at, id').all() as Record<string, unknown>[];

/**
 * again: what the second call with the used code meets. guard: the code is dead (confirm_invalid). handler: the handler refuses first, as the
 * act is done already (an email in use, a name in use). free: the act needs no code now, as the role equals the stored one.
 */
type Act = { name: string; label: string; again: 'guard' | 'handler' | 'free'; prepare: (t: TestOffice) => Promise<unknown>; changed: (t: TestOffice, input: any) => Promise<boolean> };

const person = async (t: TestOffice, name: string, input: unknown) => {
  const result = await t.call('usr_001', name, input);
  if (!result.ok) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
  return result.output as any;
};

const ACTS: Act[] = [
  {
    name: 'users.create', label: 'an invitation', again: 'handler',
    prepare: async () => ({ name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' }),
    changed: async (t, input) => Object.values((await officeOf(t)).lists.users).some((user) => user.email === input.email),
  },
  {
    name: 'users.update', label: 'a change of role', again: 'free',
    prepare: async () => ({ id: 'usr_003', patch: { systemRole: 'management' } }),
    changed: async (t) => (await officeOf(t)).lists.users.usr_003.systemRole === 'management',
  },
  {
    name: 'users.deactivate', label: 'a turn-off', again: 'guard',
    prepare: async () => ({ id: 'usr_004' }),
    changed: async (t) => (await officeOf(t)).lists.users.usr_004.active === false,
  },
  {
    name: 'users.reactivate', label: 'a turn-on', again: 'guard',
    prepare: async (t) => {
      await person(t, 'users.deactivate', { id: 'usr_004' });
      return { id: 'usr_004' };
    },
    changed: async (t) => (await officeOf(t)).lists.users.usr_004.active === true,
  },
  {
    name: 'users.remove', label: 'a remove', again: 'guard',
    prepare: async (t) => {
      await person(t, 'users.deactivate', { id: 'usr_004' });
      return { id: 'usr_004' };
    },
    changed: async (t) => (await officeOf(t)).lists.users.usr_004.removed === true,
  },
  {
    name: 'roles.create', label: 'a new role', again: 'handler',
    prepare: async () => ({ name: 'Site supervisors', nameAr: 'مشرفو المواقع', rights: ['task.deleteOwn'] }),
    changed: async (t) => ((await officeOf(t)).lists.settings.roles?.custom ?? []).some((role) => role.name === 'Site supervisors'),
  },
  {
    name: 'roles.update', label: 'a change of the rights of a role', again: 'guard',
    prepare: async (t) => {
      const role = await person(t, 'roles.create', { name: 'Site supervisors', nameAr: 'مشرفو المواقع', rights: ['task.deleteOwn'] });
      return { role: role.id, name: 'Site supervisors, Al Khobar' };
    },
    changed: async (t) => ((await officeOf(t)).lists.settings.roles?.custom ?? []).some((role) => role.name === 'Site supervisors, Al Khobar'),
  },
  {
    name: 'roles.delete', label: 'a delete of a role', again: 'handler',
    prepare: async (t) => ({ id: (await person(t, 'roles.create', { name: 'Site supervisors', nameAr: 'مشرفو المواقع', rights: ['task.deleteOwn'] })).id }),
    changed: async (t) => !((await officeOf(t)).lists.settings.roles?.custom ?? []).some((role) => role.name === 'Site supervisors'),
  },
];

describe('the email code guard, for an agent on SQLite', () => {
  for (const act of ACTS) {
    describe(`${act.name} (${act.label})`, () => {
      it('is refused without a code, changes nothing, and sends exactly one mail, to the person only', async () => {
        const t = await signinOffice();
        const agent = await agentOf(t, 'usr_001');
        const input = await act.prepare(t);
        const before = t.deps.mail.sent.length;
        const first = await asAgent(t, agent, act.name, input);
        expect(first).toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'confirm_needed' } } });
        expect(await act.changed(t, input)).toBe(false);
        expect(confirmMails(t)).toHaveLength(1);
        // No other mail went out (an invitation would be one).
        expect(t.deps.mail.sent).toHaveLength(before + 1);
        const owner = (await officeOf(t)).lists.users.usr_001;
        expect(confirmMails(t)[0].to).toBe(owner.email);
      });

      it('runs with the right code and the same input, and the code works one time', async () => {
        const t = await signinOffice();
        const agent = await agentOf(t, 'usr_001');
        const input = await act.prepare(t);
        expect((await asAgent(t, agent, act.name, input)).ok).toBe(false);
        const code = codeOf(confirmMails(t)[0]);
        const done = await asAgent(t, agent, act.name, { ...(input as object), confirmCode: code });
        expect(done, JSON.stringify(done)).toMatchObject({ ok: true });
        expect(await act.changed(t, input)).toBe(true);
        // A used code never works again: the second call gets no act, and no new mail goes.
        const mails = confirmMails(t).length;
        const again = await asAgent(t, agent, act.name, { ...(input as object), confirmCode: code });
        if (act.again === 'guard') expect(reasonOf(again)).toBe('confirm_invalid');
        if (act.again === 'handler') expect(again.ok === false && again.error.details?.reason !== 'confirm_invalid').toBe(true);
        if (act.again === 'free') expect(again.ok).toBe(true);
        expect(confirmMails(t)).toHaveLength(mails);
      });
    });
  }

  it('fails a right code with a changed input, and does not send a new mail', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    const input = { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' };
    await asAgent(t, agent, 'users.create', input);
    const code = codeOf(confirmMails(t)[0]);
    const changed = await asAgent(t, agent, 'users.create', { ...input, systemRole: 'admin', confirmCode: code });
    expect(reasonOf(changed)).toBe('confirm_invalid');
    const other = await asAgent(t, agent, 'users.create', { ...input, email: 'someone.else@madar.test', confirmCode: code });
    expect(reasonOf(other)).toBe('confirm_invalid');
    expect(Object.values((await officeOf(t)).lists.users).some((user) => user.email.includes('new.person') || user.email.includes('someone.else'))).toBe(false);
    expect(confirmMails(t)).toHaveLength(1);
    // The right code with the right input still works: a changed input burns nothing.
    expect((await asAgent(t, agent, 'users.create', { ...input, confirmCode: code })).ok).toBe(true);
  });

  it('does not take the code of one act for another call of the same agent, or for the agent of another person', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    await asAgent(t, agent, 'users.deactivate', { id: 'usr_004' });
    const code = codeOf(confirmMails(t)[0]);
    expect(reasonOf(await asAgent(t, agent, 'users.deactivate', { id: 'usr_005', confirmCode: code }))).toBe('confirm_invalid');
    expect(reasonOf(await asAgent(t, agent, 'users.remove', { id: 'usr_004', confirmCode: code }))).not.toBe(undefined);
    // Another AI app of the same person is another agent user: the code belongs to the agent that asked for it.
    const second = await agentOf(t, 'usr_001', 'Other app');
    expect(second.agentId).not.toBe(agent.agentId);
    expect(reasonOf(await asAgent(t, second, 'users.deactivate', { id: 'usr_004', confirmCode: code }))).toBe('confirm_invalid');
    expect((await officeOf(t)).lists.users.usr_004.active).toBe(true);
  });

  it('counts a wrong code, and the sixth try fails even with the right code', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    const input = { id: 'usr_004' };
    await asAgent(t, agent, 'users.deactivate', input);
    const right = codeOf(confirmMails(t)[0]);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      expect(reasonOf(await asAgent(t, agent, 'users.deactivate', { ...input, confirmCode: wrong })), `try ${i + 1}`).toBe('confirm_wrong');
    }
    expect(rowsOf(t)[0].tries).toBe(5);
    expect(reasonOf(await asAgent(t, agent, 'users.deactivate', { ...input, confirmCode: right }))).toBe('confirm_invalid');
    expect((await officeOf(t)).lists.users.usr_004.active).toBe(true);
    // The dead row lets the agent ask for a new code: a new mail, a new code.
    expect(reasonOf(await asAgent(t, agent, 'users.deactivate', input))).toBe('confirm_needed');
    expect(confirmMails(t)).toHaveLength(2);
    expect((await asAgent(t, agent, 'users.deactivate', { ...input, confirmCode: codeOf(confirmMails(t)[1]) })).ok).toBe(true);
  });

  it('counts the try before the compare: 10 parallel wrong codes give 5 wrong answers, the rest are dead, and the act does not run', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    const input = { id: 'usr_004' };
    await asAgent(t, agent, 'users.deactivate', input);
    const right = codeOf(confirmMails(t)[0]);
    const guesses = Array.from({ length: 10 }, (_, i) => String(100_000 + i * 7919));
    expect(guesses).not.toContain(right);
    const answers = await Promise.all(guesses.map((confirmCode) => asAgent(t, agent, 'users.deactivate', { ...input, confirmCode })));
    const reasons = answers.map(reasonOf);
    // Only five tries reach the compare. The other five meet a dead code.
    expect(reasons.filter((reason) => reason === 'confirm_wrong')).toHaveLength(5);
    expect(reasons.filter((reason) => reason === 'confirm_invalid')).toHaveLength(5);
    expect(rowsOf(t)[0].tries).toBe(5);
    expect((await officeOf(t)).lists.users.usr_004.active).toBe(true);
    // The row is dead, so the right code fails too, and the act stays undone.
    expect(reasonOf(await asAgent(t, agent, 'users.deactivate', { ...input, confirmCode: right }))).toBe('confirm_invalid');
    expect((await officeOf(t)).lists.users.usr_004.active).toBe(true);
    expect(rowsOf(t)[0].used_at).toBeNull();
  });

  it('lets the right code win as the fifth try, and counts it as a try', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    const input = { id: 'usr_004' };
    await asAgent(t, agent, 'users.deactivate', input);
    const right = codeOf(confirmMails(t)[0]);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) await asAgent(t, agent, 'users.deactivate', { ...input, confirmCode: wrong });
    expect((await asAgent(t, agent, 'users.deactivate', { ...input, confirmCode: right })).ok).toBe(true);
    expect(rowsOf(t)[0].tries).toBe(5);
    expect(rowsOf(t)[0].used_at).not.toBeNull();
  });

  it('counts four wrong codes and still accepts the right one', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    await asAgent(t, agent, 'users.deactivate', { id: 'usr_004' });
    const right = codeOf(confirmMails(t)[0]);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) await asAgent(t, agent, 'users.deactivate', { id: 'usr_004', confirmCode: wrong });
    expect((await asAgent(t, agent, 'users.deactivate', { id: 'usr_004', confirmCode: right })).ok).toBe(true);
  });

  it('fails an expired code', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    await asAgent(t, agent, 'users.deactivate', { id: 'usr_004' });
    const code = codeOf(confirmMails(t)[0]);
    t.deps.clock.advance(CODE_TTL_MS + 1000);
    expect(reasonOf(await asAgent(t, agent, 'users.deactivate', { id: 'usr_004', confirmCode: code }))).toBe('confirm_invalid');
    expect((await officeOf(t)).lists.users.usr_004.active).toBe(true);
    // A new first call after the end sends a new code.
    expect(reasonOf(await asAgent(t, agent, 'users.deactivate', { id: 'usr_004' }))).toBe('confirm_needed');
    expect(confirmMails(t)).toHaveLength(2);
  });

  it('accepts a code just before it ends', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    await asAgent(t, agent, 'users.deactivate', { id: 'usr_004' });
    const code = codeOf(confirmMails(t)[0]);
    t.deps.clock.advance(CODE_TTL_MS - 1000);
    expect((await asAgent(t, agent, 'users.deactivate', { id: 'usr_004', confirmCode: code })).ok).toBe(true);
  });

  it('sends one mail for one exact act, however often the agent asks again', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    for (let i = 0; i < 4; i += 1) expect(reasonOf(await asAgent(t, agent, 'users.deactivate', { id: 'usr_004' }))).toBe('confirm_needed');
    expect(confirmMails(t)).toHaveLength(1);
    expect(rowsOf(t)).toHaveLength(1);
  });

  it(`stops after ${MAX_NEW_PER_HOUR} codes for one person in one hour, and sends no sixth mail`, async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    const ids = ['usr_002', 'usr_003', 'usr_004', 'usr_005', 'usr_006', 'usr_007'];
    const reasons: (string | undefined)[] = [];
    for (const id of ids) reasons.push(reasonOf(await asAgent(t, agent, 'users.deactivate', { id })));
    expect(reasons).toEqual([...Array(MAX_NEW_PER_HOUR).fill('confirm_needed'), 'confirm_limit']);
    expect(confirmMails(t)).toHaveLength(MAX_NEW_PER_HOUR);
    t.deps.clock.advance(3_600_000 + 1000);
    expect(reasonOf(await asAgent(t, agent, 'users.deactivate', { id: ids[5] }))).toBe('confirm_needed');
  });

  it('asks no code of a person in the screens', async () => {
    const t = await signinOffice();
    expect((await t.call('usr_001', 'users.create', { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' })).ok).toBe(true);
    expect((await t.call('usr_001', 'users.update', { id: 'usr_003', patch: { systemRole: 'management' } })).ok).toBe(true);
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_004' })).ok).toBe(true);
    expect((await t.call('usr_001', 'roles.create', { name: 'Site supervisors', nameAr: 'مشرفو المواقع', rights: [] })).ok).toBe(true);
    expect(confirmMails(t)).toHaveLength(0);
    expect(rowsOf(t)).toHaveLength(0);
    // A confirmCode in the input of a person is no field of the call: the call ignores it.
    expect((await t.call('usr_001', 'users.reactivate', { id: 'usr_004', confirmCode: '123456' })).ok).toBe(true);
  });

  it('asks no code for a change of users.update that keeps the role as it is, or changes another field', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    const stored = (await officeOf(t)).lists.users.usr_003;
    expect((await asAgent(t, agent, 'users.update', { id: 'usr_003', patch: { discipline: 'Planner' } })).ok).toBe(true);
    expect((await asAgent(t, agent, 'users.update', { id: 'usr_003', patch: { systemRole: stored.systemRole, roleId: stored.roleId ?? null } })).ok).toBe(true);
    expect(confirmMails(t)).toHaveLength(0);
    expect(reasonOf(await asAgent(t, agent, 'users.update', { id: 'usr_003', patch: { systemRole: 'accounting' } }))).toBe('confirm_needed');
    expect(confirmMails(t)).toHaveLength(1);
  });

  it('asks a code for a custom role of a person as well as for a system role', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    const role = await person(t, 'roles.create', { name: 'Site supervisors', nameAr: 'مشرفو المواقع', rights: [] });
    expect(reasonOf(await asAgent(t, agent, 'users.update', { id: 'usr_003', patch: { roleId: role.id } }))).toBe('confirm_needed');
    expect(confirmMails(t)[0].text).toContain('Site supervisors');
    expect((await asAgent(t, agent, 'users.update', { id: 'usr_003', patch: { roleId: role.id }, confirmCode: codeOf(confirmMails(t)[0]) })).ok).toBe(true);
    expect((await officeOf(t)).lists.users.usr_003.roleId).toBe(role.id);
  });

  it('sends no mail for a refused act: the rights of the person come first', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_003');
    const before = t.deps.mail.sent.length;
    for (const [name, input] of [
      ['users.create', { name: 'X', email: 'x@madar.test', systemRole: 'member', discipline: 'Design' }],
      ['users.deactivate', { id: 'usr_004' }],
      ['roles.create', { name: 'X', nameAr: 'س', rights: [] }],
    ] as const) {
      expect(await asAgent(t, agent, name, input)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    }
    // A bad field and a missing record answer as before too.
    const admin = await agentOf(t, 'usr_001');
    expect(await asAgent(t, admin, 'users.create', { name: 'X', email: 'not an email', systemRole: 'member', discipline: 'Design' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await asAgent(t, admin, 'users.deactivate', { id: 'usr_999' })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const taken = (await officeOf(t)).lists.users.usr_003.email;
    expect(await asAgent(t, admin, 'users.create', { name: 'X', email: taken, systemRole: 'member', discipline: 'Design' })).toMatchObject({ ok: false, error: { details: { reason: 'email_taken' } } });
    expect(t.deps.mail.sent).toHaveLength(before);
    expect(rowsOf(t)).toHaveLength(0);
  });

  it('keeps the code out of the answers, the log, the events and the table', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    const input = { id: 'usr_004' };
    const first = await asAgent(t, agent, 'users.deactivate', input);
    const code = codeOf(confirmMails(t)[0]);
    const wrong = code === '000000' ? '111111' : '000000';
    const second = await asAgent(t, agent, 'users.deactivate', { ...input, confirmCode: wrong });
    const third = await asAgent(t, agent, 'users.deactivate', { ...input, confirmCode: code });
    for (const result of [first, second, third]) expect(JSON.stringify(result)).not.toContain(code);
    expect(JSON.stringify(t.deps.logs)).not.toContain(code);
    expect(JSON.stringify(rowsOf(t))).not.toContain(code);
    const events = t.raw.prepare('select doc from events').all() as { doc: string }[];
    expect(JSON.stringify(events)).not.toContain(code);
    // The code left the outbox row once the mail went.
    const outbox = t.raw.prepare("select payload from outbox where kind = 'mcp.confirm'").all() as { payload: string }[];
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload).not.toContain(code);
    expect(JSON.parse(outbox[0].payload).code).toBeUndefined();
  });

  it('writes a mail with the code and one plain line, no link and no other secret, in the language of the person', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    await asAgent(t, agent, 'users.create', { name: 'New Person', email: 'new.person@madar.test', systemRole: 'admin', discipline: 'Architect' });
    const [mail] = confirmMails(t);
    const code = codeOf(mail);
    expect(mail.to).toBe((await officeOf(t)).lists.users.usr_001.email);
    expect(mail.subject).not.toContain(code);
    expect(mail.text).toContain('wants to invite New Person (new.person@madar.test) to Madar with the role Admin.');
    expect(mail.text).toContain(code);
    expect(mail.text).not.toMatch(/https?:/);
    expect(mail.html).not.toMatch(/href=/);
    expect(mail.html).toContain(code);
    // The code is in the mail twice at most (the page and the plain text), and the hash and the ids of the row are not in it.
    const row = rowsOf(t)[0];
    for (const secret of [row.code_hash, row.input_hash, row.id]) {
      expect(mail.html).not.toContain(String(secret));
      expect(mail.text).not.toContain(String(secret));
    }
  });

  it('writes the mail in Arabic for a person whose screens are in Arabic', async () => {
    const t = await signinOffice();
    await t.db.tx('write', async (q) => {
      const [row] = await q<{ doc: string | object }>("select doc from users where id = 'usr_001'");
      const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc as any;
      doc.preferences = { ...doc.preferences, language: 'ar' };
      await q("update users set doc = ?1 where id = 'usr_001'", [JSON.stringify(doc)]);
    });
    const agent = await agentOf(t, 'usr_001');
    await asAgent(t, agent, 'users.deactivate', { id: 'usr_004' });
    const [mail] = confirmMails(t);
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.text).toMatch(/يريد أن يوقف حساب/);
    expect(mail.text).toContain(codeOf(mail));
  });

  it('cleans a name that the agent sends before it goes into the mail', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    const mark = String.fromCharCode(0x202e);
    const name = `Evil${mark}<b>Person</b>${String.fromCharCode(10)}${'x'.repeat(58)}`;
    await asAgent(t, agent, 'users.create', { name, email: 'evil.person@madar.test', systemRole: 'member', discipline: 'Architect' });
    const [mail] = confirmMails(t);
    expect(mail.text).not.toContain(mark);
    expect(mail.html).not.toContain('<b>Person');
    expect(mail.text).not.toContain('x'.repeat(45));
  });
});
