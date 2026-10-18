import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../../api/errors';
import type { CustomRole, OfficeRight } from '../../../api/contract/entities';
import { OFFICE_RIGHTS } from '../../../api/permissions';
import { useUndoable } from '../../../app/actions';
import { errorMessage, fieldError } from '../../../app/errors';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';
import { Switch } from '../../../components/Switch';

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

type Form = { name: string; nameAr: string; rights: OfficeRight[] };
const EMPTY: Form = { name: '', nameAr: '', rights: [] };

/**
 * The sheet of one custom role: a new role (role null), or the change and the delete of a role (owner, 2026-10-18, fbk_014). Only the
 * Admin sees it. Each save and each delete has an Undo. A refusal of a field shows under the field; a role that people hold shows its
 * count, and the sheet stays open.
 */
export function RoleSheet({ open, onOpenChange, role }: { open: boolean; onOpenChange: (open: boolean) => void; role: CustomRole | null }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Form>(EMPTY);
  const close = () => onOpenChange(false);
  // A refused value stays on the sheet (the refusal is not a toast); a network failure still shows its toast.
  const refused = (error: unknown) => error instanceof ApiError && error.code === 'invalid_input';
  const create = useUndoable('roles.create', { message: () => t('roles.saved'), onSuccess: close, onRefused: refused });
  const update = useUndoable('roles.update', { message: () => t('roles.saved'), onSuccess: close, onRefused: refused });
  const remove = useUndoable('roles.delete', { message: () => t('roles.deleted'), onSuccess: close, onRefused: refused });
  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    remove.reset();
    setForm(role ? { name: role.name, nameAr: role.nameAr, rights: [...role.rights] } : EMPTY);
    // The form starts fresh each time it opens; an old refusal must not stay under a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, role]);
  const error = role ? update.error : create.error;
  const errorFor = (field: string) => fieldError(error, field, t, '') || undefined;
  const name = form.name.trim();
  const nameAr = form.nameAr.trim();
  const valid = name.length > 0 && nameAr.length > 0;
  const submit = () => {
    if (role) update.mutate({ role: role.id, name, nameAr, rights: form.rights });
    else create.mutate({ name, nameAr, rights: form.rights });
  };
  // The count of people who hold the role comes with the refusal, so the sheet can say how many (role_in_use).
  const inUse = remove.error instanceof ApiError && remove.error.details.reason === 'role_in_use'
    ? t('roles.inUse', { count: Number(remove.error.details.count) })
    : remove.error ? errorMessage(remove.error, t) : null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={role ? t('roles.sheet.editTitle') : t('roles.sheet.newTitle')}
      footer={<Button variant="primary" disabled={!valid || create.isPending || update.isPending || remove.isPending} onClick={submit}>{t('roles.sheet.save')}</Button>}
    >
      <div className="flex flex-col gap-4 pt-1">
        <TextField
          id="role-name" label={t('roles.sheet.name')} required value={form.name} dir="auto" error={errorFor('name')}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />
        <TextField
          id="role-name-ar" label={t('roles.sheet.nameAr')} required value={form.nameAr} dir="auto" lang="ar" error={errorFor('nameAr')}
          onChange={(event) => setForm((current) => ({ ...current, nameAr: event.target.value }))}
        />
        <div className="flex flex-col">
          <p className="text-footnote font-medium text-label-2">{t('roles.sheet.rights')}</p>
          {OFFICE_RIGHTS.map((right) => (
            <RightSwitch
              key={right} id={`role-form-${RIGHT_KEYS[right]}`} right={right} checked={form.rights.includes(right)}
              onChange={(on) => setForm((current) => ({ ...current, rights: withRight(current.rights, right, on) }))}
            />
          ))}
        </div>
        {role && (
          <div className="flex flex-col gap-2">
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate({ id: role.id })}>{t('roles.sheet.delete')}</Button>
            {inUse && <p role="alert" className="text-footnote text-red-text">{inUse}</p>}
          </div>
        )}
      </div>
    </Sheet>
  );
}
