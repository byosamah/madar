import { notBuiltAsync } from '../core/notBuilt';
import type { MailPort } from '../core/ports';

/** The Resend HTTP API with an Idempotency-Key (plan 5.4). Track N2 replaces this stub. */
export function resendMailPort(_env: { apiKey: string; from: string }): MailPort {
  return { send: () => notBuiltAsync('The Resend sender') };
}
