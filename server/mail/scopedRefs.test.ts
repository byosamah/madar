import { describe, expect, it } from 'vitest';
import { freshLite } from '../data/lite/testDb';
import { statementQuery } from '../data/dialect';
import { entOfConfig, scopedRef } from '../enterprise/scope';
import { fixedClock } from '../test/fakes/clock';
import { fakeDeps } from '../test/fakes/deps';
import { fakeMail } from '../test/fakes/mail';
import { memoryMailDb } from './memoryMailDb';
import type { Mail } from '../core/ports';
import { sendCounted, sentToday } from './quota';

/**
 * Madar enterprises, plan D task 1: a mail key and a mail_log ref start with the enterprise id. Record ids such as usr_001 repeat in
 * every enterprise, and the Resend account is one, so a bare key would make Resend drop the mail of the second enterprise.
 */

const mailFor = (key: string): Mail => ({ to: 'sara@madar.test', subject: 's', html: '<p>s</p>', text: 's', tag: 'notice', idempotencyKey: key });

async function office(ent: string, shared: ReturnType<typeof fakeMail>) {
  const lite = await freshLite();
  const deps = fakeDeps({ db: lite.db, config: { ent } });
  deps.mail = shared;
  return { lite, deps };
}

describe('scopedRef and entOfConfig', () => {
  it('puts the enterprise id before the key', () => {
    expect(scopedRef('ent_002', 'notice-ntf_001')).toBe('ent_002:notice-ntf_001');
  });

  it('reads a missing enterprise as VADOs Companies', () => {
    expect(entOfConfig({})).toBe('ent_001');
    expect(entOfConfig({ ent: 'ent_002' })).toBe('ent_002');
  });
});

describe('mail keys of two enterprises', () => {
  it('gives two enterprises with the same person id and the same day two different Resend keys', async () => {
    const resend = fakeMail();
    const one = await office('ent_001', resend);
    const two = await office('ent_002', resend);
    const at = '2026-11-08T06:00:00Z';
    one.deps.clock = fixedClock(at);
    two.deps.clock = fixedClock(at);
    const a = await sendCounted(one.deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_001' });
    const b = await sendCounted(two.deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_001' });
    expect(a.status).toBe('sent');
    expect(b.status).toBe('sent');
    expect(resend.sent.map((m) => m.idempotencyKey)).toEqual(['ent_001:notice-ntf_001', 'ent_002:notice-ntf_001']);
    for (const [o, ent] of [[one, 'ent_001'], [two, 'ent_002']] as const) {
      const rows = o.lite.raw.prepare('select ref from mail_log').all() as { ref: string }[];
      expect(rows).toEqual([{ ref: `${ent}:notice-ntf_001` }]);
      expect(await sentToday(statementQuery(o.deps.db, 'read'), { now: new Date(at) })).toBe(1);
    }
  });

  it('keeps one place when the same enterprise sends the same key twice', async () => {
    const resend = fakeMail();
    const two = await office('ent_002', resend);
    two.deps.clock = fixedClock('2026-11-08T06:00:00Z');
    await sendCounted(two.deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_001' });
    await sendCounted(two.deps, 'notice', mailFor('notice-ntf_001'), { userId: 'usr_001' });
    expect(two.lite.raw.prepare('select ref from mail_log').all()).toHaveLength(1);
    expect(resend.sent.map((m) => m.idempotencyKey)).toEqual(['ent_002:notice-ntf_001', 'ent_002:notice-ntf_001']);
  });

  it('writes only the scoped ref to the log', async () => {
    const resend = fakeMail();
    const db = memoryMailDb();
    const deps = fakeDeps({ db: db.db, config: { ent: 'ent_003' } });
    deps.mail = resend;
    await sendCounted(deps, 'signin', mailFor('invite:inv_1'), { userId: 'usr_001' });
    expect(db.log.map((r) => r.ref)).toEqual(['ent_003:invite:inv_1']);
  });
});
