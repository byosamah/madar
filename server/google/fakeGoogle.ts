import { createHash } from 'node:crypto';
import { GOOGLE_SCOPE } from './api';

/**
 * A stand-in for Google, for tests only (fbk_022). It is a `fetch` that answers the token address, the revoke address and the
 * Calendar API from memory, so no test reaches Google. It keeps the calendars and the events, the requests it saw, and rules that
 * make one answer fail. Every value is made up; the known secrets let a leak test search for them.
 */

export type SeenRequest = { method: string; url: string; path: string; headers: Record<string, string>; body: unknown };
type Rule = { when: (request: SeenRequest) => boolean; answer: (request: SeenRequest) => Response | Promise<Response>; times: number };

export type FakeGoogleOptions = {
  clientId?: string;
  clientSecret?: string;
  code?: string;
  refreshToken?: string;
  accessToken?: string;
  /** Google sends no refresh token. */
  noRefreshToken?: boolean;
  /** The scope that Google reports for the grant. */
  scope?: string;
};

export type StoredEvent = Record<string, unknown> & { id: string; status: string };

export function fakeGoogle(o: FakeGoogleOptions = {}) {
  const state = {
    clientId: o.clientId ?? 'id-made-up.apps.googleusercontent.com',
    clientSecret: o.clientSecret ?? 'cs-SECRET',
    code: o.code ?? 'code-SECRET',
    refreshToken: o.refreshToken ?? 'rt-SECRET',
    accessToken: o.accessToken ?? 'at-SECRET',
    scope: o.scope ?? GOOGLE_SCOPE,
    noRefreshToken: o.noRefreshToken ?? false,
    grantAlive: true,
    challenge: undefined as string | undefined,
    calendars: 0,
  };
  const requests: SeenRequest[] = [];
  const rules: Rule[] = [];
  const calendars = new Map<string, { summary: string; timeZone: string }>();
  const events = new Map<string, Map<string, StoredEvent>>();
  let nextAccess = 1;

  const reply = (body: unknown, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function parse(init?: RequestInit): unknown {
    const text = init?.body === undefined || init.body === null ? '' : String(init.body);
    if (text === '') return undefined;
    const type = new Headers(init?.headers).get('content-type') ?? '';
    if (type.includes('application/json')) return JSON.parse(text);
    return Object.fromEntries(new URLSearchParams(text));
  }

  function token(body: Record<string, string>): Response {
    if (body.client_id !== state.clientId || body.client_secret !== state.clientSecret) return reply({ error: 'invalid_client' }, 401);
    if (body.grant_type === 'authorization_code') {
      if (body.code !== state.code || !body.code_verifier || !body.redirect_uri) return reply({ error: 'invalid_grant' }, 400);
      if (state.challenge !== undefined && createHash('sha256').update(body.code_verifier).digest('base64url') !== state.challenge) return reply({ error: 'invalid_grant' }, 400);
      state.grantAlive = true;
      return reply({ access_token: state.accessToken, expires_in: 3599, ...(state.noRefreshToken ? {} : { refresh_token: state.refreshToken }), scope: state.scope, token_type: 'Bearer' });
    }
    if (body.grant_type === 'refresh_token') {
      if (!state.grantAlive || body.refresh_token !== state.refreshToken) return reply({ error: 'invalid_grant' }, 400);
      return reply({ access_token: state.accessToken, expires_in: 3599, scope: state.scope, token_type: 'Bearer' });
    }
    return reply({ error: 'unsupported_grant_type' }, 400);
  }

  function calendarApi(request: SeenRequest): Response {
    if (request.headers.authorization !== `Bearer ${state.accessToken}`) return reply({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
    const parts = request.path.replace('/calendar/v3/calendars', '').split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length === 0) {
      if (request.method !== 'POST') return reply({}, 405);
      const body = request.body as { summary: string; timeZone: string };
      state.calendars += 1;
      const id = `cal-${state.calendars}@group.calendar.google.com`;
      calendars.set(id, { summary: body.summary, timeZone: body.timeZone });
      events.set(id, new Map());
      return reply({ id, summary: body.summary, timeZone: body.timeZone });
    }
    const [calendarId, kind, eventId] = parts;
    const store = events.get(calendarId);
    // One calendar by its id: any link of the same app reads a calendar that the app made. A deleted calendar is a 404.
    if (parts.length === 1 && request.method === 'GET') {
      const found = calendars.get(calendarId);
      return found ? reply({ id: calendarId, summary: found.summary, timeZone: found.timeZone }) : reply({ error: { code: 404, message: 'Not Found' } }, 404);
    }
    if (!calendars.has(calendarId) || !store || kind !== 'events') return reply({ error: { code: 404, message: 'Not Found' } }, 404);
    // The list of events, as Google gives it by default: no deleted event, the events that end after timeMin, in pages of maxResults.
    if (parts.length === 2 && request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      const timeMin = query.get('timeMin');
      const size = Number(query.get('maxResults') ?? '250');
      const from = Number(query.get('pageToken') ?? '0');
      const live = [...store.values()].filter((event) => {
        if (event.status === 'cancelled') return false;
        const end = Date.parse(String((event.end as { dateTime?: string } | undefined)?.dateTime ?? ''));
        return timeMin === null || Number.isNaN(end) || end > Date.parse(timeMin);
      });
      const items = live.slice(from, from + size);
      return reply({ kind: 'calendar#events', items, ...(from + size < live.length ? { nextPageToken: String(from + size) } : {}) });
    }
    if (parts.length === 2 && request.method === 'POST') {
      const body = request.body as StoredEvent;
      if (store.has(body.id)) return reply({ error: { code: 409, message: 'The requested identifier already exists.' } }, 409);
      store.set(body.id, { ...body, status: body.status ?? 'confirmed' });
      return reply(store.get(body.id));
    }
    const found = store.get(eventId);
    if (request.method === 'DELETE') {
      if (!found) return reply({ error: { code: 404, message: 'Not Found' } }, 404);
      if (found.status === 'cancelled') return reply({ error: { code: 410, message: 'Resource has been deleted' } }, 410);
      store.set(eventId, { ...found, status: 'cancelled' });
      return new Response(null, { status: 204 });
    }
    if (request.method === 'PUT') {
      if (!found) return reply({ error: { code: 404, message: 'Not Found' } }, 404);
      store.set(eventId, { ...(request.body as Record<string, unknown>), id: eventId, status: (request.body as { status?: string }).status ?? 'confirmed' });
      return reply(store.get(eventId));
    }
    if (request.method === 'PATCH') {
      if (!found) return reply({ error: { code: 404, message: 'Not Found' } }, 404);
      if (found.status === 'cancelled') return reply({ error: { code: 410, message: 'Resource has been deleted' } }, 410);
      store.set(eventId, { ...found, ...(request.body as Record<string, unknown>) });
      return reply(store.get(eventId));
    }
    return reply({}, 405);
  }

  const fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => { headers[name.toLowerCase()] = value; });
    const request: SeenRequest = { method: (init?.method ?? 'GET').toUpperCase(), url: url.toString(), path: url.pathname, headers, body: parse(init) };
    requests.push(request);
    const rule = rules.find((one) => one.times > 0 && one.when(request));
    if (rule) {
      rule.times -= 1;
      return rule.answer(request);
    }
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') return token(request.body as Record<string, string>);
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/revoke') {
      const given = (request.body as { token?: string } | undefined)?.token;
      if (given === state.refreshToken || given === state.accessToken) state.grantAlive = false;
      return reply({});
    }
    if (url.origin === 'https://www.googleapis.com' && url.pathname.startsWith('/calendar/v3/calendars')) return calendarApi(request);
    return reply({ error: 'unknown address' }, 404);
  }) as typeof globalThis.fetch;

  return {
    fetch,
    requests,
    state,
    calendars,
    events,
    /** The person deletes a calendar in Google: its events go with it, and a read of it gives 404. */
    deleteCalendar(calendarId: string) {
      calendars.delete(calendarId);
      events.delete(calendarId);
    },
    /** The requests to the Calendar API for events. */
    eventRequests: () => requests.filter((request) => /\/events/.test(request.path)),
    /** The events of the newest calendar, or of the given one. */
    eventsOf: (calendarId?: string) => events.get(calendarId ?? [...events.keys()].pop() ?? '') ?? new Map<string, StoredEvent>(),
    /** The next `times` requests that match answer with `answer`, before any default. */
    on(when: (request: SeenRequest) => boolean, answer: (request: SeenRequest) => Response | Promise<Response>, times = 1) {
      rules.unshift({ when, answer, times });
    },
    /** Every request that matches fails with this status (the rule never ends). */
    failAll(when: (request: SeenRequest) => boolean, status: number, body: unknown = {}) {
      rules.unshift({ when, answer: () => reply(body, status), times: Number.POSITIVE_INFINITY });
    },
    /** Forgets every rule made with on() and failAll(). */
    clearRules() {
      rules.length = 0;
    },
    /** The access token that Google accepts changes: a call with the old one gets 401. */
    rotateAccessToken() {
      state.accessToken = `at-SECRET-${(nextAccess += 1)}`;
      return state.accessToken;
    },
    reply,
  };
}

export type FakeGoogle = ReturnType<typeof fakeGoogle>;
/** The known secrets of fakeGoogle: a leak test searches every output for them. */
export const KNOWN_SECRETS = ['rt-SECRET', 'at-SECRET', 'code-SECRET', 'cs-SECRET'] as const;
