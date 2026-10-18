import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { ChatRow, CommentView, MessageView, UserCard } from '../../api/contract/views';
import { useByPersonName, usePersonName } from '../../app/personName';
import { useAction, useCall } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { AvatarStack } from '../../components/AvatarStack';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TextField } from '../../components/Fields';
import { LoadFailed } from '../../components/LoadFailed';
import { Menu } from '../../components/Menu';
import { ProjectTile } from '../../components/ProjectTile';
import { Sheet } from '../../components/Sheet';
import { Composer, MessageLog, type Bubble } from './Thread';
import { ArchiveMenu } from './ChatList';
import { ClipboardCheckIcon } from '../../components/icons/animated/clipboard-check';
import { actorContext } from '../../lib/grammar';
import { taskLink } from '../../lib/params';
import { useMarkTaskRead } from '../comments/markRead';
import { useEarlierMessages } from './earlier';

function Header({ lead, title, subtitle, action }: { lead: ReactNode; title: ReactNode; subtitle: string; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center gap-3 border-b border-hairline px-3 py-2.5 sm:px-5">
      <Link to="/inbox" aria-label={t('chat.back')} className="pressable grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink sm:hidden">
        <AnimatedIcon icon={ChevronLeftIcon} size={22} className="rtl:-scale-x-100" aria-hidden />
      </Link>
      {lead}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-headline text-ink">{title}</h2>
        <p className="truncate text-footnote text-ink-2">{subtitle}</p>
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

/** The sheets of a group: the name, the people, and leaving it. */
type GroupMode = 'rename' | 'add' | 'remove' | 'leave';

/**
 * The menu of a group (owner, 2026-10-18): rename, add people, leave, and archive. "Remove a person" shows to the maker only.
 * The archive item is the same as in the list (ArchiveMenu).
 */
function GroupMenu({ id, archived, isMaker, onPick }: { id: string; archived: boolean; isMaker: boolean; onPick: (mode: GroupMode) => void }) {
  const { t } = useTranslation();
  const archive = useAction('chats.archive');
  return (
    <Menu
      label={t('chat.groupOptions')}
      items={[
        { label: t('chat.rename'), onSelect: () => onPick('rename') },
        { label: t('chat.addPeople'), onSelect: () => onPick('add') },
        { label: t('chat.removePerson'), onSelect: () => onPick('remove'), hidden: !isMaker },
        { label: t('chat.leaveGroup'), onSelect: () => onPick('leave'), destructive: true },
        { label: archived ? t('chat.moveBack') : t('chat.archive'), onSelect: () => archive.mutate({ conversationId: id, archived: !archived }) },
      ]}
    />
  );
}

/** One sheet of a group. The maker removes one person; any member renames, adds people or leaves. */
function GroupSheet({ id, mode, name, people, meId, onClose }: {
  id: string; mode: GroupMode; name: string; people: UserCard[]; meId: string | undefined; onClose: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const navigate = useNavigate();
  const users = useCall('users.list', {}, { enabled: mode === 'add' });
  const update = useAction('chats.updateGroup', { onSuccess: () => onClose() });
  const leave = useAction('chats.leaveGroup', { onSuccess: () => { onClose(); navigate('/inbox'); } });
  const [field, setField] = useState(name);
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (userId: string) => setPicked((list) => (list.includes(userId) ? list.filter((item) => item !== userId) : [...list, userId]));
  const members = new Set([...people.map((person) => person.id), ...(meId ? [meId] : [])]);
  const candidates = (users.data ?? []).filter((user) => user.kind === 'human' && user.active && !members.has(user.id)).sort(byName);
  const titles: Record<GroupMode, string> = {
    rename: t('chat.renameTitle'), add: t('chat.addTitle'), remove: t('chat.removeTitle'), leave: t('chat.leaveTitle'),
  };
  const footer = {
    rename: <Button variant="primary" disabled={field.trim() === '' || update.isPending} onClick={() => update.mutate({ conversationId: id, name: field.trim() })}>{t('common.save')}</Button>,
    add: <Button variant="primary" disabled={picked.length === 0 || update.isPending} onClick={() => update.mutate({ conversationId: id, add: picked })}>{t('common.add')}</Button>,
    remove: <Button variant="destructive" disabled={picked.length === 0 || update.isPending} onClick={() => update.mutate({ conversationId: id, remove: picked })}>{t('chat.removePerson')}</Button>,
    leave: <Button variant="destructive" disabled={leave.isPending} onClick={() => leave.mutate({ conversationId: id })}>{t('chat.leaveConfirm')}</Button>,
  }[mode];
  const pickable = mode === 'add' ? candidates : people;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={titles[mode]} footer={footer}>
      {mode === 'rename' && <TextField id="group-rename" label={t('chat.groupName')} value={field} onChange={(event) => setField(event.target.value)} />}
      {mode === 'leave' && <p className="text-subheadline text-ink-2">{t('chat.leaveBody')}</p>}
      {(mode === 'add' || mode === 'remove') && (
        <ul className="flex flex-col">
          {pickable.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                aria-pressed={picked.includes(person.id)}
                onClick={() => toggle(person.id)}
                className={`pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-start hover:bg-fill/50 ${picked.includes(person.id) ? 'bg-fill' : ''}`}
              >
                <Avatar user={person} size={36} />
                <bdi className="truncate text-subheadline font-medium text-ink">{nameOf(person)}</bdi>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** A project chat, a direct chat or a group. Opening it marks it read. */
export function ChatPane({ id }: { id: string }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const session = useCall('session.get', {});
  const meId = session.data?.authority.id;
  const [sheet, setSheet] = useState<GroupMode | null>(null);
  const thread = useCall('chats.messages', { conversationId: id });
  const markRead = useAction('chats.markRead');
  const send = useAction('chats.send');
  const data = thread.data;
  const { messages, earlier } = useEarlierMessages(id, data?.messages);
  const bubbles = useBubbles(messages, bubbleOfMessage);
  const unread = data?.chat.unread ?? 0;
  useEffect(() => {
    if (unread > 0) markRead.mutate({ conversationId: id });
    // The mutation object changes on every render. Only a new count of unread messages matters here.
  }, [id, unread]);
  if (thread.error) return <div className="p-4"><LoadFailed error={thread.error} onRetry={() => void thread.refetch()} /></div>;
  if (!data) return <div className="flex-1" aria-busy="true" />;
  const { chat } = data;
  const isGroup = chat.kind === 'group';
  const lead = chat.kind === 'project' && chat.project
    ? <ProjectTile id={chat.project.id} mark={chat.project.mark} size={40} />
    : isGroup ? <span className="grid size-10 shrink-0 place-items-center rounded-full bg-fill"><AvatarStack leader={null} team={data.people} max={3} size={22} /></span>
    : chat.person ? <Avatar user={chat.person} size={40} /> : null;
  // A direct chat with an inactive person says so and takes no new messages (audit 2026-10-03, SHL-15).
  // "Inactive" is the word Admin uses for the same state (audit 2026-10-03, V-25).
  const context = actorContext(chat.person);
  const subtitle = isGroup ? t('chat.groupChat') : chat.kind === 'project' ? t('chat.projectChat') : chat.personLeft ? t('chat.inactive', { context }) : t('chat.directChat');
  return (
    <>
      <Header
        lead={lead}
        title={<bdi>{chat.kind === 'direct' && chat.person ? nameOf(chat.person) : chat.title}</bdi>}
        subtitle={subtitle}
        action={isGroup
          ? <GroupMenu id={id} archived={chat.archived} isMaker={chat.makerId !== null && chat.makerId === meId} onPick={setSheet} />
          : <ArchiveMenu id={id} archived={chat.archived} />}
      />
      <MessageLog key={id} bubbles={bubbles} resetKey={id} emptyText={t('chat.noMessages')} earlier={earlier} />
      {chat.personLeft ? <p className="border-t border-hairline p-3 text-footnote text-ink-2">{t('chat.closed')}</p> : (
        <Composer
          id={id}
          people={data.people}
          pending={send.isPending}
          upload={chat.kind === 'project' && chat.project ? { projectId: chat.project.id } : undefined}
          onSend={(body, fileIds, clear) => send.mutate({ conversationId: id, body, fileIds }, { onSuccess: clear })}
        />
      )}
      {sheet && <GroupSheet id={id} mode={sheet} name={chat.title} people={data.people} meId={meId} onClose={() => setSheet(null)} />}
    </>
  );
}

const NO_COMMENTS: CommentView[] = [];

/** The comments of one task as a chat. A message posts a task comment. */
export function TaskPane({ id }: { id: string }) {
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
  useMarkTaskRead(id, comments.data, session.data?.authority.id);
  const me = session.data?.authority.id;
  // "mine" depends on the person, so the kept bubbles start again when the person changes.
  const bubbles = useBubbles(comments.data ?? NO_COMMENTS, (view: CommentView): Bubble => ({
    id: view.comment.id, author: view.author, actingFor: null, body: view.comment.body, files: view.files, createdAt: view.comment.createdAt,
    mine: view.author.id === me, edited: view.comment.editedAt !== null,
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
    <>
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
            <ArchiveMenu id={id} archived={row?.archived ?? false} />
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
    </>
  );
}

/** What shows beside the list. A task thread has a task id. Anything else is a chat. */
export function ConversationPane({ id }: { id: string }) {
  const { t } = useTranslation();
  if (id.startsWith('tsk_')) return <TaskPane key={id} id={id} />;
  if (id.startsWith('cnv_')) return <ChatPane key={id} id={id} />;
  return <div className="p-4"><EmptyState title={t('common.loadFailed')} body={t('errors.not_found')} /></div>;
}
