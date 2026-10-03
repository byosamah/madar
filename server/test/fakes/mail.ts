import type { Mail, MailPort } from '../../core/ports';

export type FakeMail = MailPort & { sent: Mail[]; failNext(error: Error): void };

/** Records each mail. failNext makes the next send fail once. */
export function fakeMail(): FakeMail {
  const sent: Mail[] = [];
  let failure: Error | null = null;
  return {
    sent,
    failNext(error) {
      failure = error;
    },
    async send(mail) {
      if (failure) {
        const error = failure;
        failure = null;
        throw error;
      }
      sent.push(mail);
      return { id: `mail_${sent.length}` };
    },
  };
}
