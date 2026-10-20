import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REACTIONS } from '../../api/contract/limits';
import type { CommentView, UserCard } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { usePersonName } from '../../app/personName';
import { useAction, useCall } from '../../app/runtime';
import { Age } from '../../components/Age';
import { AgentLabel } from '../../components/AgentLabel';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { useEditFocus } from '../../components/editFocus';
import { MentionField } from '../../components/MentionField';
import { Menu } from '../../components/Menu';
import { RichText } from '../../components/RichText';
import { editedBody, plainText } from '../../lib/text';
import { AttachmentList } from '../files/PictureAttachments';
import { DateMoveLines } from '../project/tasks/DateReason';
import { reasonLineText, type ReasonKind } from './ReasonLine';

/**
 * Memoized, so a key in the comment box renders no comment again (performance audit 2026-10-07, RND-3). A comment still renders
 * when its own view changes (an edit, a reaction, a delete), and its age refreshes through AgeRefresh.
 */
export const CommentItem = memo(function CommentItem({ view, people, canPost }: { view: CommentView; people: UserCard[]; canPost: boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const session = useCall('session.get', {});
  const { comment, author, canEdit, files, kind } = view;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const focus = useEditFocus(editing);
  const update = useAction('comments.update', { onSuccess: () => setEditing(false) });
  const remove = useUndoable('comments.delete', { message: () => t('comments.deleted') });
  const react = useAction('reactions.toggle');
  const me = session.data?.user.id;
  // A quiet line of a reason (fbk_027, owner 2026-10-19; the dates since owner 2026-10-02): no avatar, no bubble, no reactions. The
  // person who gave a date reason may fix its words. A reopening and a Madar shift stay as they were written, and no line is deleted.
  const line: ReasonKind | null = kind === 'message' ? null : kind;
  const edit = {
    label: t('comments.edit'),
    onSelect: () => {
      setDraft(plainText(comment.body));
      setEditing(true);
    },
  };
  const actions = line === null
    ? [edit, { label: t('comments.delete'), onSelect: () => remove.mutate({ id: comment.id }), destructive: true }]
    : line === 'due_date' || line === 'start_date' ? [edit] : [];
  const editForm = (
    <form
      className="mt-1 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const body = editedBody(draft.trim(), people, comment.body);
        if (body) update.mutate({ id: comment.id, body });
      }}
    >
      <MentionField id={`edit-${comment.id}`} label={t('comments.edit')} value={draft} onChange={setDraft} people={people} rows={2} inputRef={focus.field} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={!draft.trim() || update.isPending}>{t('comments.save')}</Button>
      </div>
    </form>
  );
  if (line) {
    return (
      <li className="my-1.5 flex flex-col gap-0.5 text-footnote text-ink-2">
        {editing ? editForm : (
          <>
            <p className="flex flex-wrap items-center gap-x-2">
              <span dir="auto">{reasonLineText(t, { kind: line, body: comment.body, dates: comment.dates }, { name: nameOf(author), gender: author.gender })}</span>
              <span className="text-label-2">
                <span aria-hidden>· </span>
                <Age stamp={comment.createdAt} />
                {comment.editedAt && ` · ${t('comments.edited')}`}
              </span>
              {canEdit && actions.length > 0 && <span ref={focus.actions} className="contents"><Menu label={t('comments.actions')} items={actions} /></span>}
            </p>
            {comment.dates && <DateMoveLines move={comment.dates} className="text-caption text-label-2" />}
          </>
        )}
      </li>
    );
  }
  return (
    <li className="flex gap-3">
      <Avatar user={author} size={28} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-footnote">
          <bdi className="font-semibold">{nameOf(author)}</bdi>
          {author.kind === 'agent' && <AgentLabel />}
          <span className="text-label-2">
            <Age stamp={comment.createdAt} />
            {comment.editedAt && ` · ${t('comments.edited')}`}
          </span>
        </p>
        {editing ? (
          editForm
        ) : (
          <RichText body={comment.body} className="natural-side text-subheadline" />
        )}
        <AttachmentList files={files} />
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
          {canEdit && !editing && actions.length > 0 && <span ref={focus.actions} className="contents"><Menu label={t('comments.actions')} items={actions} /></span>}
        </div>
      </div>
    </li>
  );
});
