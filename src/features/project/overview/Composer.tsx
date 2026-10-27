import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { ProjectDetail } from '../../../api/contract/views';
import { newStoryId } from '../../../app/actions';
import { useIsPhone } from '../../../app/useIsPhone';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { MentionField } from '../../../components/MentionField';
import { prefersReducedMotion } from '../../../lib/motion';
import { replaceParam } from '../../../lib/params';
import { withMentionMarkup } from '../../../lib/text';
import { AttachButton, PickedFiles, onPastePictures, useAttachments, useBlockFileDrop } from '../../files/Attachments';
import { ChatDropArea, DropReceiver } from '../../inbox/ChatDrop';
import { usePostDraft } from './postDraft';

/** A post carries up to 20 files (spec 5.2). */
const MAX_POST_FILES = 20;

/** The box that posts text with files and @mentions (spec 5.2). Type @ to pick a teammate. */
export function Composer({ detail, compact = false }: { detail: ProjectDetail; compact?: boolean }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const session = useCall('session.get', {});
  const [params, setParams] = useSearchParams();
  const area = useRef<HTMLTextAreaElement>(null);
  const phone = useIsPhone();
  // On a phone the text is a draft that a tab change keeps, and the header button reads it (phone D, P4).
  const [text, setText] = usePostDraft(detail.project.id, phone);
  const [focused, setFocused] = useState(false);
  // A press on the Attach or Post row moves the focus away from the box for a moment. The row must not close under that press.
  const pressedRow = useRef(false);
  const attachments = useAttachments(MAX_POST_FILES);
  const [posting, setPosting] = useState(false);
  const me = session.data?.authority.id;
  const people = detail.members.map((member) => member.user).filter((person) => person.id !== me);

  useEffect(() => {
    if (params.get('compose') !== '1') return;
    area.current?.focus();
    // A phone shows the box low on the page: bring it to the middle of the screen.
    if (phone) {
      area.current?.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    replaceParam(setParams, 'compose', null);
  }, [params, setParams, phone]);

  const post = async (event: FormEvent) => {
    event.preventDefault();
    // Every project person counts, also a name typed without the list (plan clarification 9).
    const body = withMentionMarkup(text.trim(), people);
    if (!body) return;
    const meta = { correlationId: newStoryId() };
    setPosting(true);
    try {
      const fileIds = await attachments.upload({ projectId: detail.project.id, stageId: detail.currentStage.id }, meta);
      await api.call('updates.create', { projectId: detail.project.id, body, fileIds }, meta);
      setText('');
      attachments.clear();
      toast.show({ message: t('overview.posted') });
    } catch (error) {
      toast.failed(error);
    } finally {
      setPosting(false);
    }
  };

  const mayUpload = detail.viewerCan.upload === true;
  // A file dropped on the screen outside the frame never opens in the browser tab (fbk_047).
  useBlockFileDrop();
  // A compact box is one line until it has the focus, text or files. Then the Attach and Post row shows.
  const open = !compact || focused || text.trim() !== '' || attachments.files.length > 0;
  const form = (
    <form
      onSubmit={post}
      aria-label={t('overview.composer')}
      className="panel flex flex-col gap-3 p-4"
      onPaste={onPastePictures(attachments.add, mayUpload)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (pressedRow.current) { pressedRow.current = false; return; }
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {mayUpload && !phone && <DropReceiver onFiles={attachments.add} />}
      <MentionField
        id="composer"
        label={t('overview.composer')}
        value={text}
        onChange={setText}
        people={people}
        placeholder={t('overview.placeholder')}
        inputRef={area}
        className={open ? '[&_textarea]:min-h-24' : '[&_textarea]:min-h-11'}
      />
      <PickedFiles files={attachments.files} onRemove={attachments.remove} progress={attachments.progress} busy={posting} />
      {open && (
        // A press on these buttons keeps the focus in the box, so the row does not close under the finger (Safari for iPhone).
        <div
          className="flex items-center justify-between gap-2"
          onPointerDown={() => {
            pressedRow.current = true;
            window.setTimeout(() => { pressedRow.current = false; }, 1000);
          }}
          onMouseDown={(event) => { if (event.target !== event.currentTarget && focused) event.preventDefault(); }}
        >
          {mayUpload ? <AttachButton onPick={attachments.add} /> : <span />}
          <Button variant={text.trim() ? 'primary' : 'secondary'} type="submit" disabled={!text.trim() || posting}>{t('overview.post')}</Button>
        </div>
      )}
    </form>
  );
  // A phone has no drag from outside, so it draws no drop frame. Files dropped on the box of a desk join the picked files, where
  // the person may upload. Nothing posts before the Post button.
  if (phone) return form;
  return <ChatDropArea note={t('overview.dropNote')} className="relative">{form}</ChatDropArea>;
}
