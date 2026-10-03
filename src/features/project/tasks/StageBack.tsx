import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/errors';
import { Button } from '../../../components/Button';
import { TextArea } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';

type Pending = { stage: string; send: (reason: string) => void };

/** True when the server refused a change because it moves the project back a stage and wants to know why. */
export function isStageBackRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.details.reason === 'stage_back_reason';
}

/**
 * A change can move the project back to an earlier stage (reopening a task, adding or moving one into an earlier stage).
 * The server then asks for a reason. This hook catches that refusal, asks "This moves the project back to X. Why?" in a small sheet,
 * and sends the same call again with the reason. Pass `refused` as the "onRefused" of the action, and render `sheet`.
 */
export function useStageBack(): {
  refused: <I extends object>(error: unknown, input: I, resend: (next: I & { reason: string }) => void) => boolean;
  sheet: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const refused = <I extends object>(error: unknown, input: I, resend: (next: I & { reason: string }) => void): boolean => {
    if (!isStageBackRefusal(error)) return false;
    setPending({ stage: String(error.details.stageName ?? ''), send: (reason) => resend({ ...input, reason }) });
    return true;
  };
  const sheet = pending ? (
    <StageBackSheet
      stage={pending.stage}
      onClose={() => setPending(null)}
      onSend={(reason) => {
        pending.send(reason);
        setPending(null);
      }}
    />
  ) : null;
  return { refused, sheet };
}

function StageBackSheet({ stage, onSend, onClose }: { stage: string; onSend: (reason: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
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
          <Button variant="primary" disabled={!reason.trim()} onClick={() => onSend(reason.trim())}>{t('stageBack.confirm')}</Button>
        </>
      )}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (reason.trim()) onSend(reason.trim());
        }}
      >
        <TextArea id="stage-back-reason" label={t('stageBack.label')} value={reason} dir="auto" maxLength={280} rows={3} onChange={(event) => setReason(event.target.value)} />
      </form>
    </Sheet>
  );
}
