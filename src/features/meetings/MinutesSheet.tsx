import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/errors';
import { MAX_ATTACHMENTS, MEETING_LIMITS } from '../../api/contract/limits';
import type { Attachment, MinutesView } from '../../api/contract/views';
import { newStoryId, useUndoable } from '../../app/actions';
import { errorMessage } from '../../app/errors';
import { useLang } from '../../app/lang';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { TextArea } from '../../components/Fields';
import { IconButton } from '../../components/IconButton';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { XIcon } from '../../components/icons/animated/x';
import { Sheet } from '../../components/Sheet';
import { AttachButton, PickedFiles, useAttachments } from '../files/Attachments';

/**
 * The sheet that writes the minutes of a meeting that ended, or changes them (wave 2, owner 2026-10-19). One text area, the attach button
 * with the files that stand and the files picked, and one main button. A project meeting takes files of its project; a meeting with no
 * project takes files that stay with the meeting. The save sends "since" (the value of updatedAt that the sheet opened, null for none), so
 * a save never replaces what another attendee wrote since; a refusal keeps the text in the field and shows its reason. After the save a
 * toast offers Undo. The person for the minutes is gone: any attendee writes them.
 */
export function MinutesSheet({ meeting, minutes, onClose }: {
  meeting: { id: string; title: string; projectId: string | null };
  minutes: MinutesView | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const [text, setText] = useState(minutes?.text ?? '');
  // The value of updatedAt that the sheet opened. It stays, even when the screen reads newer minutes behind the sheet: the save must
  // refuse to replace minutes that the person never saw (minutes_changed).
  const [since] = useState(minutes?.updatedAt ?? null);
  // The files that stand (a deleted one shows as removed and is dropped), and the files that the person picks.
  const [kept, setKept] = useState<Attachment[]>((minutes?.files ?? []).filter((file) => file.name !== null));
  const attachments = useAttachments(MAX_ATTACHMENTS - kept.length);
  const [problem, setProblem] = useState('');
  const [uploading, setUploading] = useState(false);
  const save = useUndoable('meetings.saveMinutes', {
    message: () => t('minutes.saved'),
    onSuccess: onClose,
    onRefused: (error) => {
      if (!(error instanceof ApiError) || error.code === 'failed' || error.code === 'unauthenticated') return false;
      setProblem(errorMessage(error, t));
      return true;
    },
  });
  const target = meeting.projectId ? { projectId: meeting.projectId } : { projectId: null, meetingId: meeting.id };
  const busy = save.isPending || uploading;

  const submit = async () => {
    if (busy) return;
    setProblem('');
    let uploaded: string[] = [];
    if (attachments.files.length > 0) {
      setUploading(true);
      try {
        uploaded = await attachments.upload(target, { correlationId: newStoryId() });
      } catch (error) {
        toast.failed(error);
        return;
      } finally {
        setUploading(false);
      }
    }
    save.mutate({ id: meeting.id, text, fileIds: [...kept.map((file) => file.id), ...uploaded], since });
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      // In Arabic the title of the meeting is often English, and the guillemets around it then break. The marks keep it in its own run.
      title={t('minutes.sheetTitle', { title: lang === 'ar' ? `\u2068${meeting.title}\u2069` : meeting.title })}
      footer={<Button variant="primary" disabled={busy} onClick={() => void submit()}>{t('minutes.save')}</Button>}
    >
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextArea
          id="minutes-text" label={t('minutes.field')} dir="auto" autoComplete="off" rows={8} maxLength={MEETING_LIMITS.minutesMax}
          value={text} onChange={(event) => setText(event.target.value)}
        />
        {kept.length > 0 && (
          <ul aria-label={t('attachments.files')} className="flex flex-wrap gap-2">
            {kept.map((file) => (
              <li key={file.id} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-fill ps-3">
                <bdi className="text-footnote">{file.name}</bdi>
                <IconButton label={t('attachments.remove', { name: file.name ?? '' })} onClick={() => setKept((list) => list.filter((one) => one.id !== file.id))}>
                  <AnimatedIcon icon={XIcon} size={14} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <PickedFiles files={attachments.files} onRemove={attachments.remove} progress={attachments.progress} busy={uploading} />
        <div><AttachButton onPick={attachments.add} disabled={attachments.full} /></div>
        {problem && <p role="alert" className="text-footnote text-late">{problem}</p>}
      </form>
    </Sheet>
  );
}
