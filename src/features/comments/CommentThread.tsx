import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReplyRef, UserCard } from '../../api/contract/views';
import { newStoryId } from '../../app/actions';
import { useDraftOwner, useDraftText } from '../../app/drafts';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { AgeRefresh } from '../../components/Age';
import { Button } from '../../components/Button';
import { MentionField } from '../../components/MentionField';
import { withMentionMarkup } from '../../lib/text';
import { LoadFailed } from '../../components/LoadFailed';
import { AttachButton, PickedFiles, pastedPictures, useAttachments, useBlockFileDrop } from '../files/Attachments';
import { ChatDropArea, useChatDropReceiver } from '../inbox/ChatDrop';
import { ComposerReplyStrip } from '../inbox/ReplyStrip';
import { CommentItem } from './CommentItem';
import { TaskComments } from './TaskComments';
import { useMarkTaskRead } from './markRead';

/** projectId is null for an office task (owner, 2026-10-06): its files go to the task alone. */
type CommentThreadProps = { targetType: 'task' | 'update'; targetId: string; projectId: string | null; stageId?: string | null; people: UserCard[]; canPost: boolean;
  /** False takes away the Attach button, the paste of pictures and the drop of files (no file.upload, role rights version 2). Default true. */
  canAttach?: boolean;
};

/**
 * Comments on a task or a post (spec 7.2): @mentions, #project links, three reactions, and edit or delete for the author.
 * A change of person starts a new thread with that person's draft, so no half-written words or picked files go over to the
 * next person (audit 2026-10-03, V-22).
 */
export function CommentThread(props: CommentThreadProps) {
  const owner = useDraftOwner();
  return owner ? <CommentThreadFor key={owner} owner={owner} {...props} /> : null;
}

/**
 * A panel that closes (Focus mode, another task row, the Back button) unmounts its thread; its half-written comment waits in
 * the drafts of the person until they come back or send it (audit PER-11). Blocked storage means the draft lasts only while
 * the panel is open.
 */
function CommentThreadFor({
  targetType, targetId, projectId, stageId = null, people, canPost, canAttach = true, owner,
}: CommentThreadProps & { owner: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const attachments = useAttachments();
  const [uploading, setUploading] = useState(false);
  const comments = useCall('comments.list', { targetType, targetId });
  useMarkTaskRead(targetType === 'task' ? targetId : null, comments.data, owner);
  const draftKey = `${targetType}:${targetId}`;
  const [body, setBody] = useDraftText(owner, draftKey);
  // The comment that the next send answers (chat design 2026-10-19, item 10): only a task comment takes a reply. The strip sits above the
  // field, and the focus goes into the field, so the person types the answer at once.
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const replyId = replyTo?.id;
  useEffect(() => {
    if (replyId) document.getElementById(`comment-${targetId}`)?.focus();
  }, [replyId, targetId]);
  const create = useAction('comments.create', {
    onSuccess: () => {
      setBody('');
      attachments.clear();
      setReplyTo(null);
    },
  });
  // The files go up first, to the project of the comment. A comment on a task also links them to the task.
  const send = async (text: string) => {
    setUploading(true);
    try {
      const fileIds = await attachments.upload({ projectId, stageId, taskId: targetType === 'task' ? targetId : null }, { correlationId: newStoryId() });
      create.mutate({ targetType, targetId, body: text, fileIds, ...(replyTo ? { replyToId: replyTo.id } : {}) });
    } catch (error) {
      toast.failed(error);
    } finally {
      setUploading(false);
    }
  };
  const list = comments.data ?? [];
  // A new object on each render: the ages of the comments read the clock on each key, as before the memo (RND-3).
  const refresh = {};
  // A file dropped on the panel outside the comments never opens in the browser tab (fbk_030).
  useBlockFileDrop();
  return (
    // Files dropped on the comments join the picked files, as in a chat (chat design item 14, fbk_030), where the person may post. The
    // area is no flex item here, so the panel keeps its layout.
    <ChatDropArea note={targetType === 'task' && projectId === null ? t('chat.dropOfficeTask') : t('chat.dropProject')} className="relative">
      <section aria-label={t('comments.title')} className="flex flex-col gap-3">
        <h3 className="text-headline">{t('comments.title')}</h3>
        {comments.error && <LoadFailed error={comments.error} onRetry={() => void comments.refetch()} />}
        {comments.data && list.length === 0 && <p className="text-footnote text-label-2">{t('comments.empty')}</p>}
        {list.length > 0 && (
          <AgeRefresh.Provider value={refresh}>
            {targetType === 'task' ? (
              // A task comment takes the look of the chat (chat design 2026-10-19, item 6). The comments of a post stay as they are.
              <TaskComments targetId={targetId} list={list} people={people} canPost={canPost} onReply={setReplyTo} />
            ) : (
              <ol className="flex flex-col gap-3">
                {list.map((view) => <CommentItem key={view.comment.id} view={view} people={people} canPost={canPost} />)}
              </ol>
            )}
          </AgeRefresh.Provider>
        )}
        {canPost ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const text = withMentionMarkup(body.trim(), people);
              if (text && !uploading) void send(text);
            }}
            // A paste of only pictures adds them to the picked files, with the rule of the chat box (item 14, fbk_032). Text stays text.
            onPaste={(event) => {
              const pictures = pastedPictures(event.clipboardData);
              if (!canAttach || pictures.length === 0) return;
              event.preventDefault();
              attachments.add(pictures);
            }}
          >
            {canAttach && <DropReceiver onFiles={attachments.add} />}
            {replyTo && <ComposerReplyStrip replyTo={replyTo} onCancel={() => setReplyTo(null)} />}
            <MentionField id={`comment-${targetId}`} label={t('comments.add')} value={body} onChange={setBody} people={people} placeholder={t('comments.placeholder')} rows={2} />
            <PickedFiles files={attachments.files} onRemove={attachments.remove} />
            <div className="flex items-center justify-between gap-2">
              {canAttach ? <AttachButton onPick={attachments.add} /> : <span />}
              <Button variant={body.trim() ? 'primary' : 'secondary'} type="submit" disabled={!body.trim() || create.isPending || uploading}>{t('comments.send')}</Button>
            </div>
          </form>
        ) : <p className="text-footnote text-label-2">{t('comments.cannot')}</p>}
      </section>
    </ChatDropArea>
  );
}

/** Gives the files that are dropped on the comments to the picked files of the box (fbk_030). It draws nothing. */
function DropReceiver({ onFiles }: { onFiles: (files: File[]) => void }) {
  useChatDropReceiver(onFiles);
  return null;
}
