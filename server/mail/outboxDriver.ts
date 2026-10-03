import { notBuiltAsync } from '../core/notBuilt';
import type { Db, MailPort } from '../core/ports';

/** MAIL_DRIVER=outbox (test deployment): writes each mail to mail_outbox instead of sending it (plan 5.4). Track N2 replaces this stub. */
export function outboxMailPort(_db: Db): MailPort {
  return { send: () => notBuiltAsync('The mail outbox') };
}
