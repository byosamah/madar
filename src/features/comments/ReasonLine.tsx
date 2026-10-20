import type { TFunction } from 'i18next';
import type { DateMove } from '../../api/contract/entities';
import { actorContext, counted } from '../../lib/grammar';
import type { CommentLineKind } from '../../lib/commentLine';
import { plainText } from '../../lib/text';

/** The kinds of comment that are quiet lines (fbk_027): every kind except a message. */
export type ReasonKind = Exclude<CommentLineKind, 'message'>;

/** A name or a reason keeps its own direction (FSI and PDI), so an English name in an Arabic line stays in order. */
const isolate = (text: string): string => `\u2068${text}\u2069`;

/**
 * The words of one quiet line of a task thread, in the screen language (fbk_027, owner 2026-10-19): "Faisal changed the due date:
 * The client sent the survey late". It is the same text in the Conversation of the task, in the Inbox thread and in the preview of
 * the Inbox list. A Madar shift names the task it waited for, and the preview ("short") only says that Madar moved the dates.
 */
export function reasonLineText(
  t: TFunction, line: { kind: ReasonKind; body: string; dates?: DateMove }, person: { name: string; gender?: 'female' | 'male' } | null, short = false,
): string {
  if (line.kind === 'shifted') {
    if (short || !line.dates?.byTaskTitle) return t('taskLine.shiftedShort');
    return t('taskLine.shifted', { task: isolate(line.dates.byTaskTitle), lateness: counted(t, 'taskSheet.durationValue', line.dates.lateDays ?? 1) });
  }
  return t(`taskLine.${line.kind}`, { name: isolate(person?.name ?? ''), reason: isolate(plainText(line.body)), context: actorContext(person) });
}
