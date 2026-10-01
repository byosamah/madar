import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REACTIONS } from '../../api/contract/entities';
import type { CommentView, UserCard } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useAction, useCall } from '../../app/runtime';
import { Age } from '../../components/Age';
import { AgentLabel } from '../../components/AgentLabel';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { MentionField } from '../../components/MentionField';
import { Menu } from '../../components/Menu';
import { RichText } from '../../components/RichText';
import { plainText, withMentionMarkup } from '../../lib/text';
import { LoadFailed } from '../../components/LoadFailed';

function CommentItem({ view, people, canPost }: { view: CommentView; people: UserCard[]; canPost: boolean }) {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const { comment, author, canEdit } = view;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const update = useAction('comments.update', { onSuccess: () => setEditing(false) });
  const remove = useUndoable('comments.delete', { message: () => t('comments.deleted') });
  const react = useAction('reactions.toggle');
  const me = session.data?.user.id;
  return (
    <li className="flex gap-3">
      <Avatar user={author} size={28} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-footnote">
          <bdi className="font-semibold">{author.name}</bdi>
          {author.kind === 'agent' && <AgentLabel />}
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
              const body = withMentionMarkup(draft.trim(), people);
              if (body) update.mutate({ id: comment.id, body });
            }}
          >
            <MentionField id={`edit-${comment.id}`} label={t('comments.edit')} value={draft} onChange={setDraft} people={people} rows={2} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" type="submit" disabled={!draft.trim() || update.isPending}>{t('comments.save')}</Button>
            </div>
          </form>
        ) : <RichText body={comment.body} className="text-subheadline" />}
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
          {canEdit && !editing && (
            <Menu
              label={t('comments.actions')}
              items={[
                {
                  label: t('comments.edit'),
                  onSelect: () => {
                    setDraft(plainText(comment.body));
                    setEditing(true);
                  },
                },
                { label: t('comments.delete'), onSelect: () => remove.mutate({ id: comment.id }), destructive: true },
              ]}
            />
          )}
        </div>
      </div>
    </li>
  );
}

/** Comments on a task or a post (spec 7.2): @mentions, #project links, three reactions, and edit or delete for the author. */
export function CommentThread({
  targetType, targetId, people, canPost,
}: { targetType: 'task' | 'update'; targetId: string; people: UserCard[]; canPost: boolean }) {
  const { t } = useTranslation();
  const comments = useCall('comments.list', { targetType, targetId });
  const [body, setBody] = useState('');
  const create = useAction('comments.create', { onSuccess: () => setBody('') });
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
            if (text) create.mutate({ targetType, targetId, body: text });
          }}
        >
          <MentionField id={`comment-${targetId}`} label={t('comments.add')} value={body} onChange={setBody} people={people} placeholder={t('comments.placeholder')} rows={2} />
          <Button variant={body.trim() ? 'primary' : 'secondary'} type="submit" className="self-end" disabled={!body.trim() || create.isPending}>{t('comments.send')}</Button>
        </form>
      ) : <p className="text-footnote text-label-2">{t('comments.cannot')}</p>}
    </section>
  );
}
