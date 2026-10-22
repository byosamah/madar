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
 * The word of the complete button. The server decides where the call lands (`landingStatus` in `src/api/handlers/tasks.ts`): a to-do
 * that needs review lands in review, unless it is an office to-do led by its maker, or the viewer holds the review right.
 * The view gives the last test as `viewerCan.setNeedsReview`.
 */
function completeWordOf(data: TaskDetail, makerId: string): 'markDone' | 'sendToReview' {
  const { task, viewerCan } = data;
  const needs = task.needsReview && !(task.projectId === null && task.ownerId === makerId);
  return needs && !viewerCan.setNeedsReview ? 'sendToReview' : 'markDone';
}

/** One answer for the question "what is my next step on this to-do?". It returns null when the slot stays empty. */
export function nextStep(data: TaskDetail, viewerCan: TaskDetail['viewerCan'], makerId: string): NextStep | null {
  const { task } = data;
  const waiting = isWaiting(data);
  const mayChange = mayChangeOf(viewerCan);
  if (viewerCan.review) return { kind: 'review' };
  if (viewerCan.take) return { kind: 'take' };
  if ((task.status === 'todo' || task.status === 'in_progress') && data.canMove && task.ownerId !== null && !waiting) {
    return { kind: 'complete', completeWord: completeWordOf(data, makerId) };
  }
  if (waiting && data.canMove) return { kind: 'waiting' };
  if (task.ownerId === null && data.canMove && !viewerCan.take) return { kind: 'needs_lead' };
  if (task.status === 'in_review' && data.canMove) return { kind: 'wait_approval' };
  if (viewerCan.newVersion) return { kind: 'new_version' };
  if (!mayChange && !viewerCan.take && viewerCan.help === true && !viewerCan.editAll) return { kind: 'join' };
  if (!mayChange && !viewerCan.take) return { kind: 'none' };
  return null;
}
