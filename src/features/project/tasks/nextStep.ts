import type { TaskDetail } from '../../../api/contract/views';
import { isWaiting } from '../../../lib/waiting';

/** The one next step of a to-do on a phone. The order of the kinds below is the order of the rule. */
export type NextStepKind = 'review' | 'take' | 'complete' | 'waiting' | 'needs_lead' | 'wait_approval' | 'new_version' | 'join' | 'none';
export type NextStep = { kind: NextStepKind; completeWord?: 'markDone' | 'sendToReview' };

/** True when the viewer may change the details, the dates or the work of the to-do. */
export function mayChangeOf(viewerCan: TaskDetail['viewerCan']): boolean {
  return viewerCan.editDetails === true || viewerCan.editDates === true || viewerCan.work === true || viewerCan.editAll;
}

/**
 * The word of the complete button. The server decides where the call lands (`tickLandsInReview` in `src/api/notify.ts`) and gives its
 * answer for the viewer as `viewerCan.sendToReview` (fbk_087): true when the tick goes to review, so the button says Send to review.
 */
function completeWordOf(viewerCan: TaskDetail['viewerCan']): 'markDone' | 'sendToReview' {
  return viewerCan.sendToReview === true ? 'sendToReview' : 'markDone';
}

/** One answer for the question "what is my next step on this to-do?". It returns null when the slot stays empty. */
export function nextStep(data: TaskDetail, viewerCan: TaskDetail['viewerCan']): NextStep | null {
  const { task } = data;
  const waiting = isWaiting(data);
  const mayChange = mayChangeOf(viewerCan);
  if (viewerCan.review) return { kind: 'review' };
  if (viewerCan.take) return { kind: 'take' };
  // A helper has no tick of the work, only the press that sends the to-do to review (fbk_087). It never lands on Done.
  if (!data.canMove && viewerCan.sendToReview === true && !waiting) return { kind: 'complete', completeWord: 'sendToReview' };
  if ((task.status === 'todo' || task.status === 'in_progress') && data.canMove && task.ownerId !== null && !waiting) {
    return { kind: 'complete', completeWord: completeWordOf(viewerCan) };
  }
  if (waiting && data.canMove) return { kind: 'waiting' };
  if (task.ownerId === null && data.canMove) return { kind: 'needs_lead' };
  if (task.status === 'in_review' && data.canMove) return { kind: 'wait_approval' };
  if (viewerCan.newVersion) return { kind: 'new_version' };
  if (!mayChange && viewerCan.help === true) return { kind: 'join' };
  if (!mayChange) return { kind: 'none' };
  return null;
}
