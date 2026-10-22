import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { CallInput } from '../../api/calls';
import type { ChatRow, CommentView, GroupLine, MessageView, ReplyRef, UserCard } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { usePageVisible } from '../../app/usePageVisible';
import { usePersonName } from '../../app/personName';
import { useActive } from '../../app/live/activity';
import { usePersonState } from '../../app/live/hooks';
import { useTypingSender } from '../../app/live/typing';
import { useAction, useCall, useRuntime } from '../../app/runtime';
import { useRight } from '../../app/useRight';
import { useStableHandler } from '../../app/useStableHandler';
import { PersonFace } from '../../components/PersonFace';
import { EmptyState } from '../../components/EmptyState';
import { LoadFailed } from '../../components/LoadFailed';
import { Menu, type MenuItem } from '../../components/Menu';
import { ProjectTile } from '../../components/ProjectTile';
import { Composer, MessageLog, type Bubble } from './Thread';
import { BubbleActionsContext, EditingContext, type BubbleActions } from './bubbleActions';
import { useDeleteMessage } from './deleteMessage';
import { replyRefOfBubble } from './ReplyStrip';
import { ChatMenu, chatMenuItems } from './ChatList';
import { GroupPicture } from './GroupPicture';
import { ChatBackLink } from './chatBack';
import { GroupSheets, type GroupMode } from './GroupSheets';
import { useArchive } from './archive';
import { useNotifyItems } from './NotifyChoice';
import { ClipboardCheckIcon } from '../../components/icons/animated/clipboard-check';
import { actorContext } from '../../lib/grammar';
import { chatLink, messageParam, taskLink } from '../../lib/params';
import { useMarkTaskRead } from '../comments/markRead';
import { useEarlierMessages } from './earlier';
import { useOpenMark } from './newLine';
import { bubbleOfComment, useBubbles } from './bubbles';
import { ChatDropArea } from './ChatDrop';
import { bubbleOfOutgoing, cardOfUser, newOutboxKey, refusedByOutbox, useOutbox, usePaneOpen } from './outbox';
import { nowStamp } from '../../lib/dates';
import { NewerMessages } from './NewerMessages';
import type { SeenInfo } from './SeenLine';
import { TypingLine } from './TypingLine';

/**
 * The head of a pane. The title is a plain string: the `<bdi>` inside the heading is the element that cuts (`block truncate`), never the
 * heading itself, so a title in the other language cuts at its end and not at its start (chat design 2026-10-19, item 8). A `<bdi>`
 * takes the direction of its own text, and its side from the page (tokens.css).
 */
/** `twoLines`: on a phone the title takes up to two lines, because a wide action (Open task) leaves little width for it. */
function Header({ lead, title, subtitle, action, twoLines = false }: { lead: ReactNode; title: string; subtitle: ReactNode; action?: ReactNode; twoLines?: boolean }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center gap-3 border-b border-hairline px-3 py-2.5 sm:px-5">
      <ChatBackLink className="sm:hidden" />
      {lead}
      <div className="min-w-0 flex-1">
        <h2 className="min-w-0 text-headline text-ink"><bdi className={twoLines ? 'line-clamp-2 [overflow-wrap:anywhere] sm:line-clamp-1' : 'block truncate'}>{title}</bdi></h2>
        <div className="truncate text-footnote text-ink-2">{subtitle}</div>
      </div>
      {action}
    </header>
  );
}

/** The state of the other person of a direct chat, in words (chat presence design A4). It reads this person alone. */
function PersonStateLine({ person }: { person: UserCard }) {
  const { t } = useTranslation();
  return <>{t(`presence.${usePersonState(person.id)}`, { context: actorContext(person) })}</>;
}

function bubbleOfMessage(view: MessageView): Bubble {
  return {
    id: view.message.id, author: view.author, actingFor: view.actingFor, body: view.message.body, files: view.files,
    createdAt: view.message.createdAt, mine: view.mine, edited: view.message.editedAt !== null, namesMe: view.namesMe, reactions: view.message.reactions, replyTo: view.replyTo, canEdit: view.mine,
    ...(view.message.mentions.length > 0 ? { everyone: true as const } : {}),
  };
}

/** A quiet line of a group as a bubble: the log draws it as one grey line between the messages (UX audit 2026-10-19, chats-10). */
function bubbleOfLine(line: GroupLine): Bubble {
  return { id: `line-${line.id}`, author: line.actor, actingFor: null, body: '', files: [], createdAt: line.at, mine: false, edited: false, line };
}

/**
 * The menu of a group (UX audit 2026-10-19, chats-07): Rename, Mark as unread (fbk_028) and Archive, then the Notify me choice (chat
 * design item 21, the extra items). The people, adding people and leaving moved to the People sheet, which one press on the count or on
 * the picture opens. Mark as unread and Archive are the same as in the list (chatMenuItems).
 */
function GroupMenu({ id, archived, unread, title, onPick, onArchive, onMarkUnread, extra }: {
  id: string; archived: boolean; unread: number; title: string; onPick: (mode: GroupMode) => void; onArchive: (id: string, archived: boolean) => void;
  onMarkUnread: (id: string) => void; extra: MenuItem[];
}) {
  const { t } = useTranslation();
  // Rename needs chat.groupChange (role rights version 2).
  const mayChange = useRight('chat.groupChange');
  return (
    <Menu
      label={t('chat.optionsFor', { title })}
      items={[
        ...(mayChange ? [{ label: t('chat.rename'), onSelect: () => onPick('rename') }] : []),
        ...chatMenuItems(t, { id, archived, unread, onArchive, onMarkUnread }),
        ...extra,
      ]}
    />
  );
}

/**
 * A project chat, a direct chat or a group. Opening it marks it read. A link with a message (`?at=`, chat design 2026-10-19, item 17)
 * opens the page that holds that message: when newer messages follow the page, "Show newer messages" and a send go to the newest page.
 */
export function ChatPane({ id, focusFromRoute, onMarkUnread }: { id: string; focusFromRoute: string | null; onMarkUnread: (id: string) => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const navigate = useNavigate();
  const { live } = useRuntime();
  const session = useCall('session.get', {});
  const [sheet, setSheet] = useState<GroupMode | null>(null);
  const thread = useCall('chats.messages', { conversationId: id, ...(focusFromRoute ? { around: focusFromRoute } : {}) });
  const markRead = useAction('chats.markRead');
  const react = useAction('reactions.toggle');
  const editMessage = useAction('chats.editMessage');
  const deleteMessage = useStableHandler(useDeleteMessage());
  const archive = useArchive();
  // The typing signal of the person for this chat (chat presence design B6). A task thread has none.
  const data = thread.data;
  const people = data?.people ?? NO_PEOPLE;
  // The people who can see the chat tell the sender who may see the line (DF-10). Until the chat loads, the list is unknown.
  const loadedPeople = data?.people;
  const typingOthers = useMemo(() => loadedPeople?.map((person) => person.id), [loadedPeople]);
  const typing = useTypingSender(id, typingOthers);
  const meId = session.data?.authority.id ?? '';
  // The message that the next send answers (chat design 2026-10-19, item 10). A closed chat takes no reply.
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  // Role rights version 2: a direct chat and a group take messages with chat.direct. A project chat opens only for a person who holds
  // chat.project there, so that person may write in it.
  const mayDirect = useRight('chat.direct');
  const canSend = data?.chat.kind === 'project' || mayDirect;
  const canReply = data !== undefined && !data.chat.personLeft && canSend;
  // The message in edit (item 11). The box takes the focus back when the edit ends.
  const [editingId, setEditingId] = useState<string | null>(null);
  const endEdit = useStableHandler(() => {
    setEditingId(null);
    requestAnimationFrame(() => document.getElementById(`composer-${id}`)?.focus());
  });
  // The message that the log goes to and frames (items 10 and 17). The link starts it (`?at=`), a press on a reply strip sets it; the log
  // clears it after the frame. The query keeps `around` after that (it reads the prop, not this state), so the page stays.
  const [focusId, setFocusId] = useState<string | null>(focusFromRoute);
  // The "Notify me" items of the header menu. A hook, so it sits before the early returns. A task thread has none (TaskPane).
  const notifyItems = useNotifyItems(id, data?.notify ?? 'all');
  const { messages, earlier } = useEarlierMessages(id, data?.messages);
  // Instant send (chat design 2026-10-19, item 13): a message shows at once as a faded bubble, and the saved message takes its place.
  const outbox = useOutbox<CallInput<'chats.send'>>(messages.map((view) => ({ id: view.message.id, mine: view.mine, body: view.message.body })));
  const paneOpen = usePaneOpen();
  const send = useAction('chats.send', { onRefused: (error, input) => refusedByOutbox(paneOpen.current, outbox.markFailed, error, input) });
  const retrySend = useStableHandler((bubble: Bubble) => {
    const entry = outbox.unsent.find((item) => `out-${item.key}` === bubble.id);
    if (!entry) return;
    outbox.markRetry(entry.key);
    send.retry(entry.input);
  });
  // A press on a reply strip (item 10): an old message that is in the log gets the frame. One that is older than the loaded pages opens
  // its own page, as a link with `?at=` does.
  const focusMessage = useStableHandler((target: string) => {
    if (messages.some((view) => view.message.id === target)) setFocusId(target);
    else navigate(chatLink(id, target));
  });
  // One stable object for all the bubbles (chat design 2026-10-19, item 9): a bubble renders again only when its own Bubble changes.
  const actions = useMemo<BubbleActions>(() => ({
    menuLabel: t('chat.messageActions'), canReact: canSend, meId, people,
    react: (bubble, emoji) => react.mutate({ messageId: bubble.id, emoji }),
    canReply, reply: (bubble) => setReplyTo(replyRefOfBubble(bubble)),
    edit: (bubble) => setEditingId(bubble.id),
    remove: (bubble) => deleteMessage(bubble.id),
    saveEdit: (bubble, body) => editMessage.mutate({ id: bubble.id, body }, { onSuccess: endEdit }),
    endEdit, retry: retrySend, focusMessage,
  }), [t, meId, people, canSend, canReply, react.mutate, editMessage.mutate, deleteMessage, endEdit, retrySend, focusMessage]);
  const me = session.data ? cardOfUser(session.data.authority) : undefined;
  const messageBubbles = useBubbles(
    messages,
    (view) => ({ ...bubbleOfMessage(view), ...(canSend ? {} : { canEdit: false }), ...(outbox.claimed.has(view.message.id) ? { fromOutbox: true as const } : {}) }),
    canSend ? undefined : 'read',
    // The id of the message finds its bubble when the newest page slides (RN-4). The mark of the outbox is in the key, so a message that
    // the outbox claims after it showed gets a new bubble with `fromOutbox`.
    (view) => (outbox.claimed.has(view.message.id) ? `${view.message.id}#claimed` : view.message.id),
  );
  const lineBubbles = useBubbles(data?.lines ?? NO_LINES, bubbleOfLine);
  const unsentBubbles = useBubbles(me ? outbox.unsent : NO_UNSENT, (entry) => bubbleOfOutgoing(entry, me!), meId);
  // The quiet lines of a group go between the messages by time. A message comes before a line of the same moment. A message that waits
  // for its answer comes last.
  const settled = lineBubbles.length === 0
    ? messageBubbles
    : [...messageBubbles, ...lineBubbles].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.line ? 1 : 0) - (b.line ? 1 : 0));
  const bubbles = unsentBubbles.length === 0 ? settled : [...settled, ...unsentBubbles];
  // The Up key in an empty box opens the edit of the newest message of the person (item 11).
  const editLast = () => {
    const last = bubbles.findLast((bubble) => bubble.canEdit);
    if (!last) return false;
    setEditingId(last.id);
    return true;
  };
  const unread = data?.chat.unread ?? 0;
  // The read state from before the open (item 3). The open marks the chat read, so the first fresh answer is kept. The mark goes only
  // after it, so a stale cached answer never marks the chat read before the fresh one has told what was unread.
  const mark = useOpenMark(thread, (d) => ({ unread: d.chat.unread, readUpTo: d.readUpTo }));
  const opened = mark !== null;
  // Read only while the person looks (item 5): a hidden tab marks nothing, and the tab marks again when it shows.
  const visible = usePageVisible();
  // The newest message is newer than the read time. An Admin's project chat outside the Admin's projects counts only the messages that
  // name the Admin (design item 23), so its count can be 0 while plain messages are new: the open must still move the read mark, so the
  // "New" line of a later message sits right (it reads readUpTo). A read mark moves to the newest message or later, so this ends at once.
  // The times compare as instants: a stamp comes in the +03:00 form or the Z form.
  const newestAt = data?.messages.at(-1)?.message.createdAt;
  const behind = newestAt !== undefined && (data?.readUpTo == null || Date.parse(newestAt) > Date.parse(data.readUpTo));
  // An unread mark (fbk_028) counts 1 with no new message. The first look ends it: the person opened the chat again. While the chat stays
  // open, a mark from its menu or from another device stays, also when the tab shows again: after the first look, only a message that is
  // newer than the read time marks the chat read.
  const looked = useRef(false);
  // The seen time (chat presence design C4) moves only for a look in use: the chat is open, in view, and the person used Madar in the last
  // 10 minutes. An idle screen still reads the chat (no flag), and the first key after the pause sends the flag. The times compare as instants.
  const active = useActive();
  // Only a message of another person can be unseen: the own message is no news to the person, and `chats.send` marks the chat read in
  // its own save, so a mark for it was one more request for each message sent (performance audit 2026-10-21, LV-4).
  const newestOtherAt = data?.messages.findLast((view) => !view.mine)?.message.createdAt;
  const seenBehind = newestOtherAt !== undefined && (data?.seenUpTo == null || Date.parse(newestOtherAt) > Date.parse(data.seenUpTo));
  useEffect(() => {
    if (!opened || !visible) return;
    const first = !looked.current;
    looked.current = true;
    if (behind || (first && unread > 0) || (active && seenBehind)) markRead.mutate({ conversationId: id, ...(active ? { seen: true } : {}) });
    // The mutation object changes on every render. Only a new count of unread messages, a newer message than the read time, a newer one
    // than the seen time, the tab that shows, or the person who is in use again, matters here.
  }, [id, unread, opened, visible, behind, active, seenBehind]);
  if (thread.error) return <div className="p-4"><LoadFailed error={thread.error} onRetry={() => void thread.refetch()} /></div>;
  if (!data || !mark) return <div className="flex-1" aria-busy="true" />;
  const { chat } = data;
  const isGroup = chat.kind === 'group';
  // A group shows one picture. One press on it, or on the count of people, opens the People sheet (UX audit 2026-10-19, chats-07 and 08).
  const lead = chat.kind === 'project' && chat.project
    ? <ProjectTile id={chat.project.id} mark={chat.project.mark} size={40} />
    : isGroup ? (
      <button type="button" aria-label={t('chat.peopleTitle')} onClick={() => setSheet('people')} className="pressable shrink-0 rounded-full">
        <GroupPicture id={chat.id} size={40} />
      </button>
    )
    : chat.person ? <PersonFace user={{ ...chat.person, active: !chat.personLeft }} size={40} /> : null;
  // A direct chat with an inactive person says so and takes no new messages (audit 2026-10-03, SHL-15).
  // "Inactive" is the word Admin uses for the same state (audit 2026-10-03, V-25).
  const context = actorContext(chat.person);
  const subtitle = isGroup
    ? (
      <button type="button" onClick={() => setSheet('people')} className="pressable -my-3 block max-w-full truncate py-3 text-start hover:text-ink hover:underline">
        {t('chat.people', { count: data.people.length + 1 })}
      </button>
    )
    : chat.kind === 'project' ? t('chat.projectChat')
      : chat.personLeft ? t('chat.inactive', { context })
        // With a live port the line says whether the person is here. Without one the old line stays, because every person would read Offline.
        : live && chat.person ? <PersonStateLine person={chat.person} /> : t('chat.directChat');
  const title = chat.kind === 'direct' && chat.person ? nameOf(chat.person) : chat.title;
  // The window of an old message ends before the newest message: the newest page is the chat without the mark in its link.
  const newer = data.newer;
  // The Seen line under the last own message (chat presence design C). A person who left closes the chat, so a direct chat shows it still.
  const seen: SeenInfo | undefined = chat.kind === 'task' ? undefined : {
    kind: chat.kind, readers: data.seen, others: data.others, people: data.people, ...(chat.kind === 'direct' && actorContext(chat.person) ? { context: 'female' as const } : {}),
  };
  const showNewest = () => navigate(chatLink(id), { replace: true });
  return (
    <ChatDropArea note={chat.kind === 'project' ? t('chat.dropProject') : t('chat.dropChat')}>
      <Header
        lead={lead}
        title={title}
        subtitle={subtitle}
        action={isGroup
          ? <GroupMenu id={id} archived={chat.archived} unread={chat.unread} title={title} onPick={setSheet} onArchive={archive} onMarkUnread={onMarkUnread} extra={notifyItems} />
          : <ChatMenu id={id} archived={chat.archived} unread={chat.unread} title={title} onArchive={archive} onMarkUnread={onMarkUnread} extra={notifyItems} />}
      />
      <BubbleActionsContext.Provider value={actions}>
        <EditingContext.Provider value={editingId}>
          <MessageLog key={id} bubbles={bubbles} resetKey={id} emptyText={t('chat.noMessages')} earlier={earlier} readUpTo={mark.readUpTo} unreadAtOpen={mark.unread} focusId={focusId} onFocused={() => setFocusId(null)} seen={seen} />
        </EditingContext.Provider>
      </BubbleActionsContext.Provider>
      {newer && <NewerMessages onShow={showNewest} />}
      {chat.personLeft ? <p className="border-t border-hairline p-3 text-footnote text-ink-2">{isGroup ? t('chat.groupAlone') : t('chat.closed')}</p> : !canSend ? <p className="border-t border-hairline p-3 text-footnote text-ink-2">{t('chat.cannotSend')}</p> : (
        <>
          {live && <TypingLine conversationId={id} />}
          <Composer
            id={id}
            people={data.people}
            everyone={data.everyone}
            pending={false}
            // A project chat joins the files of its project. A direct chat or a group keeps its files in the chat (owner, 2026-10-19).
            upload={chat.kind === 'project' ? (chat.project ? { projectId: chat.project.id } : undefined) : { projectId: null, conversationId: id }}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onEditLast={editLast}
            onTextChange={typing.changed}
            onSend={(body, fileIds, clear) => {
              const input = { conversationId: id, body, fileIds, ...(replyTo ? { replyToId: replyTo.id } : {}) };
              const key = newOutboxKey();
              typing.stop();
              outbox.add({ key, input, body, replyTo, at: nowStamp(), seen: new Set(messages.map((view) => view.message.id)), failed: false });
              // The box is free at once: the next message does not wait for this one.
              clear();
              setReplyTo(null);
              // A chat opened at an old message goes to its newest messages, where the sent message shows (item 17).
              if (newer) showNewest();
              send.mutate(input, { onSuccess: (view) => outbox.markSaved(key, view.message.id) });
            }}
          />
        </>
      )}
      {isGroup && <GroupSheets id={id} mode={sheet} onMode={setSheet} name={chat.title} people={data.people} me={session.data?.authority} makerId={chat.makerId} />}
    </ChatDropArea>
  );
}

const NO_COMMENTS: CommentView[] = [];
const NO_LINES: GroupLine[] = [];
const NO_PEOPLE: UserCard[] = [];
const NO_UNSENT: never[] = [];

/** The comments of one task as a chat. A message posts a task comment. A link with a comment (`?at=`) names the comment to frame. */
export function TaskPane({ id, focusFromRoute, onMarkUnread }: { id: string; focusFromRoute: string | null; onMarkUnread: (id: string) => void }) {
  const { t } = useTranslation();
  const task = useCall('tasks.get', { id });
  // An office task has no project (owner, 2026-10-06): its people are its maker, its lead and its helpers.
  const office = task.data !== undefined && task.data.project === null;
  // The Inbox row of the thread already names its project, so projects.get starts with tasks.get, and the message box shows
  // with the messages (performance audit 2026-10-07, FET-M2). getQueryData adds no observer. A direct link works as before.
  const queryClient = useQueryClient();
  const row = queryClient.getQueryData<ChatRow[]>(['api', 'chats.list', {}])?.find((chat) => chat.id === id);
  const projectId = task.data ? task.data.project?.id : row?.project?.id;
  const project = useCall('projects.get', { id: projectId ?? 'prj_000' }, { enabled: projectId !== undefined });
  const users = useCall('users.list', {}, { enabled: office });
  const comments = useCall('comments.list', { targetType: 'task', targetId: id });
  const session = useCall('session.get', {});
  const react = useAction('reactions.toggle');
  const updateComment = useAction('comments.update');
  const removeComment = useUndoable('comments.delete', { message: () => t('comments.deleted') });
  const archive = useArchive();
  // The Inbox row of the thread tells how many comments were unread at the open (`comments.list` gives no read time). The first fresh
  // answer keeps it, and the mark read goes only after that (item 3).
  const mark = useOpenMark(comments, () => ({ unread: row?.unread ?? 0 }));
  useMarkTaskRead(id, mark ? comments.data : undefined, session.data?.authority.id);
  const me = session.data?.authority.id;
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const where = task.data?.project ?? null;
  // A comment needs comment.create (role rights version 2): the flag of the to-do covers a project to-do and an office to-do.
  const canPost = task.data ? task.data.viewerCan.comment === true : false;
  // The people a name in a comment can point to: the team of the project, or the people of an office task (owner, 2026-10-06).
  const people = useMemo(() => {
    if (!task.data) return NO_PEOPLE;
    const maker = users.data?.find((user) => user.id === task.data?.task.createdBy);
    const makerId = maker?.kind === 'agent' && maker.ownerId ? maker.ownerId : task.data.task.createdBy;
    const officePeople = [
      ...(users.data ?? []).filter((user) => user.id === makerId && user.kind === 'human'),
      ...(task.data.owner ? [task.data.owner] : []), ...task.data.helpers,
    ];
    return (where ? (project.data?.members ?? []).map((member) => member.user) : officePeople)
      .filter((user, index, list) => user.id !== me && list.findIndex((other) => other.id === user.id) === index);
  }, [task.data, users.data, project.data, where, me]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const endEdit = useStableHandler(() => {
    setEditingId(null);
    requestAnimationFrame(() => document.getElementById(`composer-${id}`)?.focus());
  });
  // The comment that the log goes to and frames (items 10 and 17), as in a chat. All comments of a task are in the log, so a press on a strip
  // needs no page.
  const [focusId, setFocusId] = useState<string | null>(focusFromRoute);
  // Instant send, as in a chat (item 13).
  const outbox = useOutbox<CallInput<'comments.create'>>((comments.data ?? NO_COMMENTS).filter((view) => view.kind === 'message').map((view) => ({ id: view.comment.id, mine: view.author.id === me, body: view.comment.body })));
  const paneOpen = usePaneOpen();
  const create = useAction('comments.create', { onRefused: (error, input) => refusedByOutbox(paneOpen.current, outbox.markFailed, error, input) });
  const retrySend = useStableHandler((bubble: Bubble) => {
    const entry = outbox.unsent.find((item) => `out-${item.key}` === bubble.id);
    if (!entry) return;
    outbox.markRetry(entry.key);
    create.retry(entry.input);
  });
  const actions = useMemo<BubbleActions>(() => ({
    menuLabel: t('comments.actions'), canReact: canPost, meId: me ?? '', people,
    react: (bubble, emoji) => react.mutate({ commentId: bubble.id, emoji }),
    canReply: canPost, reply: (bubble) => setReplyTo(replyRefOfBubble(bubble)),
    edit: (bubble) => setEditingId(bubble.id),
    remove: (bubble) => removeComment.mutate({ id: bubble.id }),
    saveEdit: (bubble, body) => updateComment.mutate({ id: bubble.id, body }, { onSuccess: endEdit }),
    endEdit, retry: retrySend, focusMessage: setFocusId,
  }), [t, canPost, me, people, react.mutate, updateComment.mutate, removeComment.mutate, endEdit, retrySend]);
  const meCard = session.data ? cardOfUser(session.data.authority) : undefined;
  // "mine" depends on the person, so the kept bubbles start again when the person changes.
  const settled = useBubbles(comments.data ?? NO_COMMENTS, (view: CommentView): Bubble => ({
    ...bubbleOfComment(view, me),
    ...(outbox.claimed.has(view.comment.id) ? { fromOutbox: true as const } : {}),
  }), me);
  const unsentBubbles = useBubbles(meCard ? outbox.unsent : NO_UNSENT, (entry) => bubbleOfOutgoing(entry, meCard!), me);
  // A comment that waits for its answer comes last.
  const bubbles = unsentBubbles.length === 0 ? settled : [...settled, ...unsentBubbles];
  const failed = task.error ?? comments.error;
  if (failed) return <div className="p-4"><LoadFailed error={failed} onRetry={() => { void task.refetch(); void comments.refetch(); }} /></div>;
  if (!task.data || !comments.data || !mark) return <div className="flex-1" aria-busy="true" />;
  const editLast = () => {
    const last = bubbles.findLast((bubble) => bubble.canEdit);
    if (!last) return false;
    setEditingId(last.id);
    return true;
  };
  return (
    <ChatDropArea note={where ? t('chat.dropProject') : t('chat.dropOfficeTask')}>
      <Header
        lead={<span aria-hidden className="hidden size-10 shrink-0 place-items-center rounded-full bg-fill text-ink-2 sm:grid"><AnimatedIcon icon={ClipboardCheckIcon} size={18} aria-hidden /></span>}
        title={task.data.task.title}
        twoLines
        subtitle={`${t('chat.taskThread')} · ${where ? where.name : t('office.word')}`}
        action={(
          <>
            <Link
              to={taskLink(where?.id ?? null, id)}
              className="pressable inline-flex min-h-11 shrink-0 items-center rounded-full bg-fill px-4 text-subheadline font-semibold text-ink"
            >
              {t('chat.openTask')}
            </Link>
            <ChatMenu id={id} archived={row?.archived ?? false} unread={row?.unread ?? 0} title={task.data.task.title} onArchive={archive} onMarkUnread={onMarkUnread} />
          </>
        )}
      />
      <BubbleActionsContext.Provider value={actions}>
        <EditingContext.Provider value={editingId}>
          <MessageLog key={id} bubbles={bubbles} resetKey={id} emptyText={t('chat.noMessages')} unreadAtOpen={mark.unread} focusId={focusId} onFocused={() => setFocusId(null)} />
        </EditingContext.Provider>
      </BubbleActionsContext.Provider>
      {canPost ? (
        <Composer
          id={id}
          people={people}
          everyone={task.data.everyone}
          pending={false}
          upload={task.data.viewerCan.upload ? { projectId: where?.id ?? null, stageId: task.data.task.stageId, taskId: id } : undefined}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onEditLast={editLast}
          onSend={(body, fileIds, clear) => {
            const input = { targetType: 'task' as const, targetId: id, body, fileIds, ...(replyTo ? { replyToId: replyTo.id } : {}) };
            const key = newOutboxKey();
            outbox.add({ key, input, body, replyTo, at: nowStamp(), seen: new Set((comments.data ?? []).map((view) => view.comment.id)), failed: false });
            clear();
            setReplyTo(null);
            create.mutate(input, { onSuccess: (view) => outbox.markSaved(key, view.comment.id) });
          }}
        />
      ) : <p className="border-t border-hairline p-3 text-footnote text-ink-2">{t('comments.cannot')}</p>}
    </ChatDropArea>
  );
}

/** What shows beside the list. A task thread has a task id. Anything else is a chat. */
export function ConversationPane({ id, onMarkUnread }: { id: string; onMarkUnread: (id: string) => void }) {
  const { t } = useTranslation();
  // A link may name one message or comment (`?at=`). A new mark opens a new pane, so the page loads again at that message.
  const [params] = useSearchParams();
  const at = messageParam(params.get('at')) ?? null;
  const key = `${id}:${at ?? ''}`;
  if (id.startsWith('tsk_')) return <TaskPane key={key} id={id} focusFromRoute={at} onMarkUnread={onMarkUnread} />;
  if (id.startsWith('cnv_')) return <ChatPane key={key} id={id} focusFromRoute={at} onMarkUnread={onMarkUnread} />;
  return <div className="p-4"><EmptyState title={t('common.loadFailed')} body={t('errors.not_found')} /></div>;
}
