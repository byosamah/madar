import type { DateMove } from '../api/contract/entities';

/**
 * What a comment of a task thread is (fbk_027, owner 2026-10-19). A "message" is words that a person wrote to the people of the task.
 * The other kinds are quiet lines: the reason of a due date move, of a start date move, of a task that opens again, and the shift
 * that Madar makes when a task it waited for finished late. A line is no message: it has no bubble and no avatar, it never counts as
 * unread, and it never waits for a reply.
 *
 * The kind comes from the data, so a comment saved before this rule reads the new way: a reason of a date move has `dates`, and a
 * Madar shift has `dates.byTaskId`. Only a reopening stores its own `kind`.
 */
export type CommentLineKind = 'message' | 'due_date' | 'start_date' | 'shifted' | 'reopened';

/** The part of a comment that tells its kind. It takes no zod: the screens of the first load import it. */
export type CommentKindFields = { kind?: 'reopened'; dates?: DateMove };

export function lineKindOf(comment: CommentKindFields): CommentLineKind {
  if (comment.kind === 'reopened') return 'reopened';
  const { dates } = comment;
  if (!dates) return 'message';
  if (dates.byTaskId) return 'shifted';
  // A move of the start date alone is the one case that is not a due date line.
  const startOnly = dates.from.startDate !== dates.to.startDate && dates.from.dueDate === dates.to.dueDate;
  return startOnly ? 'start_date' : 'due_date';
}

/** True for every kind except a message. */
export const isLine = (comment: CommentKindFields): boolean => lineKindOf(comment) !== 'message';
