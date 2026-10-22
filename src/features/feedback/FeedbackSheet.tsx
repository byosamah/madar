import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import type { FeedbackKind } from '../../api/contract/entities';
import { fieldError } from '../../app/errors';
import { useAction } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { TextArea } from '../../components/Fields';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { AttachFileIcon } from '../../components/icons/animated/attach-file';
import { XIcon } from '../../components/icons/animated/x';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Sheet } from '../../components/Sheet';
import { BarBox } from '../files/Attachments';

const MAX_SHOTS = 3;

/** A picked screenshot and its preview URL, released when it leaves the list. */
type Shot = { id: number; file: File; url: string };

/**
 * "Request a feature or report a bug" from the person menu (owner, 2026-10-01): one message and up to three
 * screenshots, chosen or pasted. It also sends the screen the person was on, so a bug report says where it happened.
 */
export function FeedbackSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const location = useLocation();
  const picker = useRef<HTMLInputElement>(null);
  const nextShot = useRef(0);
  const [kind, setKind] = useState<FeedbackKind>('feature');
  const [message, setMessage] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const page = `${location.pathname}${location.search}`;
  useEffect(() => {
    if (open) return;
    setKind('feature');
    setMessage('');
    setShots((current) => {
      current.forEach((shot) => URL.revokeObjectURL(shot.url));
      return [];
    });
  }, [open]);
  // The whole percent of the screenshots that go up, or null when nothing goes up (fbk_045).
  const [percent, setPercent] = useState<number | null>(null);
  const send = useAction('feedback.send', {
    onSuccess: () => {
      toast.show({ message: t('feedback.sent') });
      onOpenChange(false);
    },
    onProgress: (sent, total) => setPercent(total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0),
  });
  // A finished or failed send shows no bar.
  useEffect(() => {
    if (!send.isPending) setPercent(null);
  }, [send.isPending]);
  const add = (files: File[]) => {
    const pictures = files.filter((file) => file.type.startsWith('image/'));
    setShots((current) => [...current, ...pictures.map((file) => ({ id: nextShot.current++, file, url: URL.createObjectURL(file) }))].slice(0, MAX_SHOTS));
  };
  const remove = (index: number) => setShots((current) => {
    URL.revokeObjectURL(current[index].url);
    return current.filter((_, i) => i !== index);
  });
  // A screenshot on the clipboard (Cmd+V or Ctrl+V) is the quickest way to add one.
  const paste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (files.some((file) => file.type.startsWith('image/'))) add(files);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('feedback.title')}
      description={t('feedback.hint')}
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!message.trim() || send.isPending}
            onClick={() => send.mutate({ kind, message: message.trim(), page, screenshots: shots.map((shot) => shot.file) })}
          >
            {t('feedback.send')}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1" onPaste={paste}>
        <SegmentedControl label={t('feedback.kindLabel')} value={kind} onChange={setKind} options={[
          { value: 'feature', label: t('feedback.kinds.feature') },
          { value: 'bug', label: t('feedback.kinds.bug') },
        ]} />
        <TextArea
          id="feedback-message"
          label={t(kind === 'bug' ? 'feedback.whatWrong' : 'feedback.whatHelp')}
          value={message}
          dir="auto"
          rows={5}
          maxLength={2000}
          error={fieldError(send.error, 'message', t, t('errors.invalid_input'))}
          onChange={(event) => setMessage(event.target.value)}
        />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button variant="plain" className="-ms-3" disabled={shots.length >= MAX_SHOTS || send.isPending} onClick={() => picker.current?.click()}>
              <AnimatedIcon icon={AttachFileIcon} size={18} aria-hidden />
              {t('feedback.addScreenshot')}
            </Button>
            <span className="text-footnote text-ink-2">{t('feedback.pasteHint')}</span>
          </div>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            multiple
            aria-label={t('feedback.addScreenshot')}
            className="sr-only"
            onChange={(event) => {
              add([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          {shots.length > 0 && (
            <ul aria-label={t('feedback.screenshots')} className="flex flex-wrap gap-2">
              {shots.map((shot, index) => (
                <li key={shot.id} className="relative">
                  <img src={shot.url} alt={t('feedback.screenshotN', { n: index + 1 })} className="size-24 rounded-xl object-cover ring-1 ring-inset ring-ink/10" />
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={send.isPending}
                    aria-label={t('feedback.removeScreenshot', { n: index + 1 })}
                    className="pressable absolute -end-2 -top-2 grid size-7 place-items-center rounded-full bg-ink text-bg shadow"
                  >
                    <AnimatedIcon icon={XIcon} size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {shots.length > 0 && percent !== null && <BarBox label={t('feedback.uploading', { percent })} percent={percent} />}
        </div>
        <p className="text-footnote text-ink-2">{t('feedback.pageNote', { page: page || '/' })}</p>
      </div>
    </Sheet>
  );
}
