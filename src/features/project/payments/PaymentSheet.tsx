import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaymentRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { fieldError } from '../../../app/errors';
import { useAction } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { DateField } from '../../../components/DateField';
import { TextArea, TextField } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';
import { todayISO } from '../../../lib/dates';
import { areaValue } from '../../projects/projectForm';

type Problems = { name?: string; amount?: string; dueDate?: string; receivedOn?: string };

/** What the person typed in a payment sheet and did not save, by project and sheet ("new", or the ID of the payment). */
export type PaymentDraft = { name: string; amount: string; dueDate: string; receivedOn: string; note: string };

/**
 * "120,000" and "120000.50" both read as a number. An empty or broken text reads as NaN.
 * An Arabic phone keyboard types Arabic-Indic digits and marks, so those count too (audit 2026-10-03, PRJ-12).
 */
function parseAmount(text: string): number {
  return areaValue(text.replace(/\s/g, '')) ?? Number.NaN;
}

/**
 * One payment milestone in a sheet: add it, or edit it, mark it received, or delete it with Undo.
 * The page shows this sheet only to people who may handle payments, and the API refuses everyone else.
 * A sheet closed by accident (Escape, a press outside, a swipe, Close) keeps what the person typed in `drafts`. Only Cancel
 * and a done change start the next sheet from the saved values: the New Project sheet rule (audit 2026-10-03, F-17).
 */
export function PaymentSheet({ projectId, row, onClose, drafts }: { projectId: string; row: PaymentRow | null; onClose: () => void; drafts?: Map<string, PaymentDraft> }) {
  const { t } = useTranslation();
  const toast = useToast();
  const saved = row?.payment;
  // The meeting shows one Payments panel for project after project, so the key names the project too.
  const draftKey = `${projectId}:${saved?.id ?? 'new'}`;
  const start: PaymentDraft = {
    name: saved?.name ?? '', amount: saved ? String(saved.amount) : '', dueDate: saved?.dueDate ?? '', receivedOn: saved?.receivedOn ?? '', note: saved?.note ?? '',
  };
  const kept = drafts?.get(draftKey) ?? start;
  const [form, setForm] = useState<PaymentDraft>(kept);
  const set = (patch: Partial<PaymentDraft>) => setForm((current) => ({ ...current, ...patch }));
  const { name, amount, dueDate, receivedOn, note } = form;
  const [problems, setProblems] = useState<Problems>({});
  // Only a change is kept, so a later change by another person shows when the sheet opens again.
  const startText = JSON.stringify(start);
  useEffect(() => {
    if (JSON.stringify(form) !== startText) drafts?.set(draftKey, form);
    else drafts?.delete(draftKey);
  }, [drafts, draftKey, form, startText]);
  const close = () => {
    drafts?.delete(draftKey);
    onClose();
  };
  const done = (message: string) => {
    toast.show({ message });
    close();
  };
  const create = useAction('payments.create', { onSuccess: () => done(t('payments.added')) });
  const update = useAction('payments.update', { onSuccess: () => done(t('payments.saved')) });
  const mark = useUndoable('payments.markReceived', { message: () => t('payments.receivedToast'), onSuccess: close });
  const remove = useUndoable('payments.delete', { message: () => t('payments.deleted'), onSuccess: close });
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
      <Button variant="plain" onClick={close}>{t('common.cancel')}</Button>
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
        <TextField id="payment-name" label={t('payments.name')} dir="auto" maxLength={120} value={name} error={problem('name', t('payments.errors.name'))} onChange={(event) => set({ name: event.target.value })} />
        <TextField id="payment-amount" label={t('payments.amountField')} inputMode="decimal" dir="ltr" value={amount} error={problem('amount', t('payments.errors.amount'))} onChange={(event) => set({ amount: event.target.value })} />
        {/* The due date is needed, so it changes but never goes empty: no clear control. The received date is empty until the money comes. */}
        <div className="grid grid-cols-2 gap-4">
          <DateField id="payment-due" label={t('payments.dueDate')} clearable={false} value={dueDate} error={problem('dueDate', t('payments.errors.dueDate'))} onChange={(day) => set({ dueDate: day })} />
          <DateField id="payment-received" label={t('payments.receivedOn')} value={receivedOn} error={problem('receivedOn', t('payments.errors.futureReceived'))} onChange={(day) => set({ receivedOn: day })} />
        </div>
        <TextArea id="payment-note" label={t('payments.note')} dir="auto" maxLength={500} value={note} onChange={(event) => set({ note: event.target.value })} />
      </form>
    </Sheet>
  );
}
