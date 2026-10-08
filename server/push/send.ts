import { isPushEndpoint } from '../../src/api/contract/push';
import { PushConfigError, VAPID_NAMES, vapidAuthorization, type VapidConfig } from './vapid';

/**
 * One push (owner, 2026-10-08). The server posts an EMPTY message to the push address of a browser, with the VAPID header. The
 * browser then wakes its service worker (public/sw.js), which shows one fixed line. Nothing about a task, a project, a client or
 * a person travels through the push service, so no message encryption is needed.
 *
 *   201 or 202   sent
 *   404 or 410   the subscription is gone: the caller removes the device
 *   429, 5xx, a network error, a timeout   PushSendError with retryable true: the outbox tries again later
 *   any other answer (400, 401, 403, 413, a redirect)   refused: a later try gives the same answer, so nothing retries
 *
 * An error names the host of the push service and the status, never the address, the token or a key: the address is a
 * capability of that browser.
 */

export type PushOutcome = 'sent' | 'gone' | 'refused';

/** The push service holds an unsent message for one hour (the browser is off), and then drops it. */
export const PUSH_TTL_SECONDS = 3600;
const DEFAULT_TIMEOUT_MS = 3_000;

/** A send that may work later. */
export class PushSendError extends Error {
  readonly status: number | null;
  readonly retryable = true;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'PushSendError';
    this.status = status;
  }

  toJSON() {
    return { name: this.name, message: this.message, status: this.status, retryable: this.retryable };
  }
}

export type SendOptions = {
  /** Tests pass a stub. The default is the host's fetch. */
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
};

export async function sendPush(config: VapidConfig | undefined, endpoint: string, o: SendOptions = {}): Promise<PushOutcome> {
  if (!config) throw new PushConfigError(`Push is off: ${VAPID_NAMES.slice(0, 2).join(', ')} and ${VAPID_NAMES[2]} are not all set.`);
  // The server never posts to an address that is not a push service (the same rule as push.register).
  if (!isPushEndpoint(endpoint)) return 'refused';
  const host = new URL(endpoint).hostname;
  const authorization = await vapidAuthorization(config, endpoint, (o.now ?? (() => new Date()))());
  let response: Response;
  try {
    response = await (o.fetch ?? globalThis.fetch)(endpoint, {
      method: 'POST',
      headers: { Authorization: authorization, TTL: String(PUSH_TTL_SECONDS), Urgency: 'normal', Topic: 'madar' },
      // A push service never needs a redirect. A redirect answer is a refusal, so the server never follows it to another host.
      redirect: 'manual',
      signal: AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // The text of a network error can quote the address, so only its kind goes on.
    const kind = error instanceof DOMException && error.name === 'TimeoutError' ? 'timed out' : 'failed';
    throw new PushSendError(`The push to ${host} ${kind}.`, null);
  }
  const { status } = response;
  // Nothing in the body matters. Drop it so the connection frees.
  void response.body?.cancel().catch(() => undefined);
  if (status === 201 || status === 202) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  if (status === 429 || status >= 500) throw new PushSendError(`The push service ${host} answered ${status}.`, status);
  return 'refused';
}
