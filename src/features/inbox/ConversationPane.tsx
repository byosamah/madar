import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { useAction, useCall, useRuntime } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { LoadFailed } from '../../components/LoadFailed';
import { ProjectTile } from '../../components/ProjectTile';
import { Composer, MessageLog, type Bubble } from './Thread';
import { ClipboardCheckIcon } from '../../components/icons/animated/clipboard-check';
import { actorContext } from '../../lib/grammar';

type Thread = CallOutput<'chats.messages'>;

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

function bubblesOf(thread: Thread): Bubble[] {
  return thread.messages.map((view) => ({
    id: view.message.id, author: view.author, actingFor: view.actingFor, body: view.message.body, files: view.files,
    createdAt: view.message.createdAt, mine: view.mine, edited: view.message.editedAt !== null,
  }));
}

/** A project chat or a direct chat. Opening it marks it read. */
export function ChatPane({ id }: { id: string }) {
  const { t } = useTranslation();
  const thread = useCall('chats.messages', { conversationId: id });
  const markRead = useAction('chats.markRead');
  const send = useAction('chats.send');
  const data = thread.data;
  const unread = data?.chat.unread ?? 0;
  useEffect(() => {
    if (unread > 0) markRead.mutate({ conversationId: id });
    // The mutation object changes on every render. Only a new count of unread messages matters here.
  }, [id, unread]);
  if (thread.error) return <div className="p-4"><LoadFailed error={thread.error} onRetry={() => void thread.refetch()} /></div>;
  if (!data) return <div className="flex-1" aria-busy="true" />;
  const { chat } = data;
  const lead = chat.kind === 'project' && chat.project
    ? <ProjectTile id={chat.project.id} mark={chat.project.mark} size={40} />
    : chat.person ? <Avatar user={chat.person} size={40} /> : null;
  // A direct chat with an inactive person says so and takes no new messages (audit 2026-10-03, SHL-15).
  // "Inactive" is the word Admin uses for the same state (audit 2026-10-03, V-25).
  const context = actorContext(chat.person);
  const subtitle = chat.kind === 'project' ? t('chat.projectChat') : chat.personLeft ? t('chat.inactive', { context }) : t('chat.directChat');
  return (
    <>
      <Header lead={lead} title={<bdi>{chat.title}</bdi>} subtitle={subtitle} />
      <MessageLog key={id} bubbles={bubblesOf(data)} resetKey={id} emptyText={t('chat.noMessages')} />
      {chat.personLeft ? <p className="border-t border-hairline p-3 text-footnote text-ink-2">{t('chat.closed')}</p> : (
        <Composer
          id={id}
          people={data.people}
          pending={send.isPending}
          upload={chat.kind === 'project' && chat.project ? { projectId: chat.project.id } : undefined}
          onSend={(body, fileIds, clear) => send.mutate({ conversationId: id, body, fileIds }, { onSuccess: clear })}
        />
      )}
    </>
  );
}

/** The comments of one task as a chat. A message posts a task comment. */
export function TaskPane({ id }: { id: string }) {
  const { t } = useTranslation();
  const task = useCall('tasks.get', { id });
  const projectId = task.data?.project.id;
  const project = useCall('projects.get', { id: projectId ?? 'prj_000' }, { enabled: projectId !== undefined });
  const comments = useCall('comments.list', { targetType: 'task', targetId: id });
  const session = useCall('session.get', {});
  const create = useAction('comments.create');
  const { api } = useRuntime();
  const count = comments.data?.length;
  useEffect(() => {
    // Opening the thread reads it (audit 2026-10-03, SHL-5). A failed read mark is not worth an error toast.
    if (count !== undefined) api.call('chats.markRead', { conversationId: id }).catch(() => undefined);
  }, [api, id, count]);
  const failed = task.error ?? comments.error;
  if (failed) return <div className="p-4"><LoadFailed error={failed} onRetry={() => { void task.refetch(); void comments.refetch(); }} /></div>;
  if (!task.data || !comments.data) return <div className="flex-1" aria-busy="true" />;
  const me = session.data?.authority.id;
  const bubbles: Bubble[] = comments.data.map((view) => ({
    id: view.comment.id, author: view.author, actingFor: null, body: view.comment.body, files: view.files, createdAt: view.comment.createdAt,
    mine: view.author.id === me, edited: view.comment.editedAt !== null,
  }));
  const canPost = project.data?.viewerCan.post ?? false;
  const people = (project.data?.members ?? []).map((member) => member.user).filter((user) => user.id !== me);
  return (
    <>
      <Header
        lead={<span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-ink-2"><AnimatedIcon icon={ClipboardCheckIcon} size={18} aria-hidden /></span>}
        title={<bdi>{task.data.task.title}</bdi>}
        subtitle={`${t('chat.taskThread')} · ${task.data.project.name}`}
        action={(
          <Link
            to={`/projects/${task.data.project.id}?tab=tasks&task=${id}`}
            className="pressable inline-flex min-h-11 shrink-0 items-center rounded-full bg-fill px-4 text-subheadline font-semibold text-ink"
          >
            {t('chat.openTask')}
          </Link>
        )}
      />
      <MessageLog key={id} bubbles={bubbles} resetKey={id} emptyText={t('chat.noMessages')} />
      {canPost ? (
        <Composer
          id={id}
          people={people}
          pending={create.isPending}
          upload={{ projectId: task.data.project.id, stageId: task.data.task.stageId, taskId: id }}
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
