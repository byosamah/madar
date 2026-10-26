import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaymentRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { fieldError } from '../../../app/errors';
import { useSheetSteps } from '../../../app/insight/useSheetSteps';
import { useAction } from '../../../app/runtime';
import { useRight } from '../../../app/useRight';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { DateField } from '../../../components/DateField';
import { TextArea, TextField } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';
import { todayISO } from '../../../lib/dates';
import { areaValue } from '../../projects/projectForm';
import { useDaftraPart } from './DaftraPart';

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
  const [problems, setProblems] = useState<Problems>({});
  const set = (patch: Partial<PaymentDraft>) => {
    const next = { ...form, ...patch };
    setForm(next);
    // A field that shows a message checks itself again as the person fixes it, so a fixed field loses its message at once
    // (owner, 2026-10-05). A field with no message stays quiet until the next Save.
    setProblems((shown) => {
      const now = rulesOf(next);
      return Object.fromEntries(Object.entries(shown).map(([field, text]) => [field, text && now[field as keyof Problems]])) as Problems;
    });
  };
  const { name, amount, dueDate, receivedOn, note } = form;
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
  // The sheet is mounted only while it is open, so its mount is the open step and its unmount is the close step.
  const stepSaved = useSheetSteps('payment', true);
  const done = (message: string) => {
    stepSaved();
    toast.show({ message });
    close();
  };
  const create = useAction('payments.create', { onSuccess: () => done(t('payments.added')) });
  const update = useAction('payments.update', { onSuccess: () => done(t('payments.saved')) });
  const mark = useUndoable('payments.markReceived', { message: () => t('payments.receivedToast'), onSuccess: () => { stepSaved(); close(); } });
  const remove = useUndoable('payments.delete', { message: () => t('payments.deleted'), onSuccess: () => { stepSaved(); close(); } });
  // Role rights version 2: a new payment needs payment.add, a change and a delete need payment.change, and Mark as received needs
  // payment.receive. A person who holds none of them for this payment reads the sheet and changes nothing.
  const mayAdd = useRight('payment.add');
  const mayChange = useRight('payment.change');
  const mayReceive = useRight('payment.receive');
  const mayEdit = saved ? mayChange : mayAdd;
  const error = saved ? update.error : create.error;
  const problem = (field: keyof Problems, fallback: string) => problems[field] ?? fieldError(error, field, t, fallback);

  // The same rules as the API, so the message shows under its field at once.
  function rulesOf(draft: PaymentDraft): Problems {
    return {
      name: draft.name.trim() ? undefined : t('payments.errors.name'),
      amount: parseAmount(draft.amount) > 0 ? undefined : t('payments.errors.amount'),
      dueDate: draft.dueDate ? undefined : t('payments.errors.dueDate'),
      receivedOn: draft.receivedOn > todayISO() ? t('payments.errors.futureReceived') : undefined,
    };
  }

  const submit = () => {
    const value = parseAmount(amount);
    const next = rulesOf(form);
    setProblems(next);
    if (next.name || next.amount || next.dueDate || next.receivedOn) return;
    if (saved) update.mutate({ id: saved.id, patch: { name: name.trim(), amount: value, dueDate, receivedOn: receivedOn || null, note } });
    else create.mutate({ projectId, name: name.trim(), amount: value, dueDate, receivedOn: receivedOn || null, note });
  };
  const otherBusy = create.isPending || update.isPending || mark.isPending || remove.isPending;
  // The Daftra part (the Daftra link, owner 2026-10-26): it shows only in a copy with Daftra and only to the holder of payment.daftraLink, plus the
  // read-only lines of a linked payment for everyone who sees payments. Its Link button, inside the part, is the one main button while an invoice waits to be linked.
  const daftra = useDaftraPart({ projectId, row, busy: otherBusy, onDone: () => { stepSaved(); close(); } });
  const busy = otherBusy || daftra.pending;
  const footer = (
    <>
      {saved && mayChange && <Button variant="destructive" disabled={busy} onClick={() => remove.mutate({ id: saved.id })}>{t('common.delete')}</Button>}
      {/* While an invoice is linked, Daftra sets Received when it is paid, so the button stays away. */}
      {saved && !saved.receivedOn && !saved.daftra && mayReceive && <Button disabled={busy} onClick={() => mark.mutate({ id: saved.id })}>{t('payments.markReceived')}</Button>}
      <Button variant="plain" onClick={close}>{mayEdit ? t('common.cancel') : t('common.close')}</Button>
      {mayEdit && <Button variant={daftra.linkShown ? 'secondary' : 'primary'} disabled={busy} onClick={submit}>{t('common.save')}</Button>}
    </>
  );
  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose(); }} title={saved ? t('payments.editTitle') : t('payments.addTitle')} footer={footer}>
      <>
        <form
          noValidate
          className="flex flex-col gap-4 pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <TextField id="payment-name" label={t('payments.name')} dir="auto" maxLength={120} readOnly={!mayEdit} value={name} error={problem('name', t('payments.errors.name'))} onChange={(event) => set({ name: event.target.value })} />
          <TextField id="payment-amount" label={t('payments.amountField')} inputMode="decimal" dir="ltr" readOnly={!mayEdit} value={amount} error={problem('amount', t('payments.errors.amount'))} onChange={(event) => set({ amount: event.target.value })} />
          {/* The due date is needed, so it changes but never goes empty: no clear control. The received date is empty until the money comes. */}
          <div className="grid grid-cols-2 gap-4">
            <DateField id="payment-due" label={t('payments.dueDate')} clearable={false} disabled={!mayEdit} value={dueDate} error={problem('dueDate', t('payments.errors.dueDate'))} onChange={(day) => set({ dueDate: day })} />
            <DateField id="payment-received" label={t('payments.receivedOn')} max={todayISO()} disabled={!mayEdit} value={receivedOn} error={problem('receivedOn', t('payments.errors.futureReceived'))} onChange={(day) => set({ receivedOn: day })} />
          </div>
          <TextArea id="payment-note" label={t('payments.note')} dir="auto" maxLength={500} readOnly={!mayEdit} value={note} onChange={(event) => set({ note: event.target.value })} />
        </form>
        {/* Outside the form, so Enter in the search field never saves the payment. */}
        {daftra.part}
      </>
    </Sheet>
  );
}
