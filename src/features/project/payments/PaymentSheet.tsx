import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaymentRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { fieldError } from '../../../app/errors';
import { useAction } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextArea, TextField } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';
import { todayISO } from '../../../lib/dates';

type Problems = { name?: string; amount?: string; dueDate?: string; receivedOn?: string };

/** "120,000" and "120000.50" both read as a number. An empty or broken text reads as NaN. */
function parseAmount(text: string): number {
  const clean = text.replace(/[,\s]/g, '');
  return clean === '' ? Number.NaN : Number(clean);
}

/**
 * One payment milestone in a sheet: add it, or edit it, mark it received, or delete it with Undo.
 * The page shows this sheet only to people who may handle payments, and the API refuses everyone else.
 */
export function PaymentSheet({ projectId, row, onClose }: { projectId: string; row: PaymentRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const saved = row?.payment;
  const [name, setName] = useState(saved?.name ?? '');
  const [amount, setAmount] = useState(saved ? String(saved.amount) : '');
  const [dueDate, setDueDate] = useState(saved?.dueDate ?? '');
  const [receivedOn, setReceivedOn] = useState(saved?.receivedOn ?? '');
  const [note, setNote] = useState(saved?.note ?? '');
  const [problems, setProblems] = useState<Problems>({});
  const done = (message: string) => {
    toast.show({ message });
    onClose();
  };
  const create = useAction('payments.create', { onSuccess: () => done(t('payments.added')) });
  const update = useAction('payments.update', { onSuccess: () => done(t('payments.saved')) });
  const mark = useUndoable('payments.markReceived', { message: () => t('payments.receivedToast'), onSuccess: onClose });
  const remove = useUndoable('payments.delete', { message: () => t('payments.deleted'), onSuccess: onClose });
  const error = saved ? update.error : create.error;
  const problem = (field: keyof Problems, fallback: string) => problems[field] ?? fieldError(error, field, t, fallback);

  const submit = () => {
    const value = parseAmount(amount);
    // The same rules as the API, so the message shows under its field at once.
    const next: Problems = {
      name: name.trim() ? undefined : t('payments.errors.name'),
      amount: value > 0 ? undefined : t('payments.errors.amount'),
      dueDate: dueDate ? undefined : t('payments.errors.dueDate'),
      receivedOn: receivedOn > todayISO() ? t('payments.errors.futureReceived') : undefined,
    };
    setProblems(next);
    if (next.name || next.amount || next.dueDate || next.receivedOn) return;
    if (saved) update.mutate({ id: saved.id, patch: { name: name.trim(), amount: value, dueDate, receivedOn: receivedOn || null, note } });
    else create.mutate({ projectId, name: name.trim(), amount: value, dueDate, receivedOn: receivedOn || null, note });
  };
  const busy = create.isPending || update.isPending || mark.isPending || remove.isPending;
  const footer = (
    <>
      {saved && <Button variant="destructive" disabled={busy} onClick={() => remove.mutate({ id: saved.id })}>{t('common.delete')}</Button>}
      {saved && !saved.receivedOn && <Button disabled={busy} onClick={() => mark.mutate({ id: saved.id })}>{t('payments.markReceived')}</Button>}
      <Button variant="primary" disabled={busy} onClick={submit}>{t('common.save')}</Button>
    </>
  );
  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose(); }} title={saved ? t('payments.editTitle') : t('payments.addTitle')} footer={footer}>
      <form
        noValidate
        className="flex flex-col gap-4 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField id="payment-name" label={t('payments.name')} dir="auto" maxLength={120} value={name} error={problem('name', t('payments.errors.name'))} onChange={(event) => setName(event.target.value)} />
        <TextField id="payment-amount" label={t('payments.amountField')} inputMode="decimal" dir="ltr" value={amount} error={problem('amount', t('payments.errors.amount'))} onChange={(event) => setAmount(event.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="payment-due" type="date" label={t('payments.dueDate')} value={dueDate} error={problem('dueDate', t('payments.errors.dueDate'))} onChange={(event) => setDueDate(event.target.value)} />
          <TextField id="payment-received" type="date" label={t('payments.receivedOn')} value={receivedOn} error={problem('receivedOn', t('payments.errors.futureReceived'))} onChange={(event) => setReceivedOn(event.target.value)} />
        </div>
        <TextArea id="payment-note" label={t('payments.note')} dir="auto" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </form>
    </Sheet>
  );
}
