import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TRACKER_TYPES, type TrackerDirection, type TrackerType } from '../../../api/contract/entities';
import type { UserCard } from '../../../api/contract/views';
import { newStoryId, useUndoable } from '../../../app/actions';
import { useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { useIsPhone } from '../../../app/useIsPhone';
import { Button } from '../../../components/Button';
import { CalendarPopover } from '../../../components/CalendarPopover';
import { Sheet } from '../../../components/Sheet';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Switch } from '../../../components/Switch';
import { isFinePointer } from '../../../lib/calendar';
import { todayISO } from '../../../lib/dates';
import { sideForType, sidesOf, waitingFor } from '../../../lib/tracker';
import { addWorkingDays } from '../../../lib/workdays';
import { AttachButton, PickedFiles, onPastePictures, useAttachments, useBlockFileDrop } from '../../files/Attachments';
import { ChatDropArea, DropReceiver } from '../../inbox/ChatDrop';
import { ReplyFields } from './ReplyFields';
import { repliers } from './replyRights';
import { TypeIcon } from './marks';
import { arrowStep } from '../../../lib/keys';

/**
 * One line to log an exchange with the client. Only the text is needed: the type, the direction and the date have
 * sensible defaults, so Enter saves. The type and the side stay as set for the next entry. The side follows the type: only a message,
 * a file or an "Other" entry asks for it. An entry that needs a reply also asks who replies and by which day.
 */
export function QuickLog({ projectId, members: everyone, canReply = true, canAssign = true, canAttach = true, sheet }: {
  projectId: string; members: UserCard[];
  /** False when the person lacks tracker.reply (or task.add here): the entry can wait, but no reply to-do is asked for. */
  canReply?: boolean;
  /** False when the person lacks task.assign: only the person can be the one who replies. */
  canAssign?: boolean;
  /** False when the person lacks file.upload: no Attach button. */
  canAttach?: boolean;
  /**
   * On a phone the form opens in a sheet from one main button (phone D). QuickLog then draws only the sheet and stays mounted with its
   * tab, so the type and the side stay as set for the next entry. The Log it button sits in the footer of the sheet.
   */
  sheet?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const toast = useToast();
  const attachments = useAttachments();
  const field = useRef<HTMLInputElement>(null);
  const formId = useId();
  // The date keeps its full field look (it is never empty). On a computer a press opens Madar's calendar under it (UX audit 2026-10-19, INT-22).
  const dateInput = useRef<HTMLInputElement>(null);
  const dateBox = useRef<HTMLSpanElement>(null);
  const [calendarAnchor, setCalendarAnchor] = useState<HTMLElement | null>(null);
  const [text, setText] = useState('');
  const [type, setType] = useState<TrackerType>('message');
  const [direction, setDirection] = useState<TrackerDirection>('in');
  const [date, setDate] = useState(todayISO());
  const [wait, setWait] = useState(false);
  const me = useCall('session.get', {}).data?.user.id;
  const members = repliers(everyone, me, canAssign);
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
      // The sheet closes after a save and the box on the page keeps the focus for the next line.
      if (sheet) sheet.onOpenChange(false);
      else field.current?.focus();
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
        toast.failed(error);
        return;
      } finally {
        setUploading(false);
      }
    }
    const waiting = wait ? waitingFor(direction) : null;
    const replyBy = canReply && waiting === 'us' && who ? { userId: who, dueDate: replyDate || addWorkingDays(todayISO(), 2) } : undefined;
    log.mutate({ projectId, type, direction, title, date: date || todayISO(), waiting, fileIds, replyBy });
  };

  // A file dropped on the screen outside the frame never opens in the browser tab (fbk_047).
  useBlockFileDrop();
  const form = (
    <form
      id={formId}
      aria-label={t('tracker.logLabel')}
      className={sheet ? 'flex flex-col gap-3' : 'panel flex flex-col gap-3 p-4'}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      // A paste of only pictures adds them to the picked files, with the rule of the chat box (fbk_046). Text stays text.
      onPaste={onPastePictures(attachments.add, canAttach)}
    >
      {canAttach && !sheet && <DropReceiver onFiles={attachments.add} />}
      <div className="flex items-center gap-2">
        <input
          ref={field}
          type="text"
          // An empty field with dir="auto" is left to right, so a long Arabic hint lost its first word. Empty, the field follows the
          // page; with text, the text decides (2026-10-12).
          dir={text ? 'auto' : undefined}
          maxLength={200}
          aria-label={t('tracker.logLabel')}
          // The full hint is wider than the field on a phone: there it is the example only.
          placeholder={t(phone ? 'tracker.placeholderShort' : 'tracker.placeholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="field min-w-0 flex-1 text-ellipsis"
        />
        {!sheet && <Button variant="primary" type="submit" className="shrink-0" disabled={!text.trim() || log.isPending || uploading}>{t('tracker.save')}</Button>}
      </div>
      {/* Equal columns that never get narrower than their word: "Government" is wider than a fifth of a phone row (2026-10-12). */}
      <div role="radiogroup" aria-label={t('tracker.typeLabel')} className="grid grid-cols-[repeat(5,minmax(min-content,1fr))] gap-1.5">
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
        <span ref={dateBox} className="inline-flex">
          <input
            ref={dateInput}
            type="date"
            autoComplete="off"
            aria-label={t('tracker.date')}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            onClick={(event) => {
              // A phone keeps its own picker. A computer shows the calendar of Madar, and the browser picker stays shut.
              if (!isFinePointer() || !dateBox.current) return;
              event.preventDefault();
              setCalendarAnchor(dateBox.current);
            }}
            className="field min-h-11 !w-auto"
          />
        </span>
        {canAttach && <AttachButton onPick={attachments.add} disabled={attachments.full} />}
        <Switch id="tracker-wait" label={t(waitingFor(direction) === 'us' ? 'tracker.needsReply' : 'tracker.waitingToggle')} checked={wait} onChange={setWait} />
      </div>
      {needsReply && canReply && members.length > 0 && (
        <ReplyFields id="tracker-reply" members={members} userId={who} dueDate={replyDate || addWorkingDays(todayISO(), 2)} onUser={setReplier} onDueDate={setReplyDate} />
      )}
      <PickedFiles files={attachments.files} onRemove={attachments.remove} progress={attachments.progress} busy={uploading} />
      {calendarAnchor && (
        <CalendarPopover
          anchor={calendarAnchor}
          value={date}
          onPick={(day) => {
            setCalendarAnchor(null);
            setDate(day);
            dateInput.current?.focus();
          }}
          onClose={() => {
            setCalendarAnchor(null);
            dateInput.current?.focus();
          }}
        />
      )}
    </form>
  );
  if (sheet) {
    return (
      <Sheet
        open={sheet.open}
        onOpenChange={sheet.onOpenChange}
        title={t('phoneProject.tracker.logNew')}
        footer={<Button variant="primary" type="submit" form={formId} disabled={!text.trim() || log.isPending || uploading}>{t('tracker.save')}</Button>}
      >
        {form}
      </Sheet>
    );
  }
  // Files dropped on the quick log join the picked files, where the person may upload. Nothing saves before the save button.
  return <ChatDropArea note={t('tracker.dropNote')} className="relative">{form}</ChatDropArea>;
}
