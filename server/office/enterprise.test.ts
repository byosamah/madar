import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { ENT_VADO } from '../enterprise/ids';
import { OFFICE_NAME_HEADER } from './ops';
import type { OfficeParts } from './parts';
import { httpOf, NODE_TODAY, nodeOffice } from './test/nodeOffice';
import { recordingNet } from './test/fakes';

/**
 * The gate of the enterprise in every method of the office object (Madar enterprises, plan B Task 6). The object refuses a call that
 * names another enterprise, a call to an object that was never made, and a call to a paused object (but status and health).
 */

const OTHER = 'ent_002';
const net = recordingNet();
const BAD = { code: 'unauthenticated', message: 'Sign in to continue.' };

/** One call of each method with the enterprise given. A refusal comes back as { refusal } whatever its shape. */
function calls(parts: OfficeParts, ent: unknown) {
  const e = ent as never;
  const refusal = async (work: () => Promise<unknown>): Promise<unknown> => {
    try {
      const out = (await work()) as { ok?: boolean; error?: unknown; status?: number; body?: string } | undefined;
      if (out && out.ok === false) return { shape: 'ok-false', error: out.error };
      return { shape: 'value', value: out };
    } catch (error) {
      return { shape: 'thrown', code: (error as ApiError).code, message: (error as ApiError).message, details: (error as ApiError).details };
    }
  };
  return {
    batch: () => refusal(() => parts.batch({ ent: e, who: { kind: 'browser', authUserId: 'x' }, calls: [{ i: 0, name: 'session.get', input: {} }], overviewCalls: 0, worker: 0 }, net)),
    runEffects: () => refusal(() => parts.runEffects({ ent: e, ids: [], worker: 0 }, net)),
    cron: () => refusal(() => parts.cron({ ent: e, at: '2026-10-04T06:15:00.000Z', worker: 0 }, net)),
    signin: () => refusal(() => parts.signin({ ent: e, signin: 'auth.nothing', input: {} })),
    mailRoute: () => refusal(() => parts.mailRoute({ ent: e, route: 'forgot', body: '{}', address: '203.0.113.7' }, net)),
    mailWork: () => refusal(() => parts.mailWork({ ent: e, route: 'forgot', value: 'x@madar.test' }, net)),
    mcp: () => refusal(() => parts.mcp({ ent: e, mcpUrl: 'https://madar.test/mcp', url: 'https://madar.test/mcp', method: 'POST', headers: [], body: '{}', worker: 0 }, net)),
    status: () => refusal(() => parts.status({ ent: e })),
  };
}

type Name = keyof ReturnType<typeof calls>;
const NAMES: Name[] = ['batch', 'runEffects', 'cron', 'signin', 'mailRoute', 'mailWork', 'mcp', 'status'];

describe('the enterprise gate in the methods of the office object', () => {
  it('refuses a wrong ent in every method with the text of a bad token, and in the shape of that method', async () => {
    const t = await nodeOffice();
    const c = calls(t.parts, OTHER);
    expect(await c.batch()).toEqual({ shape: 'ok-false', error: BAD });
    expect(await c.signin()).toEqual({ shape: 'ok-false', error: BAD });
    expect(await c.mailRoute()).toMatchObject({ shape: 'value', value: { status: 401 } });
    expect(JSON.parse(((await c.mailRoute()) as { value: { body: string } }).value.body)).toEqual({ v: 1, error: BAD });
    expect(await c.mcp()).toMatchObject({ shape: 'value', value: { status: 401 } });
    for (const name of ['runEffects', 'cron', 'mailWork', 'status'] as const) {
      expect(await c[name](), name).toMatchObject({ shape: 'thrown', code: 'unauthenticated', message: 'Sign in to continue.' });
    }
  });

  it('refuses a malformed ent and a missing ent like a wrong one', async () => {
    const t = await nodeOffice();
    for (const ent of ['ENT_001', 5, undefined, null, 'ent_001 ']) {
      const answer = await calls(t.parts, ent).batch();
      expect(answer).toEqual({ shape: 'ok-false', error: BAD });
    }
  });

  it('a batch with ent_002 on the object of ent_001 gives unauthenticated and writes no row', async () => {
    const t = await nodeOffice();
    const before = t.raw.prepare('select (select count(*) from events) as e, (select count(*) from usage_day) as d, (select version from office_meta) as v').get();
    await calls(t.parts, OTHER).batch();
    expect(t.raw.prepare('select (select count(*) from events) as e, (select count(*) from usage_day) as d, (select version from office_meta) as v').get()).toEqual(before);
  });

  it('a batch with the right ent runs', async () => {
    const t = await nodeOffice();
    const out = await t.parts.batch({ ent: ENT_VADO, who: { kind: 'browser', authUserId: 'nobody' }, calls: [{ i: 0, name: 'session.get', input: {} }], overviewCalls: 0, worker: 0 }, net);
    // The gate lets it through; the person check of the batch then refuses a person who is not in the office.
    expect(out).toMatchObject({ ok: false, error: { code: 'unauthenticated' } });
    expect((out as { error: { message: string } }).error.message).not.toBe('Sign in to continue.');
  });

  it('an object with no row gives not_found on every method', async () => {
    const t = await nodeOffice({ row: false });
    const c = calls(t.parts, ENT_VADO);
    for (const name of NAMES) {
      const answer = (await c[name]()) as { shape: string; error?: { code: string }; value?: { status: number }; code?: string };
      const code = answer.shape === 'ok-false' ? answer.error?.code : answer.shape === 'thrown' ? answer.code : undefined;
      if (name === 'mailRoute' || name === 'mcp') expect(answer.value?.status, name).toBe(404);
      else expect(code, name).toBe('not_found');
    }
  });

  it('a paused object refuses batch, effects, cron and mcp with enterprise_paused, and lets signin, mail, status and health through', async () => {
    const t = await nodeOffice();
    t.raw.exec("update enterprise set state = 'paused'");
    t.parts.gate.forget();
    const c = calls(t.parts, ENT_VADO);
    expect(await c.batch()).toMatchObject({ shape: 'ok-false', error: { code: 'forbidden', details: { reason: 'enterprise_paused' } } });
    for (const name of ['runEffects', 'cron'] as const) expect(await c[name](), name).toMatchObject({ shape: 'thrown', details: { reason: 'enterprise_paused' } });
    expect(await c.mcp()).toMatchObject({ shape: 'value', value: { status: 403 } });
    // Any step but the password step answers session_ended on a paused object (plan C, Task 7).
    expect((await c.signin()) as { shape: string; error: { code: string } }).toMatchObject({ shape: 'ok-false', error: { code: 'unauthenticated', details: { reason: 'session_ended' } } });
    expect(await c.mailRoute()).toMatchObject({ shape: 'value', value: { status: 400 } });
    expect(await c.status()).toMatchObject({ shape: 'value', value: { ent: ENT_VADO } });
    expect(await t.parts.health()).toMatchObject({ schema: expect.any(Number) });
  });

  it('status gives the people, the invited, the last write and a day with four counts on the sample office', async () => {
    const t = await nodeOffice();
    const out = await t.parts.status({ ent: ENT_VADO });
    expect(out).toMatchObject({ ent: ENT_VADO, invited: 0, storageBytes: 0, name: '', nameAr: '' });
    expect(out.people).toBeGreaterThan(3);
    expect(Object.keys(out.day).sort()).toEqual(['mails', 'requests', 'rowsRead', 'rowsWritten']);
    expect(out.day.requests).toBeGreaterThanOrEqual(1);
    expect(typeof out.lastWriteAt === 'string' || out.lastWriteAt === null).toBe(true);
  });

  it('status counts the mails of the day as Resend does: sent kinds only, not the refusal mark', async () => {
    const t = await nodeOffice();
    t.raw.exec(`insert into mail_log (utc_day, kind, user_id, ref) values ('${NODE_TODAY}', 'notice', null, 'ent_001:a'), ('${NODE_TODAY}', 'signin', null, 'ent_001:b'), ('${NODE_TODAY}', 'refused', null, 'quota-refused'), ('2026-01-01', 'notice', null, 'ent_001:old')`);
    expect((await t.parts.status({ ent: ENT_VADO })).day.mails).toBe(2);
  });

  it('status names the enterprise name of the settings when they exist, and counts an invited person', async () => {
    const t = await nodeOffice();
    t.raw.exec("update settings set doc = json_set(doc, '$.enterpriseName', 'Globex', '$.enterpriseNameAr', 'جلوبكس')");
    t.raw.exec('update office_meta set version = version + 1');
    t.raw.exec("delete from office_snapshot");
    t.raw.exec("insert into auth_users (id, user_id, email, password_set, banned) values ('a1', 'usr_002', 'x@madar.test', 0, 0)");
    const out = await t.parts.status({ ent: ENT_VADO });
    expect(out).toMatchObject({ name: 'Globex', nameAr: 'جلوبكس', invited: 1 });
  });

  it('a Cron run reports the status of its enterprise', async () => {
    const t = await nodeOffice();
    const report = await t.parts.cron({ ent: ENT_VADO, at: '2026-10-04T06:15:00.000Z', worker: 2 }, net);
    expect(report.status).toMatchObject({ ent: ENT_VADO });
    expect(report.status.day.requests).toBeGreaterThanOrEqual(1);
  });
});

describe('the identity row at the first import', () => {
  const post = (parts: OfficeParts, name: string | null, body: unknown) => parts.ops(new Request('https://office.internal/office/import', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(name ? { [OFFICE_NAME_HEADER]: name } : {}) }, body: JSON.stringify(body),
  }));
  const rows = (t: Awaited<ReturnType<typeof nodeOffice>>) => t.raw.prepare('select id, state from enterprise').all();

  it('an import begin on a new object named ent_002 makes the row; a second begin keeps it', async () => {
    const t = await nodeOffice({ seed: false, row: false });
    const first = await post(t.parts, OTHER, { step: 'begin', mode: 'empty' });
    expect(first.status).toBe(200);
    expect(rows(t)).toEqual([{ id: OTHER, state: 'active' }]);
    const { id } = (await first.json()) as { id: string };
    await post(t.parts, OTHER, { step: 'abort', id });
    expect((await post(t.parts, OTHER, { step: 'begin', mode: 'empty' })).status).toBe(200);
    expect(rows(t)).toEqual([{ id: OTHER, state: 'active' }]);
  });

  it('the name office and a rehearsal name make no row', async () => {
    for (const name of ['office', 'rehearsal-20261108', null]) {
      const t = await nodeOffice({ seed: false, row: false });
      expect((await post(t.parts, name, { step: 'begin', mode: 'empty' })).status).toBe(200);
      expect(rows(t), String(name)).toEqual([]);
    }
  });

  it('routes through the Worker still send a plain request to a made object', async () => {
    const t = await nodeOffice();
    expect((await t.route(httpOf('GET', '/api/health'))).status).toBe(200);
  });
});
