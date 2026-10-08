import type { z } from 'zod';
import type { Api, CallMap, CallMeta, CallResult } from '../client';
import { ApiError } from '../errors';
import { Batcher } from './batcher';
import type { FreshReads } from './follow';
import { fromEntry, fromStatus, noAnswer } from './errors';
import { isRead, newKey } from './keys';
import { StoryMap } from './stories';
import { FUNCTION_REGION, isOverviewCall, type Adapter, type AdapterCtx, type ChangeSignal, type StoryRef, type WireEntry, type WireRequest } from './wire';

/**
 * RemoteApi: the screens' api.call() and api.run() over the batch endpoint of the server (client map 2 to 5, plan 4.10).
 * It imports the call map only as a type, so the remote bundle carries no handler code and no zod rules.
 */

/** The time limit of one request. After it, every entry of the request fails with failed. */
export const REQUEST_TIMEOUT_MS = 20_000;

export type RemoteApiOptions<M extends CallMap> = {
  /** The api function, for example https://<ref>.supabase.co/functions/v1/api (VITE_API_URL). */
  url: string;
  /** The batch address when it is not `${url}/batch`: /api/batch, the same-host forwarder (VITE_BATCH_URL, performance audit FET-10). */
  batchUrl?: string;
  /** The build ID of the screens, sent as X-Madar-Build. The server answers 409 client_outdated to an old build. */
  build: string;
  /** The access token of the person, or null when signed out. */
  token: () => Promise<string | null>;
  /** A new access token after a 401. Without it, the API asks token() again. */
  refresh?: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** Calls whose input JSON cannot carry (files): the adapter runs in place of the call (track F fills these slots). */
  adapters?: Partial<Record<keyof M & string, Adapter>>;
  timeoutMs?: number;
  /**
   * The change signals of the person's own calls, so the screen reloads without waiting for Realtime (track R2). fresh: the
   * reads of the follow step that ran after this write in its request and answered (performance audit FET-3).
   */
  onSignals?: (signals: ChangeSignal[], fresh?: FreshReads) => void;
  /** A refused sign-in: a token that stayed invalid after one refresh, or an account that is turned off (track U). */
  onAuthError?: (error: ApiError) => void;
  /** Extra headers on each request. */
  headers?: Record<string, string>;
  now?: () => number;
};

type Answer = { output: unknown; storyId?: string; changed: boolean };

export { canFollow, type FollowApi, type FreshReads } from './follow';

type Pending = {
  name: string;
  input: unknown;
  overview: boolean;
  read: boolean;
  correlationId?: string;
  key?: string;
  story?: StoryRef;
  retried: boolean;
  /** True once the story claim of the item has ended, so a second settle never ends a later claim. */
  storySettled?: boolean;
  /** A read of a follow step: the write that it must run after, in the same request (FET-3). */
  after?: Pending;
  /** A write with a follow step: the tag of that step. */
  tag?: object;
  resolve: (answer: Answer) => void;
  reject: (error: unknown) => void;
};

type Reply =
  | { kind: 'ok'; body: unknown }
  | { kind: 'status'; status: number; body: unknown; retryAfter: string | null }
  | { kind: 'none'; cause: 'timeout' | 'network' };

/** Adds the region parameter, so the function runs in Frankfurt (plan, change 5). Every request URL of the screens uses it. */
export function regionUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('forceFunctionRegion')) parsed.searchParams.set('forceFunctionRegion', FUNCTION_REGION);
    return parsed.toString();
  } catch {
    if (/[?&]forceFunctionRegion=/.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}forceFunctionRegion=${FUNCTION_REGION}`;
  }
}

/** A story placeholder for an adapted call that came with none, so all its writes form one story. Same form as newStoryId(). */
function placeholder(): string {
  return `cor_ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The api of the screens. Its type is the Api of the fake api (httpClient.test.ts pins that), and it also carries follow():
 * the runtime finds it with canFollow().
 */
export function createRemoteApi<M extends CallMap>(o: RemoteApiOptions<M>): Api<M> {
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const batchUrl = regionUrl(o.batchUrl ?? `${o.url.replace(/\/+$/, '')}/batch`);
  const doFetch = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const stories = new StoryMap({ now });
  // The follow step (FET-3): the writes that write() puts on the wire, then the write that the reads of reads() follow.
  let capture: Pending[] | null = null;
  let following: Pending | null = null;

  const batcher = new Batcher<Pending>({
    // A bug in send() must not leave a call waiting forever: every item still settles. A second resolve or reject does nothing.
    send: (items) => {
      send(items).catch(() => {
        for (const item of items) {
          settleStory(item, undefined);
          item.reject(fromEntry({ code: 'failed', message: 'The call failed. Try again.' }));
        }
      });
    },
    place: (item, request) => {
      if (!item.correlationId) return null;
      const plan = stories.plan(item.correlationId, request);
      if ('wait' in plan) return plan.wait;
      item.story = plan.story;
      return null;
    },
  });

  async function post(body: WireRequest, token: string | null): Promise<Reply> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const headers: Record<string, string> = { ...o.headers, 'Content-Type': 'application/json', 'X-Madar-Build': o.build };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await doFetch(batchUrl, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      if (!response.ok) return { kind: 'status', status: response.status, body: parsed, retryAfter: response.headers.get('Retry-After') };
      return { kind: 'ok', body: parsed };
    } catch {
      return { kind: 'none', cause: timedOut ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ends the story claim of an item that went as { ref }, so a waiting call can go. */
  function settleStory(item: Pending, storyId: string | undefined): void {
    if (item.storySettled) return;
    item.storySettled = true;
    if (item.story && 'ref' in item.story) stories.settle(item.story.ref, storyId);
  }

  /** The token, or null. A token() that throws at once counts as no token, the same as one that rejects. */
  async function tokenOf(get: () => Promise<string | null>): Promise<string | null> {
    try {
      return await get();
    } catch {
      return null;
    }
  }

  /** Calls a listener of another track. Its error stays out of the API: the calls of the request are already answered. */
  function tell<T>(listener: ((value: T) => void) | undefined, value: T): void {
    try {
      listener?.(value);
    } catch {
      // The call itself succeeded or failed already. A listener bug must not change its answer.
    }
  }

  async function send(items: Pending[]): Promise<void> {
    const body: WireRequest = {
      v: 1,
      calls: items.map((item, i) => ({
        i,
        name: item.name,
        input: item.input,
        ...(item.story ? { story: item.story } : {}),
        ...(item.key ? { key: item.key } : {}),
      })),
    };
    const token = await tokenOf(() => o.token());
    if (!token) {
      // No session: send nothing. A list that loads again after a sign-out must not reach the server, because its late 401 was
      // read as the end of the next session (test copy, 2026-10-05). The sign-in status already says signed out, so the
      // session listener hears nothing.
      const error = new ApiError('unauthenticated', 'You are signed out.', { reason: 'no_session' });
      for (const item of items) {
        settleStory(item, undefined);
        item.reject(error);
      }
      return;
    }
    let reply = await post(body, token);
    // One token refresh and one resend. The server ran nothing for a 401, so the writes go again with the same keys.
    if (reply.kind === 'status' && reply.status === 401) reply = await post(body, await tokenOf(o.refresh ?? o.token));

    if (reply.kind === 'none') {
      for (const item of items) {
        settleStory(item, undefined);
        // A read goes again once. A write never does: its answer may be lost after it ran, and only Retry may send it again.
        if (item.read && !item.retried) {
          item.retried = true;
          // It goes alone now, so it no longer counts as a read after its write.
          delete item.after;
          batcher.add(item);
        } else {
          item.reject(noAnswer(reply.cause));
        }
      }
      return;
    }
    if (reply.kind === 'status') {
      const error = fromStatus(reply.status, reply.body, reply.retryAfter, now());
      // Answer the calls first, then tell the session listener, so its error cannot leave a call waiting.
      for (const item of items) {
        settleStory(item, undefined);
        item.reject(error);
      }
      if (error.code === 'unauthenticated') tell(o.onAuthError, error);
      return;
    }

    const results = (reply.body as { results?: unknown })?.results;
    const byIndex = new Map<number, WireEntry>();
    if (Array.isArray(results)) for (const entry of results as WireEntry[]) if (entry && typeof entry.i === 'number') byIndex.set(entry.i, entry);
    const signals: { item: Pending; signals: ChangeSignal[] }[] = [];
    const answered = new Set<Pending>();
    items.forEach((item, i) => {
      const entry = byIndex.get(i);
      if (!entry) {
        settleStory(item, undefined);
        item.reject(fromEntry({ code: 'failed', message: 'The call failed. Try again.' }));
        return;
      }
      if (!entry.ok) {
        settleStory(item, undefined);
        item.reject(fromEntry(entry.error));
        return;
      }
      settleStory(item, entry.storyId);
      answered.add(item);
      item.resolve({ output: entry.output, storyId: entry.storyId, changed: entry.changed ?? false });
      if (entry.signals && entry.signals.length > 0) signals.push({ item, signals: entry.signals });
    });
    // Answer every call first, then hand over the signals of each entry, so a listener error cannot leave a call waiting.
    for (const { item, signals: entrySignals } of signals) {
      const at = items.indexOf(item);
      const fresh = item.tag === undefined ? [] : items
        .filter((read, j) => j > at && read.after === item && answered.has(read))
        .map((read) => ({ name: read.name, input: read.input }));
      if (item.tag !== undefined && fresh.length > 0) {
        const tag = item.tag;
        tell((value: ChangeSignal[]) => o.onSignals?.(value, { tag, reads: fresh }), entrySignals);
      } else {
        tell(o.onSignals, entrySignals);
      }
    }
  }

  /** One call on the wire, through the batcher. A write gets a key (the meta key of a Retry, or a new one) and its story. */
  function wire(name: string, input: unknown, meta: CallMeta): Promise<Answer> {
    const read = isRead(name);
    return new Promise<Answer>((resolve, reject) => {
      const item: Pending = {
        name,
        input,
        overview: isOverviewCall(name, input),
        read,
        correlationId: read ? undefined : meta.correlationId,
        key: read ? undefined : (meta.key ?? newKey()),
        retried: false,
        resolve,
        reject,
      };
      if (!read) capture?.push(item);
      else if (following) item.after = following;
      batcher.add(item);
    });
  }

  function follow<T>(write: () => Promise<T>, reads: () => void, tag: object): Promise<T> {
    const queued: Pending[] = [];
    const outer = capture;
    capture = queued;
    let result: Promise<T>;
    try {
      result = write();
    } finally {
      capture = outer;
    }
    if (queued.length !== 1) return result;
    const [only] = queued;
    only.tag = tag;
    const before = following;
    following = only;
    try {
      reads();
    } catch {
      // A bug in the follow step must not stop the write, which is on the wire already. Its reads load on the signals.
    } finally {
      following = before;
    }
    return result;
  }

  async function invoke(name: string, input: unknown, meta: CallMeta): Promise<CallResult<unknown>> {
    const adapter = o.adapters?.[name as keyof M & string];
    if (!adapter) {
      const answer = await wire(name, input, meta);
      const storyId = answer.storyId ?? (meta.correlationId ? stories.serverId(meta.correlationId) : undefined) ?? '';
      return { output: answer.output, storyId, changed: answer.changed };
    }
    // An adapted call makes several wire calls. They share one story, and with a Retry key each gets its own derived key,
    // so a Retry of the whole call sends the same keys again.
    const correlationId = meta.correlationId ?? placeholder();
    let count = 0;
    let storyId: string | undefined;
    let changed = false;
    const ctx: AdapterCtx = {
      meta,
      call: async (innerName, innerInput, innerMeta = {}) => {
        count += 1;
        const key = innerMeta.key ?? (meta.key ? `${meta.key}.${count}` : undefined);
        const answer = await wire(innerName, innerInput, { correlationId: innerMeta.correlationId ?? correlationId, key });
        if (answer.storyId) storyId = answer.storyId;
        changed ||= answer.changed;
        return answer.output;
      },
    };
    const output = await adapter(input, ctx);
    return { output, storyId: storyId ?? stories.serverId(correlationId) ?? '', changed };
  }

  const api = {
    follow,
    call<N extends keyof M & string>(name: N, input: z.input<M[N]['input']>, meta: CallMeta = {}): Promise<z.output<M[N]['output']>> {
      return invoke(name, input, meta).then((result) => result.output) as Promise<z.output<M[N]['output']>>;
    },
    run<N extends keyof M & string>(name: N, input: z.input<M[N]['input']>, meta: CallMeta = {}): Promise<CallResult<z.output<M[N]['output']>>> {
      return invoke(name, input, meta) as Promise<CallResult<z.output<M[N]['output']>>>;
    },
  };
  return api;
}
