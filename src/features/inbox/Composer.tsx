import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS, MESSAGE_MAX } from '../../api/contract/entities';
import type { UserCard } from '../../api/contract/views';
import { newStoryId } from '../../app/actions';
import { readDraftFiles, useDraftOwner, useDraftText, writeDraftFiles } from '../../app/drafts';
import { useToast } from '../../app/toasts';
import { useIsPhone } from '../../app/useIsPhone';
import { Button } from '../../components/Button';
import { MentionField } from '../../components/MentionField';
import { withMentionMarkup } from '../../lib/text';
import { AttachButton, PickedFiles, useAttachments, type UploadTarget } from '../files/Attachments';

type ComposerProps = {
  id: string;
  people: UserCard[];
  pending: boolean;
  /** "clear" empties the box. Call it when the send worked. */
  onSend: (body: string, fileIds: string[], clear: () => void) => void;
  /** Where picked files go: a project, an office task or a chat of its own. Without it, the box shows no attach control. */
  upload?: UploadTarget;
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
function ComposerBox({ id, people, pending, onSend, upload, owner }: ComposerProps & { owner: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  // On a phone, Enter makes a new line and only the Send button sends (chat design 2026-10-19, item 7).
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
      {upload && <PickedFiles files={attachments.files} onRemove={attachments.remove} progress={attachments.progress} busy={uploading} />}
      <div className="flex items-end gap-2">
      {upload && <AttachButton compact onPick={attachments.add} />}
      <div
        className="min-w-0 flex-1"
        onKeyDown={(event) => {
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
          placeholder={t('chat.placeholder')}
          className="[&_textarea]:max-h-40 [&_textarea]:min-h-11 [&_textarea]:resize-none [&_textarea]:[field-sizing:content]"
        />
      </div>
      <Button variant="primary" type="submit" className="shrink-0" disabled={(!text.trim() && files.length === 0) || pending || uploading}>{t('chat.send')}</Button>
      </div>
    </form>
  );
}
