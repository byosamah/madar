import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/errors';
import type { CustomRole, OfficeRight } from '../../../api/contract/entities';
import { OFFICE_RIGHTS } from '../../../api/permissions';
import { useUndoable } from '../../../app/actions';
import { errorMessage, fieldError } from '../../../app/errors';
import { useLang } from '../../../app/lang';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';
import { Switch } from '../../../components/Switch';
import { listFormat } from '../../../lib/dates';

/** The word key of each right, without dots: its name is roles.rights.<key>.label and its line roles.rights.<key>.hint. */
export const RIGHT_KEYS: Readonly<Record<OfficeRight, string>> = {
  'people.manage': 'peopleManage',
  'payment.manage': 'paymentManage',
  'project.delete': 'projectDelete',
  'project.editCode': 'projectEditCode',
  'clients.manage': 'clientsManage',
  'templates.manageAll': 'templatesManageAll',
  'report.office': 'reportOffice',
};

/** The rights with one of them switched on or off. The result keeps the order of the rights list. */
export function withRight(rights: readonly OfficeRight[], right: OfficeRight, on: boolean): OfficeRight[] {
  return OFFICE_RIGHTS.filter((item) => (item === right ? on : rights.includes(item)));
}

/** One right: a switch with its name and one short line under it. */
export function RightSwitch({ id, right, checked, onChange }: { id: string; right: OfficeRight; checked: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation();
  const key = RIGHT_KEYS[right];
  return <Switch id={id} label={t(`roles.rights.${key}.label`)} description={t(`roles.rights.${key}.hint`)} checked={checked} onChange={onChange} />;
}

/** The role that a sheet shows: a new role, a built-in role (its rights only), or a custom role (its names, rights and delete). */
export type RoleTarget =
  | { kind: 'new' }
  | { kind: 'built-in'; key: 'management' | 'accounting' | 'member'; name: string; rights: readonly OfficeRight[] }
  | { kind: 'custom'; role: CustomRole };

/** A person who holds the role, and a role that the people of a deleted role can take. */
export type RoleHolder = { id: string; name: string };
export type RoleChoice = { value: string; label: string };

type Form = { name: string; nameAr: string; rights: OfficeRight[] };
const EMPTY: Form = { name: '', nameAr: '', rights: [] };

/**
 * The sheet of one role (owner, 2026-10-18, fbk_014; ADM-12 to ADM-14): the people who hold it at the top, then its names (a custom
 * role), the seven rights, and one main button, Save role, with Cancel. The switches live only here and save with the button, so the
 * page changes the rights of a role by one deliberate step. A custom role also has Delete role. A role that people hold asks one
 * question first: it names the people and the role they take, and "Delete and move" does both in one story, so one Undo brings back the
 * role and the roles of the people. Only the Admin sees this sheet.
 */
export function RoleSheet({ open, onOpenChange, target, holders, moveChoices }: {
  open: boolean; onOpenChange: (open: boolean) => void; target: RoleTarget | null; holders: RoleHolder[]; moveChoices: RoleChoice[];
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const [form, setForm] = useState<Form>(EMPTY);
  const [asking, setAsking] = useState(false);
  const [moveTo, setMoveTo] = useState('member');
  const close = () => onOpenChange(false);
  // A refused value stays on the sheet (the refusal is not a toast); a network failure still shows its toast.
  const refused = (error: unknown) => error instanceof ApiError && error.code === 'invalid_input';
  const create = useUndoable('roles.create', { message: () => t('roles.saved'), onSuccess: close, onRefused: refused });
  const update = useUndoable('roles.update', { message: () => t('roles.saved'), onSuccess: close, onRefused: refused });
  const remove = useUndoable('roles.delete', {
    message: () => (holders.length > 0 ? t('roles.deletedMoved', { count: holders.length }) : t('roles.deleted')),
    onSuccess: close,
    onRefused: refused,
  });
  const key = target?.kind === 'custom' ? target.role.id : target?.kind === 'built-in' ? target.key : 'new';
  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    remove.reset();
    setAsking(false);
    setMoveTo(moveChoices[0]?.value ?? 'member');
    setForm(
      target?.kind === 'custom' ? { name: target.role.name, nameAr: target.role.nameAr, rights: [...target.role.rights] }
        : target?.kind === 'built-in' ? { ...EMPTY, rights: [...target.rights] } : EMPTY,
    );
    // The form starts fresh each time it opens; an old refusal must not stay under a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);
  const named = target?.kind !== 'built-in';
  const error = target?.kind === 'new' || target === null ? create.error : update.error;
  const errorFor = (field: string) => fieldError(error, field, t, '') || undefined;
  const name = form.name.trim();
  const nameAr = form.nameAr.trim();
  const valid = !named || (name.length > 0 && nameAr.length > 0);
  const busy = create.isPending || update.isPending || remove.isPending;
  const submit = () => {
    if (target?.kind === 'custom') update.mutate({ role: target.role.id, name, nameAr, rights: form.rights });
    else if (target?.kind === 'built-in') update.mutate({ role: target.key, rights: form.rights });
    else create.mutate({ name, nameAr, rights: form.rights });
  };
  const title = target?.kind === 'custom' ? (lang === 'ar' ? target.role.nameAr : target.role.name)
    : target?.kind === 'built-in' ? target.name : t('roles.sheet.newTitle');
  const customId = target?.kind === 'custom' ? target.role.id : null;
  const removeMessage = remove.error ? fieldError(remove.error, 'moveTo', t, '') || fieldError(remove.error, 'id', t, '') || errorMessage(remove.error, t) : '';
  const names = listFormat(lang).format(holders.map((holder) => holder.name));
  const startDelete = () => {
    if (customId === null) return;
    if (holders.length > 0) setAsking(true);
    else remove.mutate({ id: customId });
  };

  if (asking && customId !== null) {
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={t('roles.sheet.moveTitle', { name: title })}
        footer={(
          <>
            <Button onClick={() => setAsking(false)}>{t('roles.sheet.back')}</Button>
            <Button variant="destructive" disabled={busy} onClick={() => remove.mutate({ id: customId, moveTo: moveTo as never })}>{t('roles.sheet.deleteMove')}</Button>
          </>
        )}
      >
        <div className="flex flex-col gap-4 pt-1">
          <p dir="auto" className="text-subheadline text-ink-2">{t('roles.sheet.moveBody', { count: holders.length, names })}</p>
          <SelectField id="role-move-to" label={t('roles.sheet.moveTo')} value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
            {moveChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </SelectField>
          {removeMessage && <p role="alert" className="text-footnote text-late">{removeMessage}</p>}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={(
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>{t('roles.sheet.save')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        {target?.kind !== 'new' && (
          <section aria-labelledby="role-holders" className="flex flex-col gap-1">
            <h3 id="role-holders" className="field-label">{t('roles.sheet.holders')}</h3>
            {holders.length === 0
              ? <p className="text-subheadline text-ink-2">{t('roles.sheet.nobody')}</p>
              : <p dir="auto" className="text-subheadline text-ink">{names}</p>}
          </section>
        )}
        {named && (
          <>
            <TextField
              id="role-name" label={t('roles.sheet.name')} required value={form.name} dir="auto" autoComplete="off" error={errorFor('name')}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <TextField
              id="role-name-ar" label={t('roles.sheet.nameAr')} required value={form.nameAr} dir="auto" lang="ar" autoComplete="off" error={errorFor('nameAr')}
              onChange={(event) => setForm((current) => ({ ...current, nameAr: event.target.value }))}
            />
          </>
        )}
        <div className="flex flex-col">
          <p className="text-footnote font-medium text-label-2">{t('roles.sheet.rights')}</p>
          {OFFICE_RIGHTS.map((right) => (
            <RightSwitch
              key={right} id={`role-form-${RIGHT_KEYS[right]}`} right={right} checked={form.rights.includes(right)}
              onChange={(on) => setForm((current) => ({ ...current, rights: withRight(current.rights, right, on) }))}
            />
          ))}
        </div>
        {customId !== null && (
          <div className="flex flex-col gap-2">
            <Button variant="destructive" disabled={busy} onClick={startDelete}>{t('roles.sheet.delete')}</Button>
            {removeMessage && <p role="alert" className="text-footnote text-late">{removeMessage}</p>}
          </div>
        )}
      </div>
    </Sheet>
  );
}
