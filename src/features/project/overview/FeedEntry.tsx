import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FeedItem, UserCard } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { useAction } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { useEditFocus } from '../../../components/editFocus';
import { MentionField } from '../../../components/MentionField';
import { Menu } from '../../../components/Menu';
import { RichText } from '../../../components/RichText';
import { editedBody, plainText } from '../../../lib/text';
import { CommentThread } from '../../comments/CommentThread';
import { FileChips } from '../../files/Attachments';
import { feedText } from '../../projects/feed';

type PostItem = Extract<FeedItem, { kind: 'update' }>;

function PostCard({ item, projectId, people, canPost, canAttach, startOpen }: {
  item: PostItem; projectId: string; people: UserCard[]; canPost: boolean; canAttach: boolean; startOpen: boolean;
}) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const toast = useToast();
  const ref = useRef<HTMLLIElement>(null);
  const [showComments, setShowComments] = useState(startOpen);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const focus = useEditFocus(editing);
  const save = useAction('updates.update', {
    onSuccess: () => {
      setEditing(false);
      toast.show({ message: t('posts.saved') });
    },
  });
  const remove = useUndoable('updates.delete', { message: () => t('posts.deleted') });
  useEffect(() => {
    if (startOpen) ref.current?.scrollIntoView({ block: 'center' });
  }, [startOpen]);
  const commentLabel = showComments ? t('comments.hide') : item.commentCount > 0 ? t('comments.show', { n: item.commentCount }) : t('comments.start');
  return (
    <li ref={ref} className="surface flex flex-col gap-2 rounded-card p-4">
      <div className="flex items-center gap-3">
        <Avatar user={item.author} size={36} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <bdi className="truncate font-semibold">{nameOf(item.author)}</bdi>
            {item.author.kind === 'agent' && <AgentLabel />}
          </p>
          <p className="text-caption text-label-2">
            <Age stamp={item.at} />
            {item.editedAt && <> · {t('overview.edited')}</>}
          </p>
        </div>
        {item.canEdit && !editing && (
          <span ref={focus.actions} className="contents">
            <Menu
              label={t('posts.actions')}
              items={[
                {
                  label: t('posts.edit'),
                  onSelect: () => {
                    setDraft(plainText(item.body));
                    setEditing(true);
                  },
                },
                { label: t('posts.delete'), onSelect: () => remove.mutate({ id: item.id }), destructive: true },
              ]}
            />
          </span>
        )}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = editedBody(draft.trim(), people, item.body);
            if (body) save.mutate({ id: item.id, body });
          }}
        >
          <MentionField id={`post-${item.id}`} label={t('posts.editLabel')} value={draft} onChange={setDraft} people={people} inputRef={focus.field} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" type="submit" disabled={!draft.trim() || save.isPending}>{t('comments.save')}</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col items-start gap-1">
          {item.decision && <span className="rounded-full bg-fill px-2 text-caption font-semibold text-label-2">{t('posts.decision')}</span>}
          <RichText body={item.body} className="text-body" />
        </div>
      )}
      {/* The API names the files of a post in "attachments"; a deleted file says "File removed", never its id (audit 2026-10-03, PRJ-6, V-20). */}
      <FileChips files={item.attachments} />
      <Button variant="plain" className="self-start px-0" aria-expanded={showComments} onClick={() => setShowComments((open) => !open)}>{commentLabel}</Button>
      {showComments && <CommentThread targetType="update" targetId={item.id} projectId={projectId} people={people} canPost={canPost} canAttach={canAttach} />}
    </li>
  );
}

type EventItem = Extract<FeedItem, { kind: 'event' }>;

/** A system event as one quiet line. An agent change offers Undo to the people spec 10.7 names; the API says who. */
function EventLine({ item }: { item: EventItem }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const toast = useToast();
  const undo = useAction('events.undo', { onSuccess: () => toast.show({ message: t('taskSheet.undone') }) });
  return (
    <li className="flex items-center gap-3 px-1">
      <Avatar user={item.author} size={28} />
      <p className="min-w-0 flex-1 text-subheadline">
        <bdi className="font-semibold">{nameOf(item.author)}</bdi>{' '}
        {item.author.kind === 'agent' && <><AgentLabel />{' '}</>}
        <span className="text-label-2">{feedText(item, t, lang)}</span>
      </p>
      <span className="text-caption text-label-2"><Age stamp={item.at} /></span>
      {item.canUndo && (
        <Button variant="plain" disabled={undo.isPending} onClick={() => undo.mutate({ eventId: item.id })}>{t('taskSheet.undoAgent')}</Button>
      )}
    </li>
  );
}

/** A post as a card with its comments, or a system event as one quiet line (spec 5.2 and 7.2). */
export function FeedEntry({ item, projectId, people, canPost, canAttach, startOpen }: {
  item: FeedItem; projectId: string; people: UserCard[]; canPost: boolean; canAttach: boolean; startOpen: boolean;
}) {
  if (item.kind === 'update') return <PostCard item={item} projectId={projectId} people={people} canPost={canPost} canAttach={canAttach} startOpen={startOpen} />;
  return <EventLine item={item} />;
}
