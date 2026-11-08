import { isPushEndpoint } from '../../src/api/contract/push';
import type { Config, DirectoryPort, FileStoreKind, FilesPort, Mail, MailPoolPort, MailPort, PresignedPut } from '../core/ports';
import type { PoolKind } from '../enterprise/platform/mailPool';
import { DAFTRA_API_PREFIX, DAFTRA_TIMEOUT_MS } from '../daftra/client';
import type { EnterpriseId } from '../enterprise/ids';
import { guardFilesPort } from '../files/guard';
import { readOnlyFetch } from '../daftra/readOnly';
import { GOOGLE_CONNECT_CALL_MS } from '../google/api';
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
/** A Google request that the object asks the Worker to send. The object adds the token; the Worker keeps only three headers. */
export type NetHttpRequest = { url: string; method: string; headers: Record<string, string>; body: string | null };
export type NetHttpReply = { status: number; body: string };

/** What the office object asks the Worker to do on the network. Every answer is a NetAnswer, never a throw. */
export interface NetApi {
  presignPut(key: string, o: { mimeType: string; size?: number }): Promise<NetAnswer<PresignedPut>>;
  presignGet(key: string, o: { disposition: 'inline' | 'attachment'; filename: string; mimeType: string }): Promise<NetAnswer<{ url: string; expiresAt: string }>>;
  head(key: string, o?: { timeoutMs?: number }): Promise<NetAnswer<{ size: number; mimeType: string } | null>>;
  copy(from: string, to: string): Promise<NetAnswer<null>>;
  remove(keys: string[]): Promise<NetAnswer<null>>;
  sendMail(mail: Mail): Promise<NetAnswer<{ id: string }>>;
  pushPost(endpoint: string, headers: Record<string, string>, timeoutMs: number): Promise<NetAnswer<{ status: number }>>;
  /** One Google request (the sign-in token address and the Calendar API only). Any HTTP status is a value, not a failure. */
  googleFetch(req: NetHttpRequest): Promise<NetAnswer<NetHttpReply>>;
  /** One Daftra GET. The object sends the address only: the Worker adds the key of the account, so the key never crosses to the object. */
  daftraGet(req: { url: string }): Promise<NetAnswer<NetHttpReply>>;
  /** The email directory of the platform object, for the enterprise of this call (the Worker binds it). A net with no directory answers a failure. */
  directoryReserve(email: string): Promise<NetAnswer<'ok' | 'taken'>>;
  directoryRelease(email: string): Promise<NetAnswer<null>>;
  /**
   * One place in the mail pool of the account, for the enterprise of this call (the Worker binds it and sends its own id, never one from
   * the object). A net with no platform answers a failure, so the mail stops (fail closed).
   */
  mailReserve(kind: PoolKind, day: string, ref: string): Promise<NetAnswer<'ok' | 'full'>>;
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

/** The longest answer body of a Google or Daftra request, in characters. */
export const NET_HTTP_MAX_CHARS = 1_000_000;
const GOOGLE_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const GOOGLE_HEADERS: ReadonlySet<string> = new Set(['authorization', 'content-type', 'accept']);
const GOOGLE_BODY_MAX_CHARS = 64_000;
const OUTSIDE_FAILURE = 'The outside request did not finish.';

/** True for the Google addresses that the office object may use: the token and revoke addresses, and the Calendar API. */
export function isGoogleApiUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.port !== '') return false;
  if (parsed.hostname === 'oauth2.googleapis.com') return (parsed.pathname === '/token' || parsed.pathname === '/revoke') && parsed.search === '';
  return parsed.hostname === 'www.googleapis.com' && parsed.pathname.startsWith('/calendar/v3/calendars');
}

/** The answer of one outside request: the status and the text. The text of an error never leaves, only a fixed message. */
async function outsideAnswer(work: () => Promise<Response>): Promise<NetAnswer<NetHttpReply>> {
  try {
    const response = await work();
    const body = await response.text();
    if (body.length > NET_HTTP_MAX_CHARS) throw new Error('The answer is too long.');
    return { ok: true, value: { status: response.status, body } };
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name === 'TimeoutError' ? 'TimeoutError' : 'NetworkError';
    return { ok: false, failure: { name, message: OUTSIDE_FAILURE } };
  }
}

const refusal = (what: string): NetAnswer<NetHttpReply> => ({ ok: false, failure: { name: 'NetworkError', message: `The Worker refused ${what}.` } });

/** The Google request in the Worker: a Google address only, three headers only, no redirect, 10 s at most. */
export function googleRequest(run: typeof globalThis.fetch) {
  return async (req: NetHttpRequest): Promise<NetAnswer<NetHttpReply>> => {
    if (!isGoogleApiUrl(req.url)) return refusal('an address that is not a Google address');
    if (!GOOGLE_METHODS.has(req.method)) return refusal('a method');
    if (req.body !== null && req.body.length > GOOGLE_BODY_MAX_CHARS) return refusal('a long body');
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) if (GOOGLE_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
    return outsideAnswer(() => run(req.url, { method: req.method, headers, ...(req.body === null ? {} : { body: req.body }), redirect: 'manual', signal: AbortSignal.timeout(GOOGLE_CONNECT_CALL_MS) }));
  };
}

/** The Daftra GET in the Worker: the account is found by its site, the key comes from the Worker, 10 s at most. */
export function daftraRequest(accounts: NonNullable<Config['daftra']>, run: typeof globalThis.fetch) {
  // The read-only lock of the Daftra link (server/daftra/readOnly.ts) holds at this door too.
  const guarded = readOnlyFetch(run);
  return async (req: { url: string }): Promise<NetAnswer<NetHttpReply>> => {
    let parsed: URL;
    try {
      parsed = new URL(req.url);
    } catch {
      return refusal('an address that is not an address');
    }
    const account = Object.values(accounts).find((one) => one.site.toLowerCase() === parsed.hostname);
    if (!account || parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.port !== '' || !parsed.pathname.startsWith(DAFTRA_API_PREFIX)) {
      return refusal('a Daftra address');
    }
    return outsideAnswer(() => guarded(parsed.href, { method: 'GET', headers: { apikey: account.key, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(DAFTRA_TIMEOUT_MS) }));
  };
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
export type NetPorts = { files: FilesPort; mail: MailPort; directory: DirectoryPort; mailPool: MailPoolPort; pushFetch: typeof globalThis.fetch; googleFetch: typeof globalThis.fetch; daftraFetch: typeof globalThis.fetch; used(): number };

export function netPorts(net: NetApi, o: { guard: NetGuard; kind: FileStoreKind; maxFileBytes: number; ent: EnterpriseId }): NetPorts {
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
  // The second wall of the file keys (Madar enterprises, design 5.11): the Worker holds the first. The enterprise is a required input.
  // There is no default: a caller that forgets it fails here, and is never treated as ENT_VADO.
  const guarded = guardFilesPort(files, o.ent);
  // sendPush (server/push/send.ts) signs the VAPID token in the object and gives this fetch the POST: the Worker only posts.
  const pushFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const { status } = await call(true, () => net.pushPost(String(input), headers, PUSH_TIMEOUT_MS));
    return new Response(null, { status });
  }) as typeof globalThis.fetch;
  // The Google client (server/google/api.ts) gets this fetch. The Worker sends the request and answers the status and the text.
  const googleFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? init.body : null;
    const reply = await call(true, () => net.googleFetch({ url: String(input), method: (init?.method ?? 'GET').toUpperCase(), headers, body }));
    return new Response(reply.body === '' ? null : reply.body, { status: reply.status });
  }) as typeof globalThis.fetch;
  // The Daftra client (server/daftra/client.ts) gets this fetch. It sends the address only: the key stays in the Worker.
  const daftraFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') throw new Error('Madar only reads Daftra.');
    const reply = await call(true, () => net.daftraGet({ url: String(input) }));
    return new Response(reply.body === '' ? null : reply.body, { status: reply.status });
  }) as typeof globalThis.fetch;
  // The email directory (plan C): each call counts in the budget and refuses inside a transaction, like every network call.
  const directory: DirectoryPort = {
    reserve: (email) => call(true, () => net.directoryReserve(email)),
    release: async (email) => {
      await call(true, () => net.directoryRelease(email));
    },
  };
  // The mail pool (plan D): a call to the platform object through the Worker. It is no outside call, so it does not count in NET_BUDGET.
  // It still refuses inside a transaction, like every network call.
  const mailPool: MailPoolPort = { reserve: (kind, day, ref) => call(false, () => net.mailReserve(kind, day, ref)) };
  return { files: guarded, mail, directory, mailPool, pushFetch, googleFetch, daftraFetch, used: () => used };
}
