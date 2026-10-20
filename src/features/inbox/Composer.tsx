import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS, MESSAGE_MAX } from '../../api/contract/entities';
import type { ReplyRef, UserCard } from '../../api/contract/views';
import { newStoryId } from '../../app/actions';
import { readDraftFiles, useDraftOwner, useDraftText, writeDraftFiles } from '../../app/drafts';
import { useToast } from '../../app/toasts';
import { useIsPhone } from '../../app/useIsPhone';
import { Button } from '../../components/Button';
import { MentionField } from '../../components/MentionField';
import { withMentionMarkup } from '../../lib/text';
import { AttachButton, pastedPictures, PickedFiles, useAttachments, type UploadTarget } from '../files/Attachments';
import { useChatDropReceiver } from './ChatDrop';
import { ComposerReplyStrip } from './ReplyStrip';

type ComposerProps = {
  id: string;
  people: UserCard[];
  pending: boolean;
  /** "clear" empties the box. Call it when the send worked. */
  onSend: (body: string, fileIds: string[], clear: () => void) => void;
  /** Where picked files go: a project, an office task or a chat of its own. Without it, the box shows no attach control. */
  upload?: UploadTarget;
  /** The message that the next send answers (chat design 2026-10-19, item 10). Its strip shows above the field. */
  replyTo?: ReplyRef | null;
  /** The X of the strip, and Escape in the field, call this. */
  onCancelReply?: () => void;
  /** The Up key in an empty box asks the pane to open the edit of the newest own message. True: the pane did, and the key is spent. */
  onEditLast?: () => boolean;
};

/**
 * The box under the messages, for the current person. A change of person starts a new box with that person's draft, so no
 * typed words or picked files go over to the next person (audit 2026-10-03, V-22).
 */
export function Composer(props: ComposerProps) {
  const owner = useDraftOwner();
  return owner ? <ComposerBox key={owner} owner={owner} {...props} /> : null;
}

/**
 * Enter sends, Shift+Enter starts a new line, and the focus lands here when a chat opens. On a phone, Enter starts a new line and only the
 * Send button sends. Opening another chat, another tab or
 * Search unmounts the box; its draft waits until the person comes back or sends it (audit 2026-10-03, SHL-4). The text uses the
 * keys of the comment box (CommentThread), so a task thread and the comments of its task share one draft.
 */
function ComposerBox({ id, people, pending, onSend, upload, owner, replyTo, onCancelReply, onEditLast }: ComposerProps & { owner: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  // On a phone, Enter makes a new line and only the Send button sends (chat design 2026-10-19, item 7).
  // On a phone the box shows a short hint that keeps the @ tip: the full hint took three lines and made the empty box tall, and a
  // project chat pushes only the people that a message names (owner, 2026-10-20).
  const phone = useIsPhone();
  const draftKey = id.startsWith('tsk_') ? `task:${id}` : `chat:${id}`;
  const attachments = useAttachments(MAX_ATTACHMENTS, readDraftFiles(owner, draftKey));
  const [uploading, setUploading] = useState(false);
  const [text, setText] = useDraftText(owner, draftKey);
  useEffect(() => {
    writeDraftFiles(owner, draftKey, attachments.files);
  }, [owner, draftKey, attachments.files]);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, [id]);
  // Files dropped on the chat join the picked chips, and nothing sends until Send (item 14).
  useChatDropReceiver(upload ? (dropped) => { attachments.add(dropped); field.current?.focus(); } : null);
  // A reply puts the focus into the field, so the person types the answer at once.
  const replyId = replyTo?.id;
  useEffect(() => {
    if (replyId) field.current?.focus();
  }, [replyId]);
  // A file may go with no words: its name becomes the words, the same way Share does (audit 2026-10-03, SHL-21).
  const files = upload ? attachments.files : [];
  const submit = async () => {
    const body = withMentionMarkup(text.trim(), people) || files.map((file) => file.name).join(', ').slice(0, MESSAGE_MAX);
    if (!body || pending || uploading) return;
    let fileIds: string[] = [];
    if (upload && attachments.files.length > 0) {
      setUploading(true);
      try {
        fileIds = await attachments.upload(upload, { correlationId: newStoryId() });
      } catch (error) {
        toast.failed(error);
        return;
      } finally {
        setUploading(false);
      }
    }
    onSend(body, fileIds, () => {
      setText('');
      attachments.clear();
      field.current?.focus();
    });
  };
  return (
    <form
      className="flex flex-col gap-2 border-t border-hairline p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {replyTo && onCancelReply && <ComposerReplyStrip replyTo={replyTo} onCancel={onCancelReply} />}
      {upload && <PickedFiles files={attachments.files} onRemove={attachments.remove} progress={attachments.progress} busy={uploading} />}
      <div className="flex items-end gap-2">
      {upload && <AttachButton compact onPick={attachments.add} />}
      <div
        className="min-w-0 flex-1"
        onPaste={(event) => {
          // A paste that holds text stays text. A paste of only pictures adds them as picked files (item 14).
          if (!upload) return;
          const pictures = pastedPictures(event.clipboardData);
          if (pictures.length === 0) return;
          event.preventDefault();
          attachments.add(pictures);
        }}
        onKeyDown={(event) => {
          // Escape drops a waiting reply. The mention list takes its own Escape first and marks the event.
          if (event.key === 'Escape' && replyTo && !event.defaultPrevented) {
            event.preventDefault();
            onCancelReply?.();
            return;
          }
          // The Up key in an empty box (no words, no picked file) edits the last own message, as in Campfire. A mention list takes it first.
          if (event.key === 'ArrowUp' && !event.defaultPrevented && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
            && !text && files.length === 0 && onEditLast?.()) {
            event.preventDefault();
            return;
          }
          // The mention list handles its own Enter and marks the event. Only a plain Enter sends, and not on a phone.
          if (phone || event.key !== 'Enter' || event.shiftKey || event.defaultPrevented || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void submit();
        }}
      >
        <MentionField
          id={`composer-${id}`}
          label={t('chat.composer')}
          value={text}
          onChange={setText}
          people={people}
          rows={1}
          inputRef={field}
          placement="above"
          placeholder={phone ? t('chat.placeholderPhone') : t('chat.placeholder')}
          className="[&_textarea]:max-h-40 [&_textarea]:min-h-11 [&_textarea]:resize-none [&_textarea]:[field-sizing:content]"
        />
      </div>
      <Button variant="primary" type="submit" className="shrink-0" disabled={(!text.trim() && files.length === 0) || pending || uploading}>{t('chat.send')}</Button>
      </div>
    </form>
  );
}
