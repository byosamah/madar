import { describe, expect, it } from 'vitest';
import type { Db, Mail } from '../core/ports';
import { OUTBOX_INSERT_SQL, outboxMailPort } from './outboxDriver';
import { MailSendError } from './resend';

/**
 * MAIL_DRIVER=outbox (plan 5.4; task N2.1): the test deployment writes each mail to mail_outbox instead of sending it.
 * These tests use a recording Db; server/it/mailQuota.it.test.ts runs the same statement on the local database.
 */

const mail: Mail = { to: 'sara@madar.test', subject: 'S', html: '<p>S</p>', text: 'S', tag: 'invite', idempotencyKey: 'invite-usr_010' };

function recordingDb(answer: (values: unknown[]) => Record<string, unknown>[]) {
  const seen: { mode: string; text: string; values: unknown[] }[] = [];
  const refuse = () => Promise.reject(new Error('The outbox driver uses one statement, never a transaction.'));
  const db: Db = {
    tx: refuse,
    savepoint: refuse,
    async statement<R>(mode: 'read' | 'write', text: string, values: unknown[] = []) {
      seen.push({ mode, text, values });
      return answer(values) as R[];
    },
  };
  return { db, seen };
}

describe('the mail outbox driver', () => {
  it('writes the whole mail as one row in one write statement and returns an outbox id', async () => {
    const { db, seen } = recordingDb(() => [{ id: '7', same: true }]);
    await expect(outboxMailPort(db).send(mail)).resolves.toEqual({ id: 'outbox_7' });
    expect(seen).toEqual([{ mode: 'write', text: OUTBOX_INSERT_SQL, values: ['sara@madar.test', 'invite', 'invite-usr_010', JSON.stringify(mail)] }]);
  });

  it('answers a second send with the same key with the first row, as Resend does', async () => {
    const { db } = recordingDb(() => [{ id: 7, same: true }]);
    await expect(outboxMailPort(db).send(mail)).resolves.toEqual({ id: 'outbox_7' });
  });

  it('refuses a key that comes back with another mail, as Resend refuses it (409 invalid_idempotent_request)', async () => {
    const { db } = recordingDb(() => [{ id: 7, same: false }]);
    const error = await outboxMailPort(db).send({ ...mail, subject: 'Other' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailSendError);
    expect(error).toMatchObject({ status: 409, code: 'invalid_idempotent_request', retryable: false });
  });
});
