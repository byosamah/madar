import { useTranslation } from 'react-i18next';
import type { TrackerRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';

/**
 * The close of an open loop: the call with its Undo toast, and the word of the button. The word is Answered when the office owed the
 * reply and Received when the client owed it (audit 2026-10-03, BRW-15). The toast uses the same word.
 */
export function useCloseLoop(row: TrackerRow) {
  const { t } = useTranslation();
  const close = useUndoable('tracker.close', { message: () => t(row.entry.waiting === 'us' ? 'tracker.answeredToast' : 'tracker.receivedToast') });
  const action = t(row.entry.waiting === 'us' ? 'tracker.answered' : 'tracker.received');
  return { close, action };
}
