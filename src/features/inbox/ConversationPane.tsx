import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ChatRow, CommentView, GroupLine, MessageView } from '../../api/contract/views';
import { usePersonName } from '../../app/personName';
import { useAction, useCall } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { LoadFailed } from '../../components/LoadFailed';
import { Menu } from '../../components/Menu';
import { ProjectTile } from '../../components/ProjectTile';
import { Composer, MessageLog, type Bubble } from './Thread';
import { ChatMenu, chatMenuItems } from './ChatList';
import { GroupPicture } from './GroupPicture';
import { GroupSheets, type GroupMode } from './GroupSheets';
import { useArchive } from './archive';
import { ClipboardCheckIcon } from '../../components/icons/animated/clipboard-check';
import { actorContext } from '../../lib/grammar';
import { taskLink } from '../../lib/params';
import { useMarkTaskRead } from '../comments/markRead';
import { DropZone } from '../files/Attachments';
import { useEarlierMessages } from './earlier';

function Header({ lead, title, subtitle, action }: { lead: ReactNode; title: ReactNode; subtitle: ReactNode; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center gap-3 border-b border-hairline px-3 py-2.5 sm:px-5">
      <Link to="/inbox" aria-label={t('chat.back')} className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink sm:hidden">
        <AnimatedIcon icon={ChevronLeftIcon} size={22} className="rtl:-scale-x-100" aria-hidden />
      </Link>
      {lead}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-headline text-ink">{title}</h2>
        <div className="truncate text-footnote text-ink-2">{subtitle}</div>
      </div>
      {action}
    </header>
  );
}

/**
 * One Bubble for each message view, kept while the view object stays the same, so a bubble that did not change keeps its props
 * and its memo holds (performance audit 2026-10-07, RND-5). An edited message gets a new view, so a new bubble.
 */
function useBubbles<V extends object>(views: V[], toBubble: (view: V) => Bubble, resetKey?: string): Bubble[] {
  const kept = useRef<{ key: string | undefined; map: WeakMap<V, Bubble> }>({ key: resetKey, map: new WeakMap() });
  if (kept.current.key !== resetKey) kept.current = { key: resetKey, map: new WeakMap() };
  const { map } = kept.current;
  return views.map((view) => {
    let bubble = map.get(view);
    if (!bubble) {
      bubble = toBubble(view);
      map.set(view, bubble);
    }
    return bubble;
  });
}

function bubbleOfMessage(view: MessageView): Bubble {
  return {
    id: view.message.id, author: view.author, actingFor: view.actingFor, body: view.message.body, files: view.files,
    createdAt: view.message.createdAt, mine: view.mine, edited: view.message.editedAt !== null,
  };
}

/** A quiet line of a group as a bubble: the log draws it as one grey line between the messages (UX audit 2026-10-19, chats-10). */
function bubbleOfLine(line: GroupLine): Bubble {
  return { id: `line-${line.id}`, author: line.actor, actingFor: null, body: '', files: [], createdAt: line.at, mine: false, edited: false, line };
}

/**
 * The menu of a group (UX audit 2026-10-19, chats-07): Rename, Mark as unread and Archive. The people, adding people and leaving moved to
 * the People sheet, which one press on the count or on the picture opens. The other items are the same as in the list (chatMenuItems).
 */
function GroupMenu({ id, archived, unread, title, onPick, onArchive, onMarkUnread }: {
  id: string; archived: boolean; unread: number; title: string; onPick: (mode: GroupMode) => void; onArchive: (id: string, archived: boolean) => void;
  onMarkUnread: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Menu
      label={t('chat.optionsFor', { title })}
      items={[{ label: t('chat.rename'), onSelect: () => onPick('rename') }, ...chatMenuItems(t, { id, archived, unread, onArchive, onMarkUnread })]}
    />
  );
}

/** A project chat, a direct chat or a group. Opening it marks it read. */
export function ChatPane({ id, onMarkUnread }: { id: string; onMarkUnread: (id: string) => void }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const session = useCall('session.get', {});
  const [sheet, setSheet] = useState<GroupMode | null>(null);
  const thread = useCall('chats.messages', { conversationId: id });
  const markRead = useAction('chats.markRead');
  const send = useAction('chats.send');
  const archive = useArchive();
  const data = thread.data;
  const { messages, earlier } = useEarlierMessages(id, data?.messages);
  const messageBubbles = useBubbles(messages, bubbleOfMessage);
  const lineBubbles = useBubbles(data?.lines ?? NO_LINES, bubbleOfLine);
  // The quiet lines of a group go between the messages by time. A message comes before a line of the same moment.
  const bubbles = lineBubbles.length === 0
    ? messageBubbles
    : [...messageBubbles, ...lineBubbles].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.line ? 1 : 0) - (b.line ? 1 : 0));
  const unread = data?.chat.unread ?? 0;
  // Opening the chat marks it read, and so does a new message while it is open. The newest message and the load are the triggers, not the
  // number: a person who marks the open chat as unread (fbk_028) gets 1 with no new message, and the open chat must not end that mark.
  const newest = messages.at(-1)?.message.id;
  const loaded = data !== undefined;
  useEffect(() => {
    if (unread > 0) markRead.mutate({ conversationId: id });
    // The mutation object changes on every render, and the number is read when the chat loads or a message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loaded, newest]);
  if (thread.error) return <div className="p-4"><LoadFailed error={thread.error} onRetry={() => void thread.refetch()} /></div>;
  if (!data) return <div className="flex-1" aria-busy="true" />;
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
    : chat.person ? <Avatar user={chat.person} size={40} /> : null;
  // A direct chat with an inactive person says so and takes no new messages (audit 2026-10-03, SHL-15).
  // "Inactive" is the word Admin uses for the same state (audit 2026-10-03, V-25).
  const context = actorContext(chat.person);
  const subtitle = isGroup
    ? (
      <button type="button" onClick={() => setSheet('people')} className="pressable -my-3 block max-w-full truncate py-3 text-start hover:text-ink hover:underline">
        {t('chat.people', { count: data.people.length + 1 })}
      </button>
    )
    : chat.kind === 'project' ? t('chat.projectChat') : chat.personLeft ? t('chat.inactive', { context }) : t('chat.directChat');
  const title = chat.kind === 'direct' && chat.person ? nameOf(chat.person) : chat.title;
  return (
    <DropZone className="flex min-h-0 flex-1 flex-col">
      <Header
        lead={lead}
        title={<bdi>{title}</bdi>}
        subtitle={subtitle}
        action={isGroup
          ? <GroupMenu id={id} archived={chat.archived} unread={chat.unread} title={title} onPick={setSheet} onArchive={archive} onMarkUnread={onMarkUnread} />
          : <ChatMenu id={id} archived={chat.archived} unread={chat.unread} title={title} onArchive={archive} onMarkUnread={onMarkUnread} />}
      />
      <MessageLog key={id} bubbles={bubbles} resetKey={id} emptyText={t('chat.noMessages')} earlier={earlier} />
      {chat.personLeft ? <p className="border-t border-hairline p-3 text-footnote text-ink-2">{isGroup ? t('chat.groupAlone') : t('chat.closed')}</p> : (
        <Composer
          id={id}
          people={data.people}
          pending={send.isPending}
          // A project chat joins the files of its project. A direct chat or a group keeps its files in the chat (owner, 2026-10-19).
          upload={chat.kind === 'project' ? (chat.project ? { projectId: chat.project.id } : undefined) : { projectId: null, conversationId: id }}
          onSend={(body, fileIds, clear) => send.mutate({ conversationId: id, body, fileIds }, { onSuccess: clear })}
        />
      )}
      {isGroup && <GroupSheets id={id} mode={sheet} onMode={setSheet} name={chat.title} people={data.people} me={session.data?.authority} makerId={chat.makerId} />}
    </DropZone>
  );
}

const NO_COMMENTS: CommentView[] = [];
const NO_LINES: GroupLine[] = [];

/** The comments of one task as a chat. A message posts a task comment. */
export function TaskPane({ id, onMarkUnread }: { id: string; onMarkUnread: (id: string) => void }) {
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
  const create = useAction('comments.create');
  const archive = useArchive();
  useMarkTaskRead(id, comments.data, session.data?.authority.id);
  const me = session.data?.authority.id;
  // "mine" depends on the person, so the kept bubbles start again when the person changes.
  const bubbles = useBubbles(comments.data ?? NO_COMMENTS, (view: CommentView): Bubble => ({
    id: view.comment.id, author: view.author, actingFor: null, body: view.comment.body, files: view.files, createdAt: view.comment.createdAt,
    mine: view.author.id === me, edited: view.comment.editedAt !== null,
    // The reason of a date move or of a reopening is a quiet line, not a message of a person (fbk_027).
    ...(view.kind === 'message' ? {} : { reason: { kind: view.kind, dates: view.comment.dates } }),
  }), me);
  const failed = task.error ?? comments.error;
  if (failed) return <div className="p-4"><LoadFailed error={failed} onRetry={() => { void task.refetch(); void comments.refetch(); }} /></div>;
  if (!task.data || !comments.data) return <div className="flex-1" aria-busy="true" />;
  const where = task.data.project;
  const canPost = where ? project.data?.viewerCan.post ?? false : task.data.viewerCan.contribute;
  const maker = users.data?.find((user) => user.id === task.data?.task.createdBy);
  const makerId = maker?.kind === 'agent' && maker.ownerId ? maker.ownerId : task.data.task.createdBy;
  const officePeople = [
    ...(users.data ?? []).filter((user) => user.id === makerId && user.kind === 'human'),
    ...(task.data.owner ? [task.data.owner] : []), ...task.data.helpers,
  ];
  const people = (where ? (project.data?.members ?? []).map((member) => member.user) : officePeople)
    .filter((user, index, list) => user.id !== me && list.findIndex((other) => other.id === user.id) === index);
  return (
    <DropZone className="flex min-h-0 flex-1 flex-col">
      <Header
        lead={<span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-ink-2"><AnimatedIcon icon={ClipboardCheckIcon} size={18} aria-hidden /></span>}
        title={<bdi>{task.data.task.title}</bdi>}
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
      <MessageLog key={id} bubbles={bubbles} resetKey={id} emptyText={t('chat.noMessages')} />
      {canPost ? (
        <Composer
          id={id}
          people={people}
          pending={create.isPending}
          upload={{ projectId: where?.id ?? null, stageId: task.data.task.stageId, taskId: id }}
          onSend={(body, fileIds, clear) => create.mutate({ targetType: 'task', targetId: id, body, fileIds }, { onSuccess: clear })}
        />
      ) : <p className="border-t border-hairline p-3 text-footnote text-ink-2">{t('comments.cannot')}</p>}
    </DropZone>
  );
}

/** What shows beside the list. A task thread has a task id. Anything else is a chat. */
export function ConversationPane({ id, onMarkUnread }: { id: string; onMarkUnread: (id: string) => void }) {
  const { t } = useTranslation();
  if (id.startsWith('tsk_')) return <TaskPane key={id} id={id} onMarkUnread={onMarkUnread} />;
  if (id.startsWith('cnv_')) return <ChatPane key={id} id={id} onMarkUnread={onMarkUnread} />;
  return <div className="p-4"><EmptyState title={t('common.loadFailed')} body={t('errors.not_found')} /></div>;
}
