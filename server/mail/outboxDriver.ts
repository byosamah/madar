import type { Db, Mail, MailPort } from '../core/ports';
import { MailSendError } from './resend';
// The mail effects of every entry: server/core/deps.ts imports this file, so the handlers and the notice producers load once.
import './effects';

/**
 * MAIL_DRIVER=outbox (test deployment, plan 5.4; task N2.1): writes each mail to mail_outbox instead of sending it, so the browser
 * checks read the invitation and reset links from the table. It keeps the Resend rules for the idempotency key: the same key with
 * the same mail returns the first row, the same key with another mail is refused.
 *
 * "do update" with no real change makes the conflict row come back in "returning"; "same" compares the stored mail with the new one.
 */
export const OUTBOX_INSERT_SQL = `insert into mail_outbox (to_email, tag, idempotency_key, mail) values ($1, $2, $3, $4::jsonb)
on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
returning id, mail = $4::jsonb as same`;

export function outboxMailPort(db: Db): MailPort {
  return {
    async send(mail: Mail) {
      const [row] = await db.statement<{ id: string | number; same: boolean }>('write', OUTBOX_INSERT_SQL, [mail.to, mail.tag, mail.idempotencyKey, JSON.stringify(mail)]);
      if (!row.same) {
        throw new MailSendError('The idempotency key came back with another mail.', { status: 409, code: 'invalid_idempotent_request', retryable: false });
      }
      return { id: `outbox_${row.id}` };
    },
  };
}
