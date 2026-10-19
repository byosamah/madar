import type { SharedCallName } from '../../src/api/sharedCalls';
import { sharedCalls } from '../../src/api/sharedCalls';
import { registerEffect, registerOutbox } from '../core/effects';
import { CHAT_NOTICE_EFFECT, NOTICE_EFFECT, NOTICE_FREE_CALLS, QUOTA_WARNING_EFFECT, noticeRows, sendChatNoticeMail, sendNoticeMail, sendQuotaWarning } from './notices';

/**
 * Wires the mail effects into runCall (plan 4.12; task N2.2): the three effect handlers, and the notice producer on every shared
 * write call except the read marks. Any write can make a notice (a task, a comment, a review, a stage, a project), so the
 * producer runs after each save and asks the database only when the save wrote notices. The result removes it all (for tests).
 * server/mail/effects.ts calls it once for the entries.
 */
export function registerMailEffects(): () => void {
  const undo: (() => void)[] = [];
  const removeAll = () => {
    while (undo.length > 0) undo.pop()!();
  };
  try {
    undo.push(registerEffect(NOTICE_EFFECT, sendNoticeMail));
    undo.push(registerEffect(CHAT_NOTICE_EFFECT, sendChatNoticeMail));
    undo.push(registerEffect(QUOTA_WARNING_EFFECT, sendQuotaWarning));
    for (const [name, def] of Object.entries(sharedCalls)) {
      if (def.readOnly || NOTICE_FREE_CALLS.has(name)) continue;
      undo.push(registerOutbox(name as SharedCallName, (_output, saved, q) => noticeRows(q, saved)));
    }
  } catch (error) {
    removeAll();
    throw error;
  }
  return removeAll;
}
