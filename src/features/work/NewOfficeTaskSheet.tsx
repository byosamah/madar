import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useByPersonName, usePersonName } from '../../app/personName';
import { useSheetSteps } from '../../app/insight/useSheetSteps';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { useRight } from '../../app/useRight';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { SelectField, TextField } from '../../components/Fields';
import { Sheet } from '../../components/Sheet';
import { openTask } from '../../lib/params';

/**
 * "New office task" on the Tasks page (owner, 2026-10-06): a task of no project. Three fields only, for one next step: the
 * title, the lead (the person who adds it, unless they pick another person) and the due date. Helpers, the checklist, files and the
 * rest live in the task panel. The line under the fields says who sees the task.
 */
export function NewOfficeTaskSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const [, setParams] = useSearchParams();
  const me = useCall('session.get', {}).data?.authority.id ?? '';
  const users = useCall('users.list', {});
  // Naming another person as the lead needs task.assign (role rights version 2). Without it the person leads the to-do.
  const mayAssign = useRight('task.assign');
  const people = (users.data ?? []).filter((user) => user.kind === 'human' && user.active && (mayAssign || user.id === me)).sort(byName);
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  // '' is no date, as DateField gives it.
  const [due, setDue] = useState('');
  const stepSaved = useSheetSteps('newOfficeTask', open);
  const create = useAction('tasks.create', {
    onSuccess: (detail) => {
      stepSaved();
      onOpenChange(false);
      toast.show({
        message: t('newTask.created'),
        action: { label: t('newTask.open'), run: () => setParams((current) => openTask(current, detail.task.id)), isUndo: false },
      });
    },
  });

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setLead('');
    setDue('');
  }, [open]);

  const leadId = lead || me;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('office.new')}
      footer={(
        <Button
          variant="primary"
          disabled={!title.trim() || !leadId || create.isPending}
          onClick={() => create.mutate({ title: title.trim(), ownerId: leadId, dueDate: due || null })}
        >
          {t('office.add')}
        </Button>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <TextField id="office-task-title" label={t('newTask.name')} required value={title} dir="auto" onChange={(event) => setTitle(event.target.value)} />
        <SelectField id="office-task-lead" label={t('taskSheet.owner')} value={leadId} onChange={(event) => setLead(event.target.value)}>
          {people.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}</option>)}
        </SelectField>
        <DateField id="office-task-due" label={t('taskSheet.dueDate')} value={due} onChange={setDue} />
        <p className="text-footnote text-label-2">{t('office.private')}</p>
      </div>
    </Sheet>
  );
}
