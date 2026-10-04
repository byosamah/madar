import type { Mail, MailPort } from '../core/ports';

/**
 * The Resend HTTP API (plan 5.4, PF 10.2; task N2.1). Edge Functions block SMTP port 587 (PF 1.1), so every mail goes by HTTPS.
 * The Idempotency-Key makes a second send of the same mail within 24 hours return the first answer, so a retried effect never
 * sends twice. The error of a failed send never holds the API key.
 */

export const RESEND_URL = 'https://api.resend.com/emails';
/** Resend keeps an idempotency key for 24 hours and takes at most 256 characters. */
export const MAX_IDEMPOTENCY_KEY = 256;
const DEFAULT_TIMEOUT_MS = 10_000;

/** A send that failed. retryable: a later attempt with the same idempotency key may work (rate limit, busy key, server error, network). */
export class MailSendError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, o: { status: number | null; code: string; retryable: boolean }) {
    super(message);
    this.name = 'MailSendError';
    this.status = o.status;
    this.code = o.code;
    this.retryable = o.retryable;
  }

  toJSON() {
    return { name: this.name, message: this.message, status: this.status, code: this.code, retryable: this.retryable };
  }
}

/** Resend tag values take only ASCII letters, digits, underscores and dashes. */
export function tagValue(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

function retryableStatus(status: number, code: string): boolean {
  if (status === 429 || status >= 500) return true;
  // The same key is still in flight: the first request may finish, so a later attempt gets its answer.
  return status === 409 && code === 'concurrent_idempotent_requests';
}

/** The text of a refusal, without anything that came in the request (the key could appear in an echoed header). */
function clean(text: string, apiKey: string): string {
  return text.split(apiKey).join('[key]').slice(0, 300);
}

export type ResendOptions = {
  /** Tests pass a stub. The default is the host's fetch. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

export function resendMailPort(env: { apiKey: string; from: string }, o: ResendOptions = {}): MailPort {
  if (env.apiKey === '') throw new Error('RESEND_API_KEY is not set.');
  if (env.from === '') throw new Error('MAIL_FROM is not set.');
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async send(mail: Mail) {
      if (mail.idempotencyKey === '') throw new Error('A mail needs an idempotency key.');
      if (mail.idempotencyKey.length > MAX_IDEMPOTENCY_KEY) throw new Error(`The idempotency key is longer than ${MAX_IDEMPOTENCY_KEY} characters.`);
      const doFetch = o.fetch ?? globalThis.fetch;
      let response: Response;
      try {
        response = await doFetch(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': mail.idempotencyKey },
          body: JSON.stringify({
            from: env.from,
            to: [mail.to],
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            tags: [{ name: 'kind', value: tagValue(mail.tag) }],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
        throw new MailSendError(timedOut ? `Resend did not answer in ${timeoutMs} ms.` : 'Resend could not be reached.', {
          status: null,
          code: timedOut ? 'timeout' : 'network',
          retryable: true,
        });
      }

      const body = (await response.json().catch(() => null)) as { id?: unknown; name?: unknown; message?: unknown } | null;
      if (response.ok && body !== null && typeof body.id === 'string' && body.id !== '') return { id: body.id };
      if (response.ok) throw new MailSendError('Resend answered without an email id.', { status: response.status, code: 'no_id', retryable: true });
      const code = typeof body?.name === 'string' ? body.name : `http_${response.status}`;
      const message = typeof body?.message === 'string' ? clean(body.message, env.apiKey) : 'no message';
      throw new MailSendError(`Resend refused the email (${response.status} ${code}): ${message}`, {
        status: response.status,
        code,
        retryable: body === null || retryableStatus(response.status, code),
      });
    },
  };
}
