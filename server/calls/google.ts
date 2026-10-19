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
import { authUrl, exchangeCode, GOOGLE_SCOPE, GoogleError, makeCalendar, revokeToken } from '../google/api';
import { googleOf, type GoogleReady } from '../google/client';
import { sealToken } from '../google/keys';
import { readState, signState } from '../google/state';
import { deleteEventsOfUser, insertConnection, liveConnection, startRevoking, upcomingMeetingIds } from '../google/store';

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
 */

/** The meetings of a new connection: those that start from now to 60 days later, at most 200 (the first backfill). */
export const BACKFILL_DAYS = 60;
export const BACKFILL_MAX = 200;

const DAY_MS = 24 * 60 * 60 * 1000;
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

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(ready.client, input.code, read.verifier);
  } catch (error) {
    throw refusalOf(error);
  }
  // Madar needs the refresh token (it works while the person is away) and the one scope. Else it takes the grant back.
  if (tokens.refreshToken === null || !tokens.scope.split(' ').includes(GOOGLE_SCOPE)) {
    await dropGrant(ready, tokens.refreshToken ?? tokens.accessToken);
    throw denied();
  }
  let calendarId: string;
  try {
    calendarId = await makeCalendar(ready.client, tokens.accessToken);
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
    // The Google events of the old connection are in the old calendar. The new calendar starts with none, and the backfill fills it.
    await deleteEventsOfUser(q, actorId);
    await insertConnection(q, { id: crypto.randomUUID(), userId: actorId, sealedToken: sealed, calendarId, at: now });
    const from = nowStamp(now);
    const to = nowStamp(new Date(now.getTime() + BACKFILL_DAYS * DAY_MS));
    for (const meetingId of await upcomingMeetingIds(q, actorId, from, to, BACKFILL_MAX)) rows.push({ kind: 'gcal.sync', payload: { userId: actorId, meetingId } });
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
