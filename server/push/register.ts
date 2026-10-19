import type { SharedCallName } from '../../src/api/sharedCalls';
import { sharedCalls } from '../../src/api/sharedCalls';
import { registerEffect, registerOutbox } from '../core/effects';
import { NOTICE_FREE_CALLS } from '../mail/notices';
import { PUSH_CHAT_EFFECT, PUSH_EFFECT, pushRows, sendChatPush, sendPushNotify } from './notify';

/**
 * The calls with no push producer: the read marks (they never make a notice, the rule of the notice mail) and the push device
 * calls (they write no notice and no message).
 */
export const PUSH_FREE_CALLS: ReadonlySet<string> = new Set([...NOTICE_FREE_CALLS, 'push.register', 'push.remove']);

/** The calls that bring old records back: a comment that an Undo inserts again is no new comment, so it pushes nobody (chat design item 11). */
export const UNDO_CALLS: ReadonlySet<string> = new Set(['events.undo', 'events.undoStory']);

/**
 * Wires the push effect into runCall (owner, 2026-10-08): the effect handler, and the push producer on every shared write call
 * except PUSH_FREE_CALLS. Any write can make a notice or a message, so the producer runs after each save, and it asks the database
 * only when the save wrote a notice or a message. The result removes it all (for tests). server/push/effects.ts calls it once.
 */
export function registerPushEffects(): () => void {
  const undo: (() => void)[] = [];
  const removeAll = () => {
    while (undo.length > 0) undo.pop()!();
  };
  try {
    undo.push(registerEffect(PUSH_EFFECT, sendPushNotify));
    undo.push(registerEffect(PUSH_CHAT_EFFECT, sendChatPush));
    for (const [name, def] of Object.entries(sharedCalls)) {
      if (def.readOnly || PUSH_FREE_CALLS.has(name)) continue;
      undo.push(registerOutbox(name as SharedCallName, (_output, saved, q) => pushRows(q, saved, { undo: UNDO_CALLS.has(name) })));
    }
  } catch (error) {
    removeAll();
    throw error;
  }
  return removeAll;
}
