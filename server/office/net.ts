import { isPushEndpoint } from '../../src/api/contract/push';
import type { FileStoreKind, FilesPort, Mail, MailPort, PresignedPut } from '../core/ports';
import { MailSendError } from '../mail/resend';
import { PushSendError } from '../push/send';
import { PushConfigError } from '../push/vapid';

/**
 * The network port of the office object (exit wave 3). The office object does no network work (exit plan, Global Constraints):
 * the Worker passes an RpcTarget with these methods (server/office/workerNet.ts) into each object call, and the object calls it
 * back while the call runs (RPC lifecycle: a stub in the parameters lives until the call returns). So mail, push, file links and
 * R2 run in the Worker, and the effect code of the Postgres path runs in the object as it is.
 *
 * An error class does not cross RPC, so the Worker answers each call as a NetAnswer and the object builds the class again
 * (MailSendError, PushSendError, PushConfigError, a TimeoutError), because the callers test the class.
 */

export type NetFailure = { name: string; message: string; status?: number | null; code?: string; retryable?: boolean };
export type NetAnswer<T> = { ok: true; value: T } | { ok: false; failure: NetFailure };

/** What the office object asks the Worker to do on the network. Every answer is a NetAnswer, never a throw. */
export interface NetApi {
  presignPut(key: string, o: { mimeType: string; size?: number }): Promise<NetAnswer<PresignedPut>>;
  presignGet(key: string, o: { disposition: 'inline' | 'attachment'; filename: string; mimeType: string }): Promise<NetAnswer<{ url: string; expiresAt: string }>>;
  head(key: string, o?: { timeoutMs?: number }): Promise<NetAnswer<{ size: number; mimeType: string } | null>>;
  copy(from: string, to: string): Promise<NetAnswer<null>>;
  remove(keys: string[]): Promise<NetAnswer<null>>;
  sendMail(mail: Mail): Promise<NetAnswer<{ id: string }>>;
  pushPost(endpoint: string, headers: Record<string, string>, timeoutMs: number): Promise<NetAnswer<{ status: number }>>;
}

/** The fields of an error that a caller on the other side reads. */
export function failureOf(error: unknown): NetFailure {
  if (error instanceof MailSendError) return { name: error.name, message: error.message, status: error.status, code: error.code, retryable: error.retryable };
  if (error instanceof PushSendError) return { name: error.name, message: error.message, status: error.status };
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

/** The error of a failure, with its class back. */
export function errorOf(failure: NetFailure): Error {
  if (failure.name === 'MailSendError') {
    return new MailSendError(failure.message, { status: failure.status ?? null, code: failure.code ?? 'unknown', retryable: failure.retryable ?? true });
  }
  if (failure.name === 'PushSendError') return new PushSendError(failure.message, failure.status ?? null);
  if (failure.name === 'PushConfigError') return new PushConfigError(failure.message);
  if (failure.name === 'TimeoutError') return new DOMException(failure.message, 'TimeoutError');
  const error = new Error(failure.message);
  error.name = failure.name;
  return error;
}

/** The Worker side of each call: the value, or the failure of the error it threw. */
export async function answerOf<T>(work: () => Promise<T>): Promise<NetAnswer<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
}

/** The 3 s of every network call (server/CLAUDE.md, "Rules a change must keep"). */
export const PUSH_TIMEOUT_MS = 3_000;

/** The push POST in the Worker: only to a push service (the rule of push.register), 3 s at most, the body dropped. */
export function postPush(fetchImpl: typeof globalThis.fetch) {
  return (endpoint: string, headers: Record<string, string>, timeoutMs: number): Promise<NetAnswer<{ status: number }>> =>
    answerOf(async () => {
      if (!isPushEndpoint(endpoint)) throw new Error('The office object asked for a push to an address that is not a push service.');
      const response = await fetchImpl(endpoint, { method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(Math.min(timeoutMs, PUSH_TIMEOUT_MS)) });
      void response.body?.cancel().catch(() => undefined);
      return { status: response.status };
    });
}

/**
 * The most network calls of one object method call. A Worker on Free has 50 subrequests for each invocation; the token check
 * can use one for the key set, and the office object call itself counts with the internal services (1,000). A link on R2 is
 * signed in the Worker with no fetch, so it does not count.
 */
export const NET_BUDGET = 45;
/** How long a row waits that the budget stopped: the next run of the job (every 15 minutes) or a later request takes it. */
export const NET_WAIT_MS = 60_000;

/** A network call over the budget. processOutbox keeps the row until retryAt and gives the attempt back (server/core/effects.ts). */
export class NetBudgetSpent extends Error {
  readonly retryAt: Date;

  constructor(now: Date) {
    super(`The office object used its ${NET_BUDGET} network calls of this request. The rest waits for the next run.`);
    this.name = 'NetBudgetSpent';
    this.retryAt = new Date(now.getTime() + NET_WAIT_MS);
  }
}

export const NET_IN_TRANSACTION = 'The office object makes no network call inside a transaction: the transaction holds every other request.';

export type NetGuard = { open(): boolean; now(): Date };
export type NetPorts = { files: FilesPort; mail: MailPort; pushFetch: typeof globalThis.fetch; used(): number };

export function netPorts(net: NetApi, o: { guard: NetGuard; kind: FileStoreKind; maxFileBytes: number }): NetPorts {
  let used = 0;
  async function call<T>(counts: boolean, work: () => Promise<NetAnswer<T>>): Promise<T> {
    if (o.guard.open()) throw new Error(NET_IN_TRANSACTION);
    if (counts) {
      if (used >= NET_BUDGET) throw new NetBudgetSpent(o.guard.now());
      used += 1;
    }
    const answer = await work();
    if (!answer.ok) throw errorOf(answer.failure);
    return answer.value;
  }
  const signs = o.kind !== 'r2';
  const files: FilesPort = {
    kind: o.kind,
    maxFileBytes: o.maxFileBytes,
    presignPut: (key, put) => call(signs, () => net.presignPut(key, put)),
    presignGet: (key, get) => call(signs, () => net.presignGet(key, get)),
    head: (key, head) => call(true, () => net.head(key, head)),
    copy: async (from, to) => {
      await call(true, () => net.copy(from, to));
    },
    remove: async (keys) => {
      if (keys.length > 0) await call(true, () => net.remove(keys));
    },
  };
  const mail: MailPort = { send: (one) => call(true, () => net.sendMail(one)) };
  // sendPush (server/push/send.ts) signs the VAPID token in the object and gives this fetch the POST: the Worker only posts.
  const pushFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const { status } = await call(true, () => net.pushPost(String(input), headers, PUSH_TIMEOUT_MS));
    return new Response(null, { status });
  }) as typeof globalThis.fetch;
  return { files, mail, pushFetch, used: () => used };
}
