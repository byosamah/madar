import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TRACKER_TYPES, type TrackerDirection, type TrackerType } from '../../../api/contract/entities';
import type { UserCard } from '../../../api/contract/views';
import { newStoryId, useUndoable } from '../../../app/actions';
import { errorMessage } from '../../../app/errors';
import { useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Switch } from '../../../components/Switch';
import { todayISO } from '../../../lib/dates';
import { sideForType, sidesOf, waitingFor } from '../../../lib/tracker';
import { addWorkingDays } from '../../../lib/workdays';
import { AttachButton, PickedFiles, useAttachments } from '../../files/Attachments';
import { ReplyFields } from './ReplyFields';
import { TypeIcon } from './marks';
import { arrowStep } from '../../../lib/keys';

/**
 * One line to log an exchange with the client. Only the text is needed: the type, the direction and the date have
 * sensible defaults, so Enter saves. The type and the side stay as set for the next entry. The side follows the type: only a message,
 * a file or an "Other" entry asks for it. An entry that needs a reply also asks who replies and by which day.
 */
export function QuickLog({ projectId, members }: { projectId: string; members: UserCard[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const attachments = useAttachments();
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [type, setType] = useState<TrackerType>('message');
  const [direction, setDirection] = useState<TrackerDirection>('in');
  const [date, setDate] = useState(todayISO());
  const [wait, setWait] = useState(false);
  const me = useCall('session.get', {}).data?.user.id;
  const [replier, setReplier] = useState('');
  const [replyDate, setReplyDate] = useState('');
  const [uploading, setUploading] = useState(false);
  const log = useUndoable('tracker.log', {
    message: () => t('tracker.logged'),
    onSuccess: () => {
      setText('');
      setWait(false);
      setReplier('');
      setReplyDate('');
      setDate(todayISO());
      attachments.clear();
      field.current?.focus();
    },
  });

  // The type picker is one radio group: one Tab stop, and the arrow keys move the choice (audit 2026-10-03, PRJ-25).
  const typeButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const pickType = (value: TrackerType) => {
    setType(value);
    setDirection(sideForType(value, direction));
    setWait(false);
  };
  const onTypeKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = arrowStep(event.key, document.documentElement.dir === 'rtl', true);
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + TRACKER_TYPES.length) % TRACKER_TYPES.length;
    pickType(TRACKER_TYPES[next]);
    typeButtons.current[next]?.focus();
  };

  const sides = sidesOf(type);
  const needsReply = wait && waitingFor(direction) === 'us';
  const who = replier || (members.some((member) => member.id === me) ? me : members[0]?.id) || '';

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
    const waiting = wait ? waitingFor(direction) : null;
    const replyBy = waiting === 'us' && who ? { userId: who, dueDate: replyDate || addWorkingDays(todayISO(), 2) } : undefined;
    log.mutate({ projectId, type, direction, title, date: date || todayISO(), waiting, fileIds, replyBy });
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
      <div role="radiogroup" aria-label={t('tracker.typeLabel')} className="grid grid-cols-5 gap-1.5">
        {TRACKER_TYPES.map((value, index) => (
          <button
            key={value}
            ref={(node) => {
              typeButtons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={value === type}
            tabIndex={value === type ? 0 : -1}
            onKeyDown={(event) => onTypeKey(event, index)}
            onClick={() => pickType(value)}
            className={`pressable flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 text-footnote font-semibold ${value === type ? 'border-ink bg-panel text-ink' : 'border-transparent bg-fill text-ink-2 hover:text-ink'}`}
          >
            <TypeIcon type={value} size={20} animated />
            {t(`tracker.type.${value}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {sides.length > 1 && (
          <SegmentedControl
            label={t('tracker.directionLabel')}
            value={direction}
            options={sides.map((value) => ({ value, label: t(`tracker.direction.${value}`) }))}
            onChange={(value) => {
              setDirection(value);
              setWait(false);
            }}
          />
        )}
        <input type="date" aria-label={t('tracker.date')} value={date} onChange={(event) => setDate(event.target.value)} className="field min-h-11 !w-auto" />
        <AttachButton onPick={attachments.add} disabled={attachments.full} />
        <Switch id="tracker-wait" label={t(waitingFor(direction) === 'us' ? 'tracker.needsReply' : 'tracker.waitingToggle')} checked={wait} onChange={setWait} />
      </div>
      {needsReply && members.length > 0 && (
        <ReplyFields id="tracker-reply" members={members} userId={who} dueDate={replyDate || addWorkingDays(todayISO(), 2)} onUser={setReplier} onDueDate={setReplyDate} />
      )}
      <PickedFiles files={attachments.files} onRemove={attachments.remove} />
    </form>
  );
}
