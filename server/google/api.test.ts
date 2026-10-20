import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_SCOPE, GOOGLE_TIMEOUT_MS, GoogleError, LIST_PAGES, LIST_PAGE_SIZE, authUrl, deleteEvent, exchangeCode, getCalendar, insertEvent, listEvents, makeCalendar, patchEvent,
  refreshAccess, revokeToken, updateEvent,
  type EventBody, type GoogleClient,
} from './api';

/** The Google client (fbk_022). Every test hands it a stub fetch; the real fetch never runs, and every value here is made up. */

type Seen = { url: string; init: RequestInit };
function stub(answer: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const one = { url: String(url), init: init ?? {} };
    seen.push(one);
    return answer(one);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, seen };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const client = (fetch: typeof globalThis.fetch): GoogleClient => ({ clientId: 'id-made-up.apps.googleusercontent.com', clientSecret: 'cs-made-up', redirectUri: 'https://madar.example/api/google/callback', fetch });
const form = (init: RequestInit) => Object.fromEntries(new URLSearchParams(String(init.body)));

afterEach(() => vi.useRealTimers());

describe('authUrl', () => {
  it('holds each parameter and exactly one scope', () => {
    const url = new URL(authUrl(client(stub(() => json({})).fetch), { state: 'state-made-up', challenge: 'challenge-made-up', loginHint: 'hala@madar.example' }));
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'id-made-up.apps.googleusercontent.com',
      redirect_uri: 'https://madar.example/api/google/callback',
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state: 'state-made-up',
      code_challenge: 'challenge-made-up',
      code_challenge_method: 'S256',
      login_hint: 'hala@madar.example',
    });
    expect(GOOGLE_SCOPE).toBe('https://www.googleapis.com/auth/calendar.app.created');
    expect(url.searchParams.get('scope')).not.toContain(' ');
  });

  it('holds no client secret', () => {
    expect(authUrl(client(stub(() => json({})).fetch), { state: 's', challenge: 'c', loginHint: 'a@b.c' })).not.toContain('cs-made-up');
  });
});

describe('exchangeCode', () => {
  it('posts the code, the verifier and the redirect address as a form, and gives the tokens', async () => {
    const { fetch, seen } = stub(() => json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3599, scope: GOOGLE_SCOPE, token_type: 'Bearer' }));
    expect(await exchangeCode(client(fetch), 'code-1', 'verifier-1')).toEqual({ accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 3599, scope: GOOGLE_SCOPE });
    expect(seen[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(seen[0].init.method).toBe('POST');
    expect(new Headers(seen[0].init.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(form(seen[0].init)).toEqual({
      grant_type: 'authorization_code', code: 'code-1', code_verifier: 'verifier-1', redirect_uri: 'https://madar.example/api/google/callback',
      client_id: 'id-made-up.apps.googleusercontent.com', client_secret: 'cs-made-up',
    });
    expect(seen[0].init.redirect).toBe('manual');
  });

  it('gives a null refresh token when Google sends none', async () => {
    const { fetch } = stub(() => json({ access_token: 'at-1', expires_in: 3599, scope: GOOGLE_SCOPE }));
    expect((await exchangeCode(client(fetch), 'c', 'v')).refreshToken).toBeNull();
  });

  it('gives grant_gone with no retry for a 400 invalid_grant', async () => {
    const { fetch } = stub(() => json({ error: 'invalid_grant', error_description: 'Bad code rt-secret' }, 400));
    const error = await exchangeCode(client(fetch), 'c', 'v').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleError);
    expect(error).toMatchObject({ code: 'grant_gone', retry: false, message: 'grant_gone' });
  });

  it('gives the other codes: server and rate limits retry, a refusal does not', async () => {
    const cases: [number, string, boolean][] = [[500, 'server', true], [503, 'server', true], [429, 'rate_limited', true], [400, 'refused', false], [401, 'refused', false]];
    for (const [status, code, retry] of cases) {
      const error = await exchangeCode(client(stub(() => json({ error: 'invalid_client' }, status)).fetch), 'c', 'v').catch((e: unknown) => e);
      expect(error, String(status)).toMatchObject({ code, retry, message: code });
    }
  });

  it('gives timeout with retry after 3000 ms for a stub that never answers', async () => {
    vi.useFakeTimers();
    const { fetch } = stub(() => new Promise<Response>(() => undefined));
    const outcome = exchangeCode(client(fetch), 'c', 'v').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(GOOGLE_TIMEOUT_MS - 1);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ code: 'timeout', retry: true, message: 'timeout' });
    expect(GOOGLE_TIMEOUT_MS).toBe(3000);
  });

  it('gives unreachable with retry for a network error, and the message holds nothing of the error', async () => {
    const fetch = (async () => { throw new TypeError('connect ECONNREFUSED 10.0.0.1 secret-token'); }) as unknown as typeof globalThis.fetch;
    const error = await exchangeCode(client(fetch), 'c', 'v').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'unreachable', retry: true, message: 'unreachable' });
  });

  it('gives refused for an answer with no access token', async () => {
    const error = await exchangeCode(client(stub(() => json({ scope: GOOGLE_SCOPE })).fetch), 'c', 'v').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'refused' });
  });
});

describe('refreshAccess', () => {
  it('posts the refresh token and gives a new access token', async () => {
    const { fetch, seen } = stub(() => json({ access_token: 'at-2', expires_in: 3599, token_type: 'Bearer' }));
    expect(await refreshAccess(client(fetch), 'rt-1')).toEqual({ accessToken: 'at-2', expiresIn: 3599 });
    expect(form(seen[0].init)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt-1', client_id: 'id-made-up.apps.googleusercontent.com', client_secret: 'cs-made-up' });
  });

  it('gives grant_gone for invalid_grant', async () => {
    const error = await refreshAccess(client(stub(() => json({ error: 'invalid_grant' }, 400)).fetch), 'rt-1').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'grant_gone', retry: false });
  });
});

describe('makeCalendar', () => {
  it('posts the summary Madar and the zone Asia/Riyadh with the access token, and gives the calendar id', async () => {
    const { fetch, seen } = stub(() => json({ id: 'cal-1@group.calendar.google.com' }));
    expect(await makeCalendar(client(fetch), 'at-1')).toBe('cal-1@group.calendar.google.com');
    expect(seen[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars');
    expect(seen[0].init.method).toBe('POST');
    expect(new Headers(seen[0].init.headers).get('authorization')).toBe('Bearer at-1');
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ summary: 'Madar', timeZone: 'Asia/Riyadh' });
  });

  it('gives unauthorized for a 401 and refused for another 4xx', async () => {
    expect(await makeCalendar(client(stub(() => json({}, 401)).fetch), 'at-1').catch((e: unknown) => e)).toMatchObject({ code: 'unauthorized', retry: false });
    expect(await makeCalendar(client(stub(() => json({}, 400)).fetch), 'at-1').catch((e: unknown) => e)).toMatchObject({ code: 'refused' });
  });
});

describe('getCalendar', () => {
  it('reads the calendar by its id with the access token, and gives the id that Google names', async () => {
    const { fetch, seen } = stub(() => json({ id: 'cal 1@group.calendar.google.com', summary: 'Madar' }));
    expect(await getCalendar(client(fetch), 'at-1', 'cal 1@group.calendar.google.com')).toBe('cal 1@group.calendar.google.com');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars/cal%201%40group.calendar.google.com');
    expect(seen[0].init.method).toBe('GET');
    expect(new Headers(seen[0].init.headers).get('authorization')).toBe('Bearer at-1');
    expect(seen[0].init.body).toBeUndefined();
    expect(seen[0].init.redirect).toBe('manual');
  });

  it('gives not_found for a 404 and a 410 (the person deleted the calendar), with no retry', async () => {
    for (const status of [404, 410]) {
      expect(await getCalendar(client(stub(() => json({}, status)).fetch), 'at-1', 'cal-1').catch((e: unknown) => e), String(status)).toMatchObject({ code: 'not_found', retry: false, message: 'not_found' });
    }
  });

  it('maps the other answers as the event calls do: 401 unauthorized, 429 and 5xx retry, another 4xx refused', async () => {
    const cases: [number, string, boolean][] = [[401, 'unauthorized', false], [429, 'rate_limited', true], [500, 'server', true], [503, 'server', true], [403, 'refused', false], [400, 'refused', false]];
    for (const [status, code, retry] of cases) {
      expect(await getCalendar(client(stub(() => json({}, status)).fetch), 'at-1', 'cal-1').catch((e: unknown) => e), String(status)).toMatchObject({ code, retry, message: code });
    }
  });

  it('gives refused for a 200 with no id', async () => {
    expect(await getCalendar(client(stub(() => json({ summary: 'Madar' })).fetch), 'at-1', 'cal-1').catch((e: unknown) => e)).toMatchObject({ code: 'refused' });
    expect(await getCalendar(client(stub(() => new Response('not json', { status: 200 })).fetch), 'at-1', 'cal-1').catch((e: unknown) => e)).toMatchObject({ code: 'refused' });
  });

  it('gives timeout with retry after 3000 ms for a stub that never answers, and unreachable for a network error', async () => {
    vi.useFakeTimers();
    const { fetch } = stub(() => new Promise<Response>(() => undefined));
    const outcome = getCalendar(client(fetch), 'at-1', 'cal-1').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(GOOGLE_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ code: 'timeout', retry: true });
    vi.useRealTimers();
    const lost = (async () => { throw new TypeError('connect ECONNREFUSED 10.0.0.1 secret-token'); }) as unknown as typeof globalThis.fetch;
    expect(await getCalendar(client(lost), 'at-1', 'cal-1').catch((e: unknown) => e)).toMatchObject({ code: 'unreachable', retry: true, message: 'unreachable' });
  });
});

describe('listEvents', () => {
  const page = (ids: string[], next?: string, extra: object[] = []) =>
    json({ items: [...ids.map((id) => ({ id, status: 'confirmed' })), ...extra], ...(next ? { nextPageToken: next } : {}) });

  it('reads the events from the time on, as single events, 250 in a page, with the access token', async () => {
    const { fetch, seen } = stub(() => page(['a1', 'b2']));
    expect(await listEvents(client(fetch), 'at-1', 'cal 1@group', '2026-10-21T06:00:00.000Z')).toEqual(['a1', 'b2']);
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0].url);
    expect(`${url.origin}${url.pathname}`).toBe('https://www.googleapis.com/calendar/v3/calendars/cal%201%40group/events');
    expect(Object.fromEntries(url.searchParams)).toEqual({ timeMin: '2026-10-21T06:00:00.000Z', singleEvents: 'true', maxResults: '250' });
    expect(LIST_PAGE_SIZE).toBe(250);
    expect(seen[0].init.method).toBe('GET');
    expect(new Headers(seen[0].init.headers).get('authorization')).toBe('Bearer at-1');
    expect(seen[0].init.body).toBeUndefined();
  });

  it('follows the next page token, and stops at the last page', async () => {
    const answers = [page(['a1'], 'token-2'), page(['b2'], 'token-3'), page(['c3'])];
    const { fetch, seen } = stub(() => answers.shift()!);
    expect(await listEvents(client(fetch), 'at-1', 'cal-1', '2026-10-21T06:00:00.000Z')).toEqual(['a1', 'b2', 'c3']);
    expect(seen.map((one) => new URL(one.url).searchParams.get('pageToken'))).toEqual([null, 'token-2', 'token-3']);
  });

  it('reads at most 4 pages, also when Google names a next page', async () => {
    let n = 0;
    const { fetch, seen } = stub(() => page([`e${(n += 1)}`], `token-${n + 1}`));
    expect(await listEvents(client(fetch), 'at-1', 'cal-1', '2026-10-21T06:00:00.000Z')).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(seen).toHaveLength(LIST_PAGES);
    expect(LIST_PAGES).toBe(4);
  });

  it('gives no id for an event that is cancelled or has no id, and an empty list for an answer with no items', async () => {
    expect(await listEvents(client(stub(() => json({ items: [{ id: 'a1', status: 'cancelled' }, { status: 'confirmed' }, { id: 'b2' }, 'text', null] })).fetch), 'at-1', 'cal-1', 'now')).toEqual(['b2']);
    expect(await listEvents(client(stub(() => json({})).fetch), 'at-1', 'cal-1', 'now')).toEqual([]);
  });

  it('maps the statuses as the event calls do: 401 unauthorized, 404 not_found, 429 and 5xx retry, another 4xx refused', async () => {
    const cases: [number, string, boolean][] = [[401, 'unauthorized', false], [404, 'not_found', false], [410, 'not_found', false], [429, 'rate_limited', true], [500, 'server', true], [403, 'refused', false]];
    for (const [status, code, retry] of cases) {
      expect(await listEvents(client(stub(() => json({}, status)).fetch), 'at-1', 'cal-1', 'now').catch((e: unknown) => e), String(status)).toMatchObject({ code, retry, message: code });
    }
  });

  it('throws when a later page fails, and the ids of the first page are lost with it', async () => {
    const answers = [page(['a1'], 'token-2'), json({}, 503)];
    const { fetch } = stub(() => answers.shift()!);
    expect(await listEvents(client(fetch), 'at-1', 'cal-1', 'now').catch((e: unknown) => e)).toMatchObject({ code: 'server', retry: true });
  });
});

describe('the event calls', () => {
  const EVENT: EventBody = { summary: 'Site visit', location: 'Plot 12', start: { dateTime: '2026-10-21T10:00:00.000+03:00', timeZone: 'Asia/Riyadh' }, end: { dateTime: '2026-10-21T11:00:00.000+03:00', timeZone: 'Asia/Riyadh' }, status: 'confirmed' };

  it('insert posts the event with its id to the events of the calendar', async () => {
    const { fetch, seen } = stub(() => json({}));
    await insertEvent(client(fetch), 'at-1', 'cal 1@group', { id: 'abc123', ...EVENT });
    expect(seen[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars/cal%201%40group/events');
    expect(seen[0].init.method).toBe('POST');
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ id: 'abc123', ...EVENT });
    expect(new Headers(seen[0].init.headers).get('authorization')).toBe('Bearer at-1');
  });

  it('patch, update and delete use PATCH, PUT and DELETE on the event address', async () => {
    const { fetch, seen } = stub(() => json({}));
    await patchEvent(client(fetch), 'at-1', 'cal-1', 'abc123', EVENT);
    await updateEvent(client(fetch), 'at-1', 'cal-1', 'abc123', EVENT);
    await deleteEvent(client(fetch), 'at-1', 'cal-1', 'abc123');
    expect(seen.map((one) => [one.init.method, one.url])).toEqual([
      ['PATCH', 'https://www.googleapis.com/calendar/v3/calendars/cal-1/events/abc123'],
      ['PUT', 'https://www.googleapis.com/calendar/v3/calendars/cal-1/events/abc123'],
      ['DELETE', 'https://www.googleapis.com/calendar/v3/calendars/cal-1/events/abc123'],
    ]);
    expect(seen[2].init.body).toBeUndefined();
  });

  it('maps the statuses: 401 unauthorized, 404 and 410 not_found, 409 conflict, 429 and 5xx retry, a rate limit 403 retries, other 403 is refused', async () => {
    const cases: [number, unknown, string, boolean][] = [
      [401, {}, 'unauthorized', false], [404, {}, 'not_found', false], [410, {}, 'not_found', false], [409, {}, 'conflict', false],
      [429, {}, 'rate_limited', true], [500, {}, 'server', true], [503, {}, 'server', true],
      [403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 'rate_limited', true],
      [403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 'rate_limited', true],
      [403, { error: { errors: [{ reason: 'forbidden' }] } }, 'refused', false],
      [400, {}, 'refused', false],
    ];
    for (const [status, body, code, retry] of cases) {
      const error = await patchEvent(client(stub(() => json(body, status)).fetch), 'at-1', 'cal-1', 'abc123', EVENT).catch((e: unknown) => e);
      expect(error, `${status} ${JSON.stringify(body)}`).toMatchObject({ code, retry, message: code });
    }
  });
});

describe('revokeToken', () => {
  it('posts the token as a form, and counts 200 and 400 as done', async () => {
    for (const status of [200, 400]) {
      const { fetch, seen } = stub(() => new Response('{}', { status }));
      await expect(revokeToken(client(fetch), 'rt-1')).resolves.toBeUndefined();
      expect(seen[0].url).toBe('https://oauth2.googleapis.com/revoke');
      expect(form(seen[0].init)).toEqual({ token: 'rt-1' });
    }
  });

  it('gives server and timeout errors that retry, and refused for the rest', async () => {
    expect(await revokeToken(client(stub(() => json({}, 503)).fetch), 'rt-1').catch((e: unknown) => e)).toMatchObject({ code: 'server', retry: true });
    expect(await revokeToken(client(stub(() => json({}, 401)).fetch), 'rt-1').catch((e: unknown) => e)).toMatchObject({ code: 'refused', retry: false });
  });
});
