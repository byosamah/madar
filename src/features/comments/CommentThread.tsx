import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REACTIONS } from '../../api/contract/entities';
import type { CommentView, UserCard } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { newStoryId } from '../../app/actions';
import { errorMessage } from '../../app/errors';
import { useAction, useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Age } from '../../components/Age';
import { AgentLabel } from '../../components/AgentLabel';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { MentionField } from '../../components/MentionField';
import { Menu } from '../../components/Menu';
import { RichText } from '../../components/RichText';
import { editedBody, plainText, withMentionMarkup } from '../../lib/text';
import { LoadFailed } from '../../components/LoadFailed';
import { AttachButton, FileChips, PickedFiles, useAttachments } from '../files/Attachments';
import { DateMoveLines } from '../project/tasks/DateReason';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { CalendarDaysIcon } from '../../components/icons/animated/calendar-days';
import { counted } from '../../lib/grammar';

function CommentItem({ view, people, canPost }: { view: CommentView; people: UserCard[]; canPost: boolean }) {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const { comment, author, canEdit, files } = view;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const update = useAction('comments.update', { onSuccess: () => setEditing(false) });
  const remove = useUndoable('comments.delete', { message: () => t('comments.deleted') });
  const react = useAction('reactions.toggle');
  const me = session.data?.user.id;
  // A message about moved dates (owner, 2026-10-02). Madar writes its own when a task it waited for finished late.
  const moved = comment.dates;
  const byMadar = Boolean(moved?.byTaskId);
  const actions = [
    ...(byMadar ? [] : [{
      label: t('comments.edit'),
      onSelect: () => {
        setDraft(plainText(comment.body));
        setEditing(true);
      },
    }]),
    ...(moved ? [] : [{ label: t('comments.delete'), onSelect: () => remove.mutate({ id: comment.id }), destructive: true }]),
  ];
  return (
    <li className="flex gap-3">
      {byMadar ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill text-ink-2" aria-hidden>
          <AnimatedIcon icon={CalendarDaysIcon} size={16} />
        </span>
      ) : <Avatar user={author} size={28} />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-footnote">
          <bdi className="font-semibold">{byMadar ? t('dateReason.madar') : author.name}</bdi>
          {!byMadar && author.kind === 'agent' && <AgentLabel />}
          <span className="text-label-2">
            <Age stamp={comment.createdAt} />
            {comment.editedAt && ` · ${t('comments.edited')}`}
          </span>
        </p>
        {editing ? (
          <form
            className="mt-1 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const body = editedBody(draft.trim(), people, comment.body);
              if (body) update.mutate({ id: comment.id, body });
            }}
          >
            <MentionField id={`edit-${comment.id}`} label={t('comments.edit')} value={draft} onChange={setDraft} people={people} rows={2} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" type="submit" disabled={!draft.trim() || update.isPending}>{t('comments.save')}</Button>
            </div>
          </form>
        ) : (
          <>
            {moved && <DateMoveLines move={moved} className="mt-0.5 text-footnote font-semibold text-ink-2" />}
            {byMadar && moved?.byTaskTitle && moved.lateDays
              ? <p dir="auto" className="text-subheadline">{t('dateReason.auto', { task: moved.byTaskTitle, lateness: counted(t, 'taskSheet.durationValue', moved.lateDays) })}</p>
              : <RichText body={comment.body} className="text-subheadline" />}
          </>
        )}
        <FileChips files={files} />
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {REACTIONS.map((emoji) => {
            const ids = comment.reactions[emoji];
            if (!canPost) {
              return ids.length > 0 ? (
                <span key={emoji} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-fill px-2 text-footnote">
                  <span aria-hidden>{emoji}</span>
                  <span className="tabular">{ids.length}</span>
                </span>
              ) : null;
            }
            const mine = me !== undefined && ids.includes(me);
            return (
              <button
                key={emoji}
                type="button"
                aria-pressed={mine}
                aria-label={t('comments.react', { emoji, n: ids.length })}
                onClick={() => react.mutate({ commentId: comment.id, emoji })}
                className={`pressable inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 text-subheadline ${mine ? 'bg-fill-strong ring-1 ring-inset ring-accent' : 'bg-fill'}`}
              >
                <span aria-hidden>{emoji}</span>
                {ids.length > 0 && <span className="tabular text-footnote">{ids.length}</span>}
              </button>
            );
          })}
          {canEdit && !editing && actions.length > 0 && <Menu label={t('comments.actions')} items={actions} />}
        </div>
      </div>
    </li>
  );
}

/**
 * Half-written comments, by task or post, for this browser tab (session storage, so a reload keeps them too). A panel that
 * closes (Focus mode, another task row, the Back button) unmounts its thread; its draft waits here until the person comes
 * back or sends it (audit PER-11). Blocked storage means the draft lasts only while the panel is open.
 */
const DRAFT = 'madar.draft.';
const readDraft = (key: string) => {
  try { return window.sessionStorage.getItem(DRAFT + key) ?? ''; } catch { return ''; }
};
const writeDraft = (key: string, text: string) => {
  try {
    if (text) window.sessionStorage.setItem(DRAFT + key, text);
    else window.sessionStorage.removeItem(DRAFT + key);
  } catch { /* blocked storage */ }
};

/** Comments on a task or a post (spec 7.2): @mentions, #project links, three reactions, and edit or delete for the author. */
export function CommentThread({
  targetType, targetId, projectId, stageId = null, people, canPost,
}: { targetType: 'task' | 'update'; targetId: string; projectId: string; stageId?: string | null; people: UserCard[]; canPost: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const attachments = useAttachments();
  const [uploading, setUploading] = useState(false);
  const comments = useCall('comments.list', { targetType, targetId });
  // Comments read here also count as read in the Inbox thread of the task (audit 2026-10-03, SHL-5).
  const { api } = useRuntime();
  const count = comments.data?.length;
  useEffect(() => {
    if (targetType === 'task' && count) api.call('chats.markRead', { conversationId: targetId }).catch(() => undefined);
  }, [api, targetType, targetId, count]);
  const draftKey = `${targetType}:${targetId}`;
  const [body, setBodyState] = useState(() => readDraft(draftKey));
  const setBody = (next: string) => {
    writeDraft(draftKey, next);
    setBodyState(next);
  };
  const create = useAction('comments.create', {
    onSuccess: () => {
      setBody('');
      attachments.clear();
    },
  });
  // The files go up first, to the project of the comment. A comment on a task also links them to the task.
  const send = async (text: string) => {
    setUploading(true);
    try {
      const fileIds = await attachments.upload({ projectId, stageId, taskId: targetType === 'task' ? targetId : null }, { correlationId: newStoryId() });
      create.mutate({ targetType, targetId, body: text, fileIds });
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
    } finally {
      setUploading(false);
    }
  };
  const list = comments.data ?? [];
  return (
    <section aria-label={t('comments.title')} className="flex flex-col gap-3">
      <h3 className="text-headline">{t('comments.title')}</h3>
      {comments.error && <LoadFailed error={comments.error} onRetry={() => void comments.refetch()} />}
      {comments.data && list.length === 0 && <p className="text-footnote text-label-2">{t('comments.empty')}</p>}
      {list.length > 0 && (
        <ol className="flex flex-col gap-3">
          {list.map((view) => <CommentItem key={view.comment.id} view={view} people={people} canPost={canPost} />)}
        </ol>
      )}
      {canPost ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = withMentionMarkup(body.trim(), people);
            if (text && !uploading) void send(text);
          }}
        >
          <MentionField id={`comment-${targetId}`} label={t('comments.add')} value={body} onChange={setBody} people={people} placeholder={t('comments.placeholder')} rows={2} />
          <PickedFiles files={attachments.files} onRemove={attachments.remove} />
          <div className="flex items-center justify-between gap-2">
            <AttachButton onPick={attachments.add} />
            <Button variant={body.trim() ? 'primary' : 'secondary'} type="submit" disabled={!body.trim() || create.isPending || uploading}>{t('comments.send')}</Button>
          </div>
        </form>
      ) : <p className="text-footnote text-label-2">{t('comments.cannot')}</p>}
    </section>
  );
}
