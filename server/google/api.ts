/**
 * The Google client of the Calendar connect (fbk_022, owner 2026-10-19): the sign-in address, the code swap, the refresh, the
 * Madar calendar (make it, read it), its events (write them, list them), and the revoke. Plain `fetch` with a 3 second limit on every call,
 * and a longer limit on the calls of a connect (GOOGLE_CONNECT_BUDGET_MS). Tests pass a stub fetch, so no test reaches Google.
 *
 * An error is a GoogleError whose message is its code and nothing more. The text of a network error, a Google answer, an address, a
 * token or a title never reaches an error, a log line or the outbox. The caller decides from `code` and `retry`.
 */

export const GOOGLE_TIMEOUT_MS = 3000;
/**
 * The time of the Google calls of one google.connect before its answer: the code swap, the read of the remembered calendar and the new
 * calendar (fbk_033). On production (2026-10-20) a connect ran 3.2 to 3.7 s, mostly in the code swap, the first call to Google, and the
 * limit of 3 s failed 3 of 4 connects. Each call waits at most GOOGLE_CONNECT_CALL_MS and never past the budget. The person waits on the
 * screen, and the screen waits 20 s for an answer (REQUEST_TIMEOUT_MS): the budget and the revoke of a failure (3 s) stay under it.
 */
export const GOOGLE_CONNECT_BUDGET_MS = 15_000;
/** The most that one Google call of a connect waits. */
export const GOOGLE_CONNECT_CALL_MS = 10_000;
/** The one scope: Madar makes its own calendar in the account of the person and writes only there. */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDARS_URL = 'https://www.googleapis.com/calendar/v3/calendars';

/** `timeoutMs`: the limit of each call of this client, GOOGLE_TIMEOUT_MS when absent. */
export type GoogleClient = { clientId: string; clientSecret: string; redirectUri: string; fetch?: typeof fetch; timeoutMs?: number };

export type GoogleErrorCode = 'timeout' | 'unreachable' | 'server' | 'rate_limited' | 'grant_gone' | 'not_found' | 'conflict' | 'unauthorized' | 'refused';
const RETRY: ReadonlySet<GoogleErrorCode> = new Set(['timeout', 'unreachable', 'server', 'rate_limited']);

export class GoogleError extends Error {
  readonly code: GoogleErrorCode;
  /** True when the same call may work later. */
  readonly retry: boolean;
  /** The HTTP status of the Google answer, for a log line (fbk_033). A timeout or a network error has none. */
  readonly status: number | undefined;

  constructor(code: GoogleErrorCode, status?: number) {
    super(code);
    this.name = 'GoogleError';
    this.code = code;
    this.retry = RETRY.has(code);
    this.status = status;
  }
}

type Answer = { status: number; json: unknown };

/** One call with the time limit. The limit covers the answer and its body. The error of a network failure says only unreachable. */
async function send(c: GoogleClient, url: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<Answer> {
  const run = c.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GoogleError('timeout'));
    }, c.timeoutMs ?? GOOGLE_TIMEOUT_MS);
  });
  const work = (async (): Promise<Answer> => {
    // A redirect is a refusal: the server never follows one to another host.
    const response = await run(url, { ...init, redirect: 'manual', signal: controller.signal });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json };
  })();
  try {
    return await Promise.race([work, limit]);
  } catch (error) {
    if (error instanceof GoogleError) throw error;
    throw new GoogleError('unreachable');
  } finally {
    clearTimeout(timer);
    // The loser of the race must not end as an unhandled rejection.
    work.catch(() => undefined);
  }
}

const form = (values: Record<string, string>) => ({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString() });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const field = (json: unknown, name: string): unknown => (typeof json === 'object' && json !== null ? (json as Record<string, unknown>)[name] : undefined);

/** The error of the token address: invalid_grant is a grant that is gone; a limit or a server error may work later. */
function tokenFailure(answer: Answer): GoogleError {
  const { status } = answer;
  if (status === 400 && field(answer.json, 'error') === 'invalid_grant') return new GoogleError('grant_gone', status);
  if (status === 429) return new GoogleError('rate_limited', status);
  if (status >= 500) return new GoogleError('server', status);
  return new GoogleError('refused', status);
}

/** The error of the Calendar API. */
function calendarFailure(answer: Answer): GoogleError {
  const { status } = answer;
  if (status === 401) return new GoogleError('unauthorized', status);
  if (status === 404 || status === 410) return new GoogleError('not_found', status);
  if (status === 409) return new GoogleError('conflict', status);
  if (status === 429) return new GoogleError('rate_limited', status);
  if (status >= 500) return new GoogleError('server', status);
  if (status === 403) {
    const errors = field(field(answer.json, 'error'), 'errors');
    const reason = Array.isArray(errors) ? field(errors[0], 'reason') : undefined;
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return new GoogleError('rate_limited', status);
  }
  return new GoogleError('refused', status);
}

/** The sign-in address of Google. The client secret never goes here. */
export function authUrl(c: GoogleClient, o: { state: string; challenge: string; loginHint: string }): string {
  const url = new URL(AUTH_URL);
  const params = {
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    // prompt=consent: Google then sends a refresh token at each connect.
    prompt: 'consent',
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    login_hint: o.loginHint,
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

export async function exchangeCode(c: GoogleClient, code: string, verifier: string): Promise<{ refreshToken: string | null; accessToken: string; expiresIn: number; scope: string }> {
  const answer = await send(c, TOKEN_URL, {
    method: 'POST',
    ...form({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: c.redirectUri, client_id: c.clientId, client_secret: c.clientSecret }),
  });
  if (answer.status !== 200) throw tokenFailure(answer);
  const accessToken = field(answer.json, 'access_token');
  if (typeof accessToken !== 'string' || accessToken === '') throw new GoogleError('refused');
  const refreshToken = field(answer.json, 'refresh_token');
  const expiresIn = field(answer.json, 'expires_in');
  const scope = field(answer.json, 'scope');
  return {
    accessToken,
    refreshToken: typeof refreshToken === 'string' && refreshToken !== '' ? refreshToken : null,
    expiresIn: typeof expiresIn === 'number' ? expiresIn : 3600,
    scope: typeof scope === 'string' ? scope : '',
  };
}

export async function refreshAccess(c: GoogleClient, refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const answer = await send(c, TOKEN_URL, {
    method: 'POST',
    ...form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret }),
  });
  if (answer.status !== 200) throw tokenFailure(answer);
  const accessToken = field(answer.json, 'access_token');
  if (typeof accessToken !== 'string' || accessToken === '') throw new GoogleError('refused');
  const expiresIn = field(answer.json, 'expires_in');
  return { accessToken, expiresIn: typeof expiresIn === 'number' ? expiresIn : 3600 };
}

/**
 * The calendar "Madar" in the account of the person. The scope cannot list calendars, so Madar must remember the id (the table
 * google_calendars) and ask for it with getCalendar before it makes another one.
 */
export async function makeCalendar(c: GoogleClient, accessToken: string): Promise<string> {
  const answer = await send(c, CALENDARS_URL, {
    method: 'POST',
    headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: 'Madar', timeZone: 'Asia/Riyadh' }),
  });
  if (answer.status !== 200) throw calendarFailure(answer);
  const id = field(answer.json, 'id');
  if (typeof id !== 'string' || id === '') throw new GoogleError('refused');
  return id;
}

/**
 * One calendar by its id. The scope reaches every calendar that Madar made, also with the token of a newer link. A 404 or a 410 gives
 * not_found: the person deleted the calendar in Google. Any other failure keeps its own code, so the caller makes no new calendar for it.
 */
export async function getCalendar(c: GoogleClient, accessToken: string, calendarId: string): Promise<string> {
  const answer = await send(c, `${CALENDARS_URL}/${encodeURIComponent(calendarId)}`, { method: 'GET', headers: bearer(accessToken) });
  if (answer.status !== 200) throw calendarFailure(answer);
  const id = field(answer.json, 'id');
  if (typeof id !== 'string' || id === '') throw new GoogleError('refused');
  return id;
}

/** A 400 counts as done: Google says it for a token that is gone already. */
export async function revokeToken(c: GoogleClient, token: string): Promise<void> {
  const answer = await send(c, REVOKE_URL, { method: 'POST', ...form({ token }) });
  if (answer.status === 200 || answer.status === 400) return;
  if (answer.status === 429) throw new GoogleError('rate_limited');
  if (answer.status >= 500) throw new GoogleError('server');
  throw new GoogleError('refused');
}

/** The body of an event that Madar writes: the five keys of eventBodyOf (server/google/sync.ts). */
export type EventBody = {
  summary: string;
  location: string;
  start: { dateTime: string; timeZone: 'Asia/Riyadh' };
  end: { dateTime: string; timeZone: 'Asia/Riyadh' };
  status: 'confirmed';
};

const eventsOf = (calendarId: string) => `${CALENDARS_URL}/${encodeURIComponent(calendarId)}/events`;
const eventOf = (calendarId: string, eventId: string) => `${eventsOf(calendarId)}/${encodeURIComponent(eventId)}`;
const json = (accessToken: string) => ({ ...bearer(accessToken), 'Content-Type': 'application/json' });

async function eventCall(c: GoogleClient, url: string, method: string, accessToken: string, body?: unknown): Promise<void> {
  const answer = await send(c, url, { method, headers: body === undefined ? bearer(accessToken) : json(accessToken), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (answer.status < 200 || answer.status > 299) throw calendarFailure(answer);
}

export const insertEvent = (c: GoogleClient, accessToken: string, calendarId: string, event: EventBody & { id: string }): Promise<void> =>
  eventCall(c, eventsOf(calendarId), 'POST', accessToken, event);
export const patchEvent = (c: GoogleClient, accessToken: string, calendarId: string, eventId: string, event: EventBody): Promise<void> =>
  eventCall(c, eventOf(calendarId, eventId), 'PATCH', accessToken, event);
export const updateEvent = (c: GoogleClient, accessToken: string, calendarId: string, eventId: string, event: EventBody): Promise<void> =>
  eventCall(c, eventOf(calendarId, eventId), 'PUT', accessToken, event);
export const deleteEvent = (c: GoogleClient, accessToken: string, calendarId: string, eventId: string): Promise<void> =>
  eventCall(c, eventOf(calendarId, eventId), 'DELETE', accessToken);

/** The page size and the page limit of listEvents: at most 1000 events. */
export const LIST_PAGE_SIZE = 250;
export const LIST_PAGES = 4;

/**
 * The ids of the events of a calendar that end after `timeMin` (an ISO stamp), as single events, in pages of LIST_PAGE_SIZE. It follows
 * nextPageToken up to LIST_PAGES pages. Google leaves out the deleted events, and an event with the status cancelled gives no id here.
 * A failure of any page throws: the caller gets no part of the list.
 */
export async function listEvents(c: GoogleClient, accessToken: string, calendarId: string, timeMin: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < LIST_PAGES; page += 1) {
    const url = new URL(eventsOf(calendarId));
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('maxResults', String(LIST_PAGE_SIZE));
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken);
    const answer = await send(c, url.toString(), { method: 'GET', headers: bearer(accessToken) });
    if (answer.status !== 200) throw calendarFailure(answer);
    const items = field(answer.json, 'items');
    if (Array.isArray(items)) {
      for (const item of items) {
        const id = field(item, 'id');
        if (typeof id === 'string' && id !== '' && field(item, 'status') !== 'cancelled') ids.push(id);
      }
    }
    const next = field(answer.json, 'nextPageToken');
    if (typeof next !== 'string' || next === '') break;
    pageToken = next;
  }
  return ids;
}
