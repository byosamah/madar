import { registerEffect, registerOutbox } from '../core/effects';
import { gcalRows, REVOKE_EFFECT, revokeRowsOf, SYNC_EFFECT, TIDY_EFFECT } from './rows';
import { GCAL_CALLS, revokeOne, syncOne, tidyOne } from './sync';

/**
 * Wires the Google Calendar sync into runCall (fbk_022): the handlers of the three effect kinds, the producer of gcal.sync on each call of
 * GCAL_CALLS, and the producer of gcal.revoke on users.remove. gcal.tidy has a handler only: google.connect writes its row. The result removes it all (for tests). server/google/effects.ts calls it once.
 *
 * The effects write only google_connections and google_events, server-only rows (as the mail effects write mail_log): no event, no
 * signal, no State table. gcal.tidy writes no row at all.
 */
export function registerGoogleEffects(): () => void {
  const undo: (() => void)[] = [];
  const removeAll = () => {
    while (undo.length > 0) undo.pop()!();
  };
  try {
    undo.push(registerEffect(SYNC_EFFECT, async (payload, deps) => void (await syncOne(deps, String(payload.userId ?? ''), String(payload.meetingId ?? '')))));
    undo.push(registerEffect(TIDY_EFFECT, async (payload, deps) => void (await tidyOne(deps, String(payload.userId ?? '')))));
    undo.push(registerEffect(REVOKE_EFFECT, (payload, deps) => revokeOne(deps, String(payload.connectionId ?? ''), { replaced: payload.replaced === true })));
    // 'projects.setAccess' is a shared call once the hidden project core is in; the cast keeps the list in one place.
    for (const name of GCAL_CALLS) undo.push(registerOutbox(name as Parameters<typeof registerOutbox>[0], (_output, saved, q) => gcalRows(q, saved)));
    undo.push(registerOutbox('users.remove', (output, _saved, q, at) => revokeRowsOf(q, output as { id: string }, at ?? new Date())));
  } catch (error) {
    removeAll();
    throw error;
  }
  return removeAll;
}
