import type { User } from '../../src/api/contract/entities';
import { ApiError, forbidden, invalid } from '../../src/api/errors';
import { nowStamp } from '../../src/lib/dates';
import { resolveActor } from '../core/actor';
import { requestHost } from '../core/after';
import { processOutbox, writeOutbox, type OutboxRow } from '../core/effects';
import { digestOf, replay, sqlKeys, type StoredResult } from '../core/idempotency';
import { takeOfficeLock } from '../core/lock';
import type { Deps } from '../core/ports';
import type { ServerCall, ServerCallCtx } from '../core/types';
import { authUrl, exchangeCode, getCalendar, GOOGLE_CONNECT_TIMEOUT_MS, GOOGLE_SCOPE, GoogleError, makeCalendar, revokeToken, type GoogleClient } from '../google/api';
import { googleOf, type GoogleReady } from '../google/client';
import { sealToken } from '../google/keys';
import { TIDY_EFFECT } from '../google/rows';
import { readState, signState } from '../google/state';
import { backfillMeetingIds } from '../google/sync';
import { deleteEventsOfUser, insertConnection, liveConnection, rememberCalendar, rememberedCalendar, startRevoking } from '../google/store';

/**
 * The four Google Calendar calls (fbk_022, owner 2026-10-19): google.status, google.connectStart, google.connect and
 * google.disconnect. Only a person, for the person: an agent gets forbidden, and no call takes the id of another person.
 *
 * They read and write the two server-only tables of server/google/store.ts and nothing else. They write no event, no History row and
 * no change signal. A copy with no Google values answers ready false to google.status and google_not_ready to the other three.
 *
 * google.connect swaps the code inside runCall, so the swap is bound to the session of the person: the callback route
 * (server/google/callback.ts) only checks the signed state. Its network work (the swap and the calendar) runs before the one write
 * transaction. The sync of the meetings to Google runs after the commit, on the host `after` (server/core/after.ts), so the answer
 * does not wait for Google. The refresh token reaches the database only as a sealed text. No answer, error or log line holds a token,
 * a code or a state.
 *
 * One calendar for each person (owner test 2026-10-20): the scope cannot list calendars, so Madar remembers the id of the calendar it made
 * (google_calendars) and keeps it after a disconnect. A new connect asks Google for that calendar and uses it. The first 60 days of
 * meetings (BACKFILL_DAYS, BACKFILL_MAX in server/google/sync.ts) go to it as before, and one gcal.tidy row takes the stale events of Madar out.
 */

const FORBIDDEN_MESSAGE = 'An agent does not connect Google Calendar.';

/** The person of the call. An agent gets forbidden, also on a copy with no Google. */
function personOf(ctx: ServerCallCtx, action: string): User {
  const actor = resolveActor(ctx.office, ctx.principal);
  if (actor.kind === 'agent') throw forbidden(FORBIDDEN_MESSAGE, { action });
  return actor;
}

const notReady = () => invalid('google', 'Google Calendar is not set up for this office yet.', 'google_not_ready');
const linkOld = () => invalid('state', 'The Google step took too long. Start it again.', 'google_link_old');
const denied = () => invalid('code', 'Google did not give Madar the calendar permission.', 'google_denied');
const unreachable = () => new ApiError('failed', 'Madar could not reach Google. Try again in a minute.', { reason: 'google_unreachable' });

function readyOf(deps: Deps): GoogleReady {
  const ready = googleOf(deps);
  if (!ready) throw notReady();
  return ready;
}

/** A Google failure as the refusal of the call. The error text of Google never goes on. */
function refusalOf(error: unknown): unknown {
  if (!(error instanceof GoogleError)) return error;
  if (error.code === 'grant_gone') return linkOld();
  return error.retry ? unreachable() : denied();
}

/** The Google step of a connect: the code swap, the read of the remembered calendar, or the new calendar. */
type ConnectStep = 'token' | 'calendar_read' | 'calendar_make';

/**
 * One log line for a connect that a Google step ended (fbk_033: production answered google_unreachable, and no line said why). It holds
 * the person, the step, the code and the HTTP status, never the text of an error or of a Google answer. A code that is no Google error
 * (no_refresh_token, scope_missing) names a grant that came back without what Madar needs.
 */
function logConnectFailure(deps: Deps, userId: string, step: ConnectStep, error: unknown): void {
  if (typeof error === 'string') {
    deps.log.warn('A Google Calendar connect failed.', { userId, step, code: error });
    return;
  }
  if (!(error instanceof GoogleError)) return;
  deps.log.warn('A Google Calendar connect failed.', { userId, step, code: error.code, ...(error.status !== undefined ? { status: error.status } : {}) });
}

/** Takes the grant back at Google, best effort: the answer to the person is already decided, and a failure here changes nothing. */
async function dropGrant(ready: GoogleReady, token: string): Promise<void> {
  try {
    await revokeToken(ready.client, token);
  } catch {
    // The 15-minute cleanup does not know this token (it is not stored). The person can remove Madar at myaccount.google.com.
  }
}

export const googleStatus: ServerCall<'google.status'> = async (_input, ctx) => {
  const person = personOf(ctx, 'google.status');
  if (!googleOf(ctx.deps)) return { output: { ready: false, state: 'none' as const, connectedAt: null }, changed: false };
  const row = await ctx.deps.db.tx('read', (q) => liveConnection(q, person.id));
  return {
    output: { ready: true, state: row ? (row.state as 'ok' | 'not_synced' | 'broken') : ('none' as const), connectedAt: row ? nowStamp(row.connectedAt) : null },
    changed: false,
  };
};

export const googleConnectStart: ServerCall<'google.connectStart'> = async (_input, ctx) => {
  const person = personOf(ctx, 'google.connectStart');
  const ready = readyOf(ctx.deps);
  const { state, challenge } = await signState(await ready.keys(), person.id, ctx.now);
  return { output: { url: authUrl(ready.client, { state, challenge, loginHint: person.email }) }, changed: false };
};

/** Runs the outbox rows after the commit: on the host `after` when it has one, else before the answer (tests). */
async function runAfterCommit(deps: Deps, ids: string[], name: string): Promise<void> {
  if (ids.length === 0) return;
  const work = processOutbox(deps, ids).then(
    () => undefined,
    (error: unknown) => deps.log.warn('The effects after the commit did not run. The job tries them again.', { name, error: error instanceof Error ? error.message : 'failed' }),
  );
  const { after } = requestHost();
  if (after) after(work);
  else await work;
}

/**
 * The calendar of the new connection. With a remembered id, Madar asks Google for that calendar with the new access token: the scope reaches
 * every calendar that Madar made, across links. 200 uses it. 404 or 410 means the person deleted it, so Madar makes a new one. Any other
 * failure (a timeout, a 5xx, a 429, a 401) ends the connect with google_unreachable and makes no calendar: the person presses Connect again.
 */
async function calendarFor(
  client: GoogleClient,
  known: string | undefined,
  accessToken: string,
  fail: (step: ConnectStep, error: unknown) => void,
): Promise<{ calendarId: string; reused: boolean }> {
  if (known !== undefined) {
    try {
      return { calendarId: await getCalendar(client, accessToken, known), reused: true };
    } catch (error) {
      if (!(error instanceof GoogleError)) throw error;
      if (error.code !== 'not_found') {
        fail('calendar_read', error);
        throw unreachable();
      }
    }
  }
  try {
    return { calendarId: await makeCalendar(client, accessToken), reused: false };
  } catch (error) {
    fail('calendar_make', error);
    throw error;
  }
}

export const googleConnect: ServerCall<'google.connect'> = async (input, ctx) => {
  const person = personOf(ctx, 'google.connect');
  const { deps } = ctx;
  const ready = readyOf(deps);
  const actorId = person.id;

  // A Retry with the same key gets the stored answer and swaps no code (a code works once).
  const digest = ctx.key !== undefined ? await digestOf('google.connect', input) : undefined;
  if (ctx.key !== undefined && digest !== undefined) {
    const stored = replay(await deps.db.tx('read', (q) => sqlKeys(q).get(actorId, ctx.key!)), digest);
    if (stored) return { output: stored.output as { state: 'ok'; meetings: number }, changed: false };
  }

  const read = await readState(await ready.keys(), input.state, ctx.now);
  if (!read.ok) throw linkOld();
  if (read.userId !== actorId) throw forbidden('This Google step belongs to another Madar sign-in.', { action: 'google.connect', reason: 'google_link_person' });

  // The calendar that Madar made for this person at an earlier connect. It is read before the code swap, so a failure here uses no code and
  // leaves no grant. It is read on the primary: a row that was missed would make a second calendar.
  const known = await deps.db.tx('write', (q) => rememberedCalendar(q, actorId));

  const fail = (step: ConnectStep, error: unknown) => logConnectFailure(deps, actorId, step, error);
  // The Google steps of the connect get the longer limit: the person waits on the screen for them (fbk_033). The revoke keeps 3 s.
  const client: GoogleClient = { ...ready.client, timeoutMs: GOOGLE_CONNECT_TIMEOUT_MS };
  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(client, input.code, read.verifier);
  } catch (error) {
    fail('token', error);
    throw refusalOf(error);
  }
  // Madar needs the refresh token (it works while the person is away) and the one scope. Else it takes the grant back.
  if (tokens.refreshToken === null || !tokens.scope.split(' ').includes(GOOGLE_SCOPE)) {
    fail('token', tokens.refreshToken === null ? 'no_refresh_token' : 'scope_missing');
    await dropGrant(ready, tokens.refreshToken ?? tokens.accessToken);
    throw denied();
  }
  let calendarId: string;
  let reused: boolean;
  try {
    ({ calendarId, reused } = await calendarFor(client, known, tokens.accessToken, fail));
  } catch (error) {
    await dropGrant(ready, tokens.refreshToken);
    throw refusalOf(error);
  }
  const sealed = await sealToken(await ready.keys(), actorId, tokens.refreshToken);

  const done = await deps.db.tx('write', async (q) => {
    await takeOfficeLock(q, deps.config.lockKey);
    const now = deps.clock.now();
    if (ctx.key !== undefined && digest !== undefined) {
      const stored = replay(await sqlKeys(q).get(actorId, ctx.key), digest);
      if (stored) return { result: stored, ids: [] as string[] };
    }
    const rows: OutboxRow[] = [];
    // The old live row of the person goes out. Its grant is the same grant at Google, so the revoke row only deletes the sealed
    // token here (replaced): a revoke at Google would take back the grant that the new row uses.
    for (const id of await startRevoking(q, actorId, now)) rows.push({ kind: 'gcal.revoke', payload: { connectionId: id, replaced: true } });
    // The event rows of the old connection go. A new calendar starts with no event. A reused calendar still holds the old events: the backfill
    // writes each meeting again (an insert that finds its id becomes an update), and gcal.tidy then takes out the events that no meeting needs.
    await deleteEventsOfUser(q, actorId);
    await insertConnection(q, { id: crypto.randomUUID(), userId: actorId, sealedToken: sealed, calendarId, at: now });
    await rememberCalendar(q, actorId, calendarId, now);
    for (const meetingId of await backfillMeetingIds(q, actorId, now)) rows.push({ kind: 'gcal.sync', payload: { userId: actorId, meetingId } });
    // The last row, so the tidy runs when the backfill rows are done.
    if (reused) rows.push({ kind: TIDY_EFFECT, payload: { userId: actorId } });
    const ids = await writeOutbox(q, rows);
    const result: StoredResult = { output: { state: 'ok', meetings: rows.filter((row) => row.kind === 'gcal.sync').length }, changed: false };
    if (ctx.key !== undefined && digest !== undefined) await sqlKeys(q).put({ actorId, key: ctx.key, name: 'google.connect', digest, result, at: now });
    return { result, ids };
  });
  await runAfterCommit(deps, done.ids, 'google.connect');
  return { output: done.result.output as { state: 'ok'; meetings: number }, changed: false };
};

export const googleDisconnect: ServerCall<'google.disconnect'> = async (_input, ctx) => {
  const person = personOf(ctx, 'google.disconnect');
  const { deps } = ctx;
  readyOf(deps);
  const ids = await deps.db.tx('write', async (q) => {
    await takeOfficeLock(q, deps.config.lockKey);
    const revoking = await startRevoking(q, person.id, deps.clock.now());
    await deleteEventsOfUser(q, person.id);
    return writeOutbox(q, revoking.map((id) => ({ kind: 'gcal.revoke', payload: { connectionId: id } })));
  });
  await runAfterCommit(deps, ids, 'google.disconnect');
  return { output: { state: 'none' as const }, changed: false };
};
