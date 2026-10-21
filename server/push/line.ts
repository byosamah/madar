import type { Language } from '../../src/api/contract/entities';
import type { ChatRow, CommentView, TaskDetail } from '../../src/api/contract/views';
import { noticeSentence, type NoticeView } from '../../src/lib/noticeSentence';
import { chatLink } from '../../src/lib/params';
import { personName } from '../../src/lib/personName';
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
 */

export type PushLine = { title: string; body: string; url: string; tag: string; lang: Language };
export type LineOptions = { run?: RunCall };

const BODY_MAX = 180;
const clip = (text: string): string => (text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1)}…` : text);

type Reader = <T>(name: string, input: unknown) => Promise<T | null>;

/** A read call as the person. A refusal (the person may not see it) gives null, as a missing item does. */
function readerOf(deps: Deps, userId: string, o: LineOptions): Reader {
  const run = o.run ?? deps.runCall ?? runCall;
  return async <T>(name: string, input: unknown) => {
    const result = await run(deps, { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
    return result.ok ? (result.output as T) : null;
  };
}

async function languageOf(read: Reader): Promise<Language> {
  const session = await read<{ user: { preferences?: { language?: Language } } }>('session.get', {});
  return session?.user.preferences?.language === 'ar' ? 'ar' : 'en';
}

/** The line of the newest unread notice of the person. A copy for an Admin never makes a line: a copy has no push. */
export async function noticeLine(deps: Deps, userId: string, o: LineOptions = {}): Promise<PushLine | null> {
  const read = readerOf(deps, userId, o);
  const lang = await languageOf(read);
  const views = await read<NoticeView[]>('notifications.list', { unreadOnly: true });
  const view = views?.find((one) => !one.notification.read && one.notification.forUserIds === undefined && !one.gone);
  if (!view) return null;
  const t = pushWords(lang);
  return {
    title: view.project?.name ?? t('push.notificationTitle'),
    body: clip(noticeSentence(view, (key, params) => t(key, params), lang)),
    url: view.link || '/notifications',
    tag: `madar-${view.notification.targetType}-${view.notification.targetId}`,
    lang,
  };
}

/** The line of a task thread from its own comments: a helper or a named person may have no row of the thread in the Inbox. */
async function taskLine(read: Reader, lang: Language, taskId: string): Promise<PushLine | null> {
  const comments = await read<CommentView[]>('comments.list', { targetType: 'task', targetId: taskId });
  const last = comments?.filter((one) => one.kind === 'message').at(-1);
  const detail = await read<TaskDetail>('tasks.get', { id: taskId });
  if (!last || !detail) return null;
  const words = plainText(last.comment.body).replace(/\s+/g, ' ').trim();
  return { title: detail.task.title, body: clip(`${personName(last.author, lang)}: ${words}`), url: chatLink(taskId), tag: `madar-chat-${taskId}`, lang };
}

/**
 * The line of a chat or a task thread (chatId: the conversation id, or the task id of a task comment) for the person. It shows the
 * newest message, which is the one of the push or a newer one. The person's own newest message gives no line.
 */
export async function chatLine(deps: Deps, userId: string, chatId: string, o: LineOptions = {}): Promise<PushLine | null> {
  const read = readerOf(deps, userId, o);
  const lang = await languageOf(read);
  const rows = await read<ChatRow[]>('chats.list', {});
  const row = rows?.find((one) => one.id === chatId);
  if (!row) return chatId.startsWith('tsk_') ? taskLine(read, lang, chatId) : null;
  // A quiet line of a reason makes no push of its own, and the person's own message needs none.
  if (row.previewMine || row.previewAuthor === null || row.preview === '' || row.previewKind !== null) return null;
  const author = personName(row.previewAuthor, lang);
  const direct = row.kind === 'direct';
  return {
    title: direct ? (row.person ? personName(row.person, lang) : author) : row.title || pushWords(lang)('push.notificationTitle'),
    body: clip(direct ? row.preview : `${author}: ${row.preview}`),
    url: chatLink(chatId),
    tag: `madar-chat-${chatId}`,
    lang,
  };
}
