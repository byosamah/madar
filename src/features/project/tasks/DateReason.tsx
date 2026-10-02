import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DateMove } from '../../../api/contract/entities';
import { ApiError } from '../../../api/errors';
import { useLang } from '../../../app/lang';
import { Button } from '../../../components/Button';
import { TextArea } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';
import { formatDay } from '../../../lib/dates';

type Pending = { move: Pick<DateMove, 'from' | 'to'>; send: (reason: string) => void };

/** True when the server refused a change because it moves the dates of a task and wants to know why. */
export function isDateReasonRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.details.reason === 'date_reason_needed';
}

/** "Due date: from Mon 12 Oct to Mon 19 Oct", one line for each date that moved. */
export function DateMoveLines({ move, className = '' }: { move: Pick<DateMove, 'from' | 'to'>; className?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const day = (value: string | null) => (value ? formatDay(value, lang, 'withWeekday') : t('dateReason.none'));
  const lines = (['startDate', 'dueDate'] as const)
    .filter((key) => move.from[key] !== move.to[key])
    .map((key) => t('dateReason.change', { field: t(`taskSheet.${key}`), from: day(move.from[key]), to: day(move.to[key]) }));
  return (
    <ul className={`flex flex-col ${className}`}>
      {lines.map((line) => <li key={line} className="tabular">{line}</li>)}
    </ul>
  );
}

/**
 * The owner's rule (2026-10-02): a person who moves the dates of a task writes why. The server refuses the change without a reason.
 * This hook catches that refusal, shows what moves and asks why in a small sheet, then sends the same call again with the reason.
 * Cancel keeps the old dates, so the screen calls onCancel to put its fields back. Pass `refused` as the "onRefused" of the action.
 */
export function useDateReason(onCancel?: () => void): {
  refused: <I extends object>(error: unknown, input: I, resend: (next: I & { dateReason: string }) => void) => boolean;
  sheet: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const refused = <I extends object>(error: unknown, input: I, resend: (next: I & { dateReason: string }) => void): boolean => {
    if (!isDateReasonRefusal(error)) return false;
    const move = { from: error.details.from, to: error.details.to } as Pick<DateMove, 'from' | 'to'>;
    setPending({ move, send: (dateReason) => resend({ ...input, dateReason }) });
    return true;
  };
  const close = () => {
    setPending(null);
    onCancel?.();
  };
  const sheet = pending ? (
    <DateReasonSheet
      move={pending.move}
      onClose={close}
      onSend={(reason) => {
        pending.send(reason);
        setPending(null);
      }}
    />
  ) : null;
  return { refused, sheet };
}

function DateReasonSheet({ move, onSend, onClose }: { move: Pick<DateMove, 'from' | 'to'>; onSend: (reason: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('dateReason.title')}
      footer={(
        <>
          <Button variant="plain" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!reason.trim()} onClick={() => onSend(reason.trim())}>{t('dateReason.confirm')}</Button>
        </>
      )}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (reason.trim()) onSend(reason.trim());
        }}
      >
        <DateMoveLines move={move} className="text-subheadline font-semibold" />
        <TextArea
          id="date-reason"
          label={t('dateReason.label')}
          hint={t('dateReason.hint')}
          value={reason}
          dir="auto"
          maxLength={280}
          rows={3}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
        />
      </form>
    </Sheet>
  );
}
