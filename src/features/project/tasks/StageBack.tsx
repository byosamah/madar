import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/errors';
import { Button } from '../../../components/Button';
import { TextArea } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';

type Pending = { stage: string; send: (reason: string, log: boolean) => void };

/** True when the server refused a change because it moves the project back a stage and wants to know why. */
export function isStageBackRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.details.reason === 'stage_back_reason';
}

/**
 * A change can move the project back to an earlier stage (reopening a task, adding or moving one into an earlier stage).
 * The server then asks for a reason. This hook catches that refusal, asks "This moves the project back to X. Why?" in a small sheet,
 * and sends the same call again with the reason. Pass `refused` as the "onRefused" of the action, and render `sheet`.
 * "canLog" is the person's Tracker posting right on the project (viewerCan.post). With it, the sheet also offers an optional
 * tick box that logs the move in the Tracker as a Balady update (owner, 2026-10-03, API-14).
 */
export function useStageBack(canLog: boolean): {
  refused: <I extends object>(error: unknown, input: I, resend: (next: I & { reason: string; logInTracker?: boolean }) => void) => boolean;
  sheet: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const refused = <I extends object>(error: unknown, input: I, resend: (next: I & { reason: string; logInTracker?: boolean }) => void): boolean => {
    if (!isStageBackRefusal(error)) return false;
    setPending({ stage: String(error.details.stageName ?? ''), send: (reason, log) => resend({ ...input, reason, ...(log ? { logInTracker: true } : {}) }) });
    return true;
  };
  const sheet = pending ? (
    <StageBackSheet
      stage={pending.stage}
      canLog={canLog}
      onClose={() => setPending(null)}
      onSend={(reason, log) => {
        pending.send(reason, log);
        setPending(null);
      }}
    />
  ) : null;
  return { refused, sheet };
}

function StageBackSheet({ stage, canLog, onSend, onClose }: { stage: string; canLog: boolean; onSend: (reason: string, log: boolean) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [log, setLog] = useState(false);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('stageBack.title', { stage })}
      footer={(
        <>
          <Button variant="plain" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!reason.trim()} onClick={() => onSend(reason.trim(), log)}>{t('stageBack.confirm')}</Button>
        </>
      )}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (reason.trim()) onSend(reason.trim(), log);
        }}
      >
        <TextArea id="stage-back-reason" label={t('stageBack.label')} value={reason} dir="auto" maxLength={280} rows={3} onChange={(event) => setReason(event.target.value)} />
      </form>
      {canLog && (
        <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-fill">
          <input type="checkbox" className="size-5 shrink-0 accent-[var(--c-accent-fill)]" checked={log} onChange={(event) => setLog(event.target.checked)} />
          <span className="text-subheadline text-ink">{t('stageBack.logInTracker')}</span>
        </label>
      )}
    </Sheet>
  );
}
