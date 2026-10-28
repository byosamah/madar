import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS, MESSAGE_MAX } from '../../api/contract/entities';
import type { ReplyRef, UserCard } from '../../api/contract/views';
import { newStoryId } from '../../app/actions';
import { readDraftFiles, useDraftOwner, useDraftText, writeDraftFiles } from '../../app/drafts';
import { useToast } from '../../app/toasts';
import { isPhoneNow, useIsPhone } from '../../app/useIsPhone';
import { useKeyboardOpen } from '../../app/useKeyboardOpen';
import { Button } from '../../components/Button';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { SendIcon } from '../../components/icons/animated/send';
import { MentionField } from '../../components/MentionField';
import { withMentionMarkup } from '../../lib/text';
import { EmojiButton, type EmojiButtonHandle } from '../emoji/EmojiButton';
import { insertAt } from '../emoji/insert';
import { AttachMenu } from '../files/AttachMenu';
import { pastedPictures, PickedFiles, useAttachments, type UploadTarget } from '../files/Attachments';
import { insertParts } from '../files/insertParts';
import type { InsertScope, PickedProjectFile } from '../files/ProjectFilePicker';
import { useChatDropReceiver } from './ChatDrop';
import { ComposerReplyStrip } from './ReplyStrip';

type ComposerProps = {
  id: string;
  people: UserCard[];
  /** The count of people that @everyone names here (fbk_041), for the row "Everyone" of the mention list. Missing: the row is off. */
  everyone?: number;
  pending: boolean;
  /** "clear" empties the box. Call it when the send worked. */
  onSend: (body: string, fileIds: string[], clear: () => void) => void;
  /** Where picked files go: a project, an office task or a chat of its own. Without it, the box shows no attach control. */
  upload?: UploadTarget;
  /**
   * Where "Insert from a project" looks (fbk_070, owner 2026-10-27). A direct chat or a group looks in every project the person may open
   * (`{}`). A project chat and a to-do thread keep to their own project (`{ projectId }`), as the server asks. Missing: no such choice.
   */
  insert?: InsertScope;
  /** The message that the next send answers (chat design 2026-10-19, item 10). Its strip shows above the field. */
  replyTo?: ReplyRef | null;
  /** The X of the strip, and Escape in the field, call this. */
  onCancelReply?: () => void;
  /** The Up key in an empty box asks the pane to open the edit of the newest own message. True: the pane did, and the key is spent. */
  onEditLast?: () => boolean;
  /** Called with the new text at each change of the field that a key or a paste made (chat presence design B1). A restored draft calls nothing. */
  onTextChange?: (text: string) => void;
  /** False: the box does not take the focus when the chat opens on a desk. Focus mode (fbk_059) keeps the focus on its Done button. */
  autoFocus?: boolean;
  /**
   * True in a narrow place (the sidebar of Focus mode, owner 2026-10-25): the short hint with the @ tip and the round Send icon of a phone,
   * so the empty box keeps one line. Enter still sends on a desk.
   */
  compact?: boolean;
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
function ComposerBox({ id, people, everyone, pending, onSend, upload, insert, owner, replyTo, onCancelReply, onEditLast, onTextChange, autoFocus = true, compact = false }: ComposerProps & { owner: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  // On a phone, Enter makes a new line and only the Send button sends (chat design 2026-10-19, item 7).
  // On a phone the box shows a short hint that keeps the @ tip: the full hint took three lines and made the empty box tall, and a
  // project chat pushes only the people that a message names (owner, 2026-10-20).
  const phone = useIsPhone();
  // The look of a phone (short hint, round Send, tight row) also serves a narrow place on a desk. Enter keeps the rule of the device.
  const tight = phone || compact;
  const keyboard = useKeyboardOpen();
  const draftKey = id.startsWith('tsk_') ? `task:${id}` : `chat:${id}`;
  const attachments = useAttachments(MAX_ATTACHMENTS, readDraftFiles(owner, draftKey), upload);
  const [uploading, setUploading] = useState(false);
  const [text, setText] = useDraftText(owner, draftKey);
  const field = useRef<HTMLTextAreaElement>(null);
  // The one door of a change of the text: the field, the emoji panel and the clear after a send all use it.
  const change = (next: string) => {
    setText(next);
    onTextChange?.(next);
  };
  // The emoji panel puts a pick at the caret of the field, through the one door `change`. The panel keeps the focus for a second pick, so the
  // caret goes back after the emoji without the focus (the focus returns to the field when the panel closes with Escape).
  const emoji = useRef<EmojiButtonHandle>(null);
  const insertEmoji = (symbol: string) => {
    const box = field.current;
    if (!box) return;
    const { next, caret } = insertAt(box.value, box.selectionStart ?? box.value.length, box.selectionEnd ?? box.value.length, symbol);
    change(next);
    requestAnimationFrame(() => box.setSelectionRange(caret, caret));
  };
  useEffect(() => {
    writeDraftFiles(owner, draftKey, attachments.files);
  }, [owner, draftKey, attachments.files]);
  // A phone keeps the field without the focus when a chat opens: the keyboard would cover the last messages and the "New" line (Direction D).
  useEffect(() => {
    if (autoFocus && !isPhoneNow()) field.current?.focus();
    // Only a new chat moves the focus. The prop is fixed for the life of a pane.
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
  // The project files go as messages at once, 10 in each message, in the order of the picks (fbk_070). They are the project files
  // themselves: no upload and no new storage. The words are the file names, as for a file sent with no words. The text of the box stays.
  const insertFiles = (picked: PickedProjectFile[]) => {
    for (const part of insertParts(picked)) onSend(part.body, part.fileIds, () => undefined);
  };
  const submit = async () => {
    const body = withMentionMarkup(text.trim(), people) || files.map((file) => file.name).join(', ').slice(0, MESSAGE_MAX);
    if (!body || pending || uploading) return;
    emoji.current?.close();
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
      change('');
      attachments.clear();
      field.current?.focus();
    });
  };
  return (
    <form
      className={`flex flex-col gap-2 border-t border-hairline px-3 pt-3 ${phone ? (keyboard ? 'pb-2' : 'pb-[max(env(safe-area-inset-bottom),0.5rem)]') : 'pb-3'}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {replyTo && onCancelReply && <ComposerReplyStrip replyTo={replyTo} onCancel={onCancelReply} />}
      {upload && <PickedFiles files={attachments.files} onRemove={attachments.remove} progress={attachments.progress} busy={uploading} />}
      {/* On a phone the row is tighter and Send is a round icon, so the box keeps the width it had before the emoji button (chat presence, 2026-10-21). */}
      <div className={`flex items-end ${tight ? 'gap-1' : 'gap-2'}`}>
      {(upload || insert) && <AttachMenu compact canUpload={!!upload} insert={insert} onPick={attachments.add} onInsert={insertFiles} />}
      <EmojiButton ref={emoji} onPick={insertEmoji} returnTo={() => field.current} />
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
          onChange={change}
          people={people}
          everyone={everyone}
          rows={1}
          inputRef={field}
          placement="above"
          placeholder={tight ? t('chat.placeholderPhone') : t('chat.placeholder')}
          // On a phone the field stops at 40 percent of the visible height, so the messages stay in view (landscape too).
          className="[&_textarea]:max-h-40 max-sm:[&_textarea]:max-h-[min(9rem,calc(var(--chat-h,100dvh)*0.4))] [&_textarea]:min-h-11 [&_textarea]:resize-none [&_textarea]:[field-sizing:content]"
          {...(phone ? { listMaxHeight: 'min(14.5rem,calc(var(--chat-h,100dvh) - 9rem))' } : {})}
        />
      </div>
      <Button
        variant="primary"
        type="submit"
        aria-label={tight ? t('chat.send') : undefined}
        className={tight ? 'size-11 shrink-0 rounded-full p-0' : 'shrink-0'}
        disabled={(!text.trim() && files.length === 0) || pending || uploading}
      >
        {tight ? <AnimatedIcon icon={SendIcon} size={20} className="rtl:-scale-x-100" aria-hidden /> : t('chat.send')}
      </Button>
      </div>
    </form>
  );
}
