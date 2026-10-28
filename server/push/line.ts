import type { Language } from '../../src/api/contract/entities';
import type { ChatRow, CommentView, TaskDetail } from '../../src/api/contract/views';
import { noticeSentence, type NoticeView } from '../../src/lib/noticeSentence';
import { chatLink } from '../../src/lib/params';
import { personName } from '../../src/lib/personName';
import { shownName } from '../../src/lib/projectLabel';
import { plainText } from '../../src/lib/text';
import type { Deps } from '../core/ports';
import { runCall, type RunCall } from '../core/runCall';
import { pushWords } from './words';

/**
 * The line of one push (owner, 2026-10-21, "Like WhatsApp"). The server reads AS THE PERSON who gets the push, with the same calls
 * as the screens, so the line holds only what that person may see: a chat or a task that the person may not open gives no line.
 *
 * - A chat: the title is the name of the sender (a direct chat), of the group or of the project; the body is "Name: words" (the words
 *   alone in a direct chat). The words come as the Inbox row shows them: plain text, each mention as "@Name".
 * - A task comment: the title is the task; the body is "Name: words".
 * - A notice: the title is its project, or "Madar"; the body is the sentence of the bell (src/lib/noticeSentence.ts).
 * - The person's own language, with the Arabic name on Arabic screens. A press opens the chat, the task thread or the notice.
 *
 * null means no line: the sender then sends the empty push, and the browser shows the fixed line (public/sw.js).
 *
 * GONE means that the person may no longer open the item of the push (tsk_439). A read as the person answers not_found or forbidden,
 * or the item is no longer in the list of the person: the person lost the view of its project, left the chat, or the item is deleted.
 * The sender then sends nothing to any device, because the empty push would show "You have something new in Madar." about an item that
 * the person cannot open. Any other failure of a read is no GONE: the sender sends the empty push (the wrong answer is the fixed line).
 */

export type PushLine = { title: string; body: string; url: string; tag: string; lang: Language };
export type LineOptions = { run?: RunCall };
/** The answer of a read of the line for the sender: the line, no line, or GONE (the person may not open the item any more). */
export const GONE = 'gone' as const;
export type LineOutcome = PushLine | null | typeof GONE;

const BODY_MAX = 180;
const clip = (text: string): string => (text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1)}…` : text);

/** A read as the person: the output, or "gone" (not_found or forbidden), or "error" (any other failure). */
type Read<T> = { ok: true; output: T } | { ok: false; gone: boolean };
type Reader = <T>(name: string, input: unknown) => Promise<Read<T>>;

/** A read call as the person. A refusal (the person may not see it) reads as gone, as a missing item does. */
function readerOf(deps: Deps, userId: string, o: LineOptions): Reader {
  const run = o.run ?? deps.runCall ?? runCall;
  return async <T>(name: string, input: unknown) => {
    const result = await run(deps, { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
    if (result.ok) return { ok: true, output: result.output as T };
    return { ok: false, gone: result.error.code === 'not_found' || result.error.code === 'forbidden' };
  };
}

/** The output of a read, or null when the read failed (the value of a read that the line can do without). */
const outputOf = <T>(result: Read<T>): T | null => (result.ok ? result.output : null);

async function languageOf(read: Reader): Promise<Language> {
  const session = outputOf(await read<{ user: { preferences?: { language?: Language } } }>('session.get', {}));
  return session?.user.preferences?.language === 'ar' ? 'ar' : 'en';
}

/**
 * The line of the newest unread notice of the person, null when no unread notice stands, or GONE when every unread notice that makes a
 * push reads as gone for the person (notifications.list marks the notice of a project that the person may not view, or of a deleted
 * item). A copy for an Admin never makes a line: a copy has no push.
 */
export async function noticeLineOutcome(deps: Deps, userId: string, o: LineOptions = {}): Promise<LineOutcome> {
  const read = readerOf(deps, userId, o);
  const lang = await languageOf(read);
  const listed = await read<NoticeView[]>('notifications.list', { unreadOnly: true });
  if (!listed.ok) return listed.gone ? GONE : null;
  const unread = listed.output.filter((one) => !one.notification.read && one.notification.forUserIds === undefined);
  const view = unread.find((one) => !one.gone);
  if (!view) return unread.length > 0 ? GONE : null;
  const t = pushWords(lang);
  return {
    title: view.project ? shownName(view.project, lang) : t('push.notificationTitle'),
    body: clip(noticeSentence(view, (key, params) => t(key, params), lang)),
    url: view.link || '/notifications',
    tag: `madar-${view.notification.targetType}-${view.notification.targetId}`,
    lang,
  };
}

/** The line of the newest unread notice of the person, or null (no line, and also an item that is gone: see noticeLineOutcome). */
export async function noticeLine(deps: Deps, userId: string, o: LineOptions = {}): Promise<PushLine | null> {
  const outcome = await noticeLineOutcome(deps, userId, o);
  return outcome === GONE ? null : outcome;
}

/** The line of a task thread from its own comments: a helper or a named person may have no row of the thread in the Inbox. */
async function taskLine(read: Reader, lang: Language, taskId: string): Promise<LineOutcome> {
  const comments = await read<CommentView[]>('comments.list', { targetType: 'task', targetId: taskId });
  const detail = await read<TaskDetail>('tasks.get', { id: taskId });
  // The person may not open the thread or the to-do any more: a hidden project, an office to-do that the person left, a deleted to-do.
  if ((!comments.ok && comments.gone) || (!detail.ok && detail.gone)) return GONE;
  const last = outputOf(comments)?.filter((one) => one.kind === 'message').at(-1);
  const task = outputOf(detail);
  if (!last || !task) return null;
  const words = plainText(last.comment.body).replace(/\s+/g, ' ').trim();
  return { title: task.task.title, body: clip(`${personName(last.author, lang)}: ${words}`), url: chatLink(taskId), tag: `madar-chat-${taskId}`, lang };
}

/**
 * The line of a chat or a task thread (chatId: the conversation id, or the task id of a task comment) for the person. It shows the
 * newest message, which is the one of the push or a newer one. The person's own newest message gives no line. GONE: the person may
 * not open the chat or the thread any more (the chat is not in the list of the person, or the thread answers not_found or forbidden).
 */
export async function chatLineOutcome(deps: Deps, userId: string, chatId: string, o: LineOptions = {}): Promise<LineOutcome> {
  const read = readerOf(deps, userId, o);
  const lang = await languageOf(read);
  const listed = await read<ChatRow[]>('chats.list', {});
  // A list that fails says nothing about a chat. For another reason than gone, a task thread still asks its own reads.
  if (!listed.ok && listed.gone) return GONE;
  const row = outputOf(listed)?.find((one) => one.id === chatId);
  if (!listed.ok) return chatId.startsWith('tsk_') ? taskLine(read, lang, chatId) : null;
  // A task thread may have no row of the thread in the Inbox, so its own reads decide. Any other chat that the list lacks is gone.
  if (!row) return chatId.startsWith('tsk_') ? taskLine(read, lang, chatId) : GONE;
  // A quiet line of a reason makes no push of its own, and the person's own message needs none.
  if (row.previewMine || row.previewAuthor === null || row.preview === '' || row.previewKind !== null) return null;
  const author = personName(row.previewAuthor, lang);
  const direct = row.kind === 'direct';
  return {
    title: direct ? (row.person ? personName(row.person, lang) : author) : (row.kind === 'project' && row.project ? shownName(row.project, lang) : row.title) || pushWords(lang)('push.notificationTitle'),
    body: clip(direct ? row.preview : `${author}: ${row.preview}`),
    url: chatLink(chatId),
    tag: `madar-chat-${chatId}`,
    lang,
  };
}

/** The line of a chat or a task thread for the person, or null (no line, and also a chat that is gone: see chatLineOutcome). */
export async function chatLine(deps: Deps, userId: string, chatId: string, o: LineOptions = {}): Promise<PushLine | null> {
  const outcome = await chatLineOutcome(deps, userId, chatId, o);
  return outcome === GONE ? null : outcome;
}
