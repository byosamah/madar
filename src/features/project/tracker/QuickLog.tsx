import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TRACKER_TYPES, type TrackerDirection, type TrackerType } from '../../../api/contract/entities';
import { newStoryId, useUndoable } from '../../../app/actions';
import { errorMessage } from '../../../app/errors';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Switch } from '../../../components/Switch';
import { todayISO } from '../../../lib/dates';
import { AttachButton, PickedFiles, useAttachments } from '../../files/Attachments';
import { TypeIcon } from './marks';

/**
 * One line to log an exchange with the client. Only the text is needed: the type, the direction and the date have
 * sensible defaults, so Enter saves. The type and the direction stay as set for the next entry.
 */
export function QuickLog({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const attachments = useAttachments();
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [type, setType] = useState<TrackerType>('message');
  const [direction, setDirection] = useState<TrackerDirection>('in');
  const [date, setDate] = useState(todayISO());
  const [wait, setWait] = useState(false);
  const [uploading, setUploading] = useState(false);
  const log = useUndoable('tracker.log', {
    message: () => t('tracker.logged'),
    onSuccess: () => {
      setText('');
      setWait(false);
      setDate(todayISO());
      attachments.clear();
      field.current?.focus();
    },
  });

  const submit = async () => {
    const title = text.trim();
    if (!title || log.isPending || uploading) return;
    let fileIds: string[] = [];
    if (attachments.files.length > 0) {
      setUploading(true);
      try {
        fileIds = await attachments.upload({ projectId }, { correlationId: newStoryId() });
      } catch (error) {
        toast.show({ tone: 'error', message: errorMessage(error, t) });
        return;
      } finally {
        setUploading(false);
      }
    }
    log.mutate({ projectId, type, direction, title, date: date || todayISO(), waiting: wait ? (direction === 'in' ? 'us' : 'client') : null, fileIds });
  };

  return (
    <form
      aria-label={t('tracker.logLabel')}
      className="panel flex flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2">
        <input
          ref={field}
          type="text"
          dir="auto"
          maxLength={200}
          aria-label={t('tracker.logLabel')}
          placeholder={t('tracker.placeholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="field min-w-0 flex-1"
        />
        <Button variant="primary" type="submit" className="shrink-0" disabled={!text.trim() || log.isPending || uploading}>{t('tracker.save')}</Button>
      </div>
      <div role="radiogroup" aria-label={t('tracker.typeLabel')} className="grid grid-cols-4 gap-2">
        {TRACKER_TYPES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === type}
            onClick={() => setType(value)}
            className={`pressable flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 text-footnote font-semibold ${value === type ? 'border-ink bg-panel text-ink' : 'border-transparent bg-fill text-ink-2 hover:text-ink'}`}
          >
            <TypeIcon type={value} size={20} animated />
            {t(`tracker.type.${value}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <SegmentedControl
          label={t('tracker.directionLabel')}
          value={direction}
          options={[{ value: 'in', label: t('tracker.direction.in') }, { value: 'out', label: t('tracker.direction.out') }]}
          onChange={(value) => {
            setDirection(value);
            setWait(false);
          }}
        />
        <input type="date" aria-label={t('tracker.date')} value={date} onChange={(event) => setDate(event.target.value)} className="field min-h-11 !w-auto" />
        <AttachButton onPick={attachments.add} disabled={attachments.full} />
        <Switch id="tracker-wait" label={t(direction === 'in' ? 'tracker.needsReply' : 'tracker.waitingToggle')} checked={wait} onChange={setWait} />
      </div>
      <PickedFiles files={attachments.files} onRemove={attachments.remove} />
    </form>
  );
}
