import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { XIcon } from '../../components/icons/animated/x';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, User } from '../../api/contract/entities';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { SelectField, TextArea, TextField } from '../../components/Fields';
import { IconButton } from '../../components/IconButton';
import { StageTemplatePicker } from './StageTemplatePicker';
import { validateProjectForm, type ProjectFormErrors, type ProjectFormValues } from './projectForm';

const CHECKED: (keyof ProjectFormErrors)[] = ['name', 'area', 'targetEndDate', 'stages'];

/** Form state that shows an error only after the person leaves the field, or on submit (spec 4.4). */
export function useProjectForm(initial: ProjectFormValues) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const all = validateProjectForm(values);
  const errors = Object.fromEntries(Object.entries(all).filter(([field]) => touched.has(field))) as ProjectFormErrors;
  return {
    values,
    errors,
    set<K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) {
      setValues((current) => ({ ...current, [key]: value }));
    },
    touch(field: keyof ProjectFormErrors) {
      setTouched((current) => new Set(current).add(field));
    },
    /** Shows every error. True when the form can go. */
    check(): boolean {
      setTouched(new Set(CHECKED));
      return Object.keys(all).length === 0;
    },
    reset(next: ProjectFormValues) {
      setValues(next);
      setTouched(new Set());
    },
  };
}
export type ProjectForm = ReturnType<typeof useProjectForm>;

function ClientPicker({ value, onChange, clients }: { value: string; onChange: (id: string) => void; clients: Client[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const empty = { name: '', contactName: '', phone: '', email: '' };
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(empty);
  const create = useAction('clients.create', {
    onSuccess: (client) => {
      onChange(client.id);
      setAdding(false);
      setDraft(empty);
      toast.show({ message: t('projectForm.clientAdded') });
    },
  });
  const field = (key: keyof typeof empty) => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value })),
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <SelectField id="project-client" className="flex-1" label={t('projectForm.client')} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{t('projectForm.noClient')}</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </SelectField>
        <Button aria-expanded={adding} onClick={() => setAdding((open) => !open)}>{t('projectForm.newClient')}</Button>
      </div>
      {adding && (
        <div className="grid gap-3 rounded-2xl bg-fill p-3 sm:grid-cols-2">
          <TextField id="client-name" label={t('projectForm.clientName')} dir="auto" {...field('name')} />
          <TextField id="client-contact" label={t('projectForm.contactName')} dir="auto" {...field('contactName')} />
          <TextField id="client-phone" type="tel" dir="ltr" label={t('projectForm.phone')} {...field('phone')} />
          <TextField id="client-email" type="email" dir="ltr" label={t('projectForm.email')} {...field('email')} />
          <Button
            variant="primary"
            className="sm:col-span-2"
            disabled={!draft.name.trim() || create.isPending}
            onClick={() => create.mutate({ ...draft, name: draft.name.trim() })}
          >
            {t('projectForm.addClient')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function StageList({
  stages, onChange, onBlur, error,
}: { stages: ProjectFormValues['stages']; onChange: (stages: ProjectFormValues['stages']) => void; onBlur: () => void; error?: string }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-footnote text-label-2">{t('projectForm.stages')}</legend>
      <ol className="flex flex-col gap-2">
        {stages.map((stage, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              aria-label={t('projectForm.stageName', { n: i + 1 })}
              value={stage.name}
              dir="auto"
              onChange={(event) => onChange(stages.map((s, j) => (j === i ? { ...s, name: event.target.value } : s)))}
              onBlur={onBlur}
              className="field min-w-0 flex-1"
            />
            <IconButton label={t('projectForm.removeStage', { name: stage.name || String(i + 1) })} onClick={() => onChange(stages.filter((_, j) => j !== i))}>
              <AnimatedIcon icon={XIcon} size={16} aria-hidden />
            </IconButton>
          </li>
        ))}
      </ol>
      <Button className="self-start" onClick={() => onChange([...stages, { name: '' }])}>
        <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
        {t('projectForm.addStage')}
      </Button>
      {error && <p role="alert" className="text-footnote text-late">{error}</p>}
    </fieldset>
  );
}

function TeamPicker({ people, value, onChange }: { people: User[]; value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="pb-1 text-footnote text-label-2">{t('projectForm.team')}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {people.map((person) => (
          <label key={person.id} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-fill">
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
              checked={value.includes(person.id)}
              onChange={(event) => onChange(event.target.checked ? [...value, person.id] : value.filter((id) => id !== person.id))}
            />
            <Avatar user={person} size={28} />
            <span className="min-w-0 flex-1 truncate">{person.name}</span>
            <span className="text-footnote text-label-2">{person.discipline}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The project fields of spec 4.4. "edit" leaves out the leader and the team, which the header and the Team tab change. */
export function ProjectFields({ form, mode }: { form: ProjectForm; mode: 'create' | 'edit' }) {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
  const meId = session.data?.authority.id;
  const people = (users.data ?? []).filter((user) => user.kind === 'human' && user.id !== meId);
  const { values, errors, set, touch } = form;
  const error = (field: keyof ProjectFormErrors) => (errors[field] ? t(errors[field] as string) : undefined);
  return (
    <div className="flex flex-col gap-4">
      <TextField
        id="project-name"
        label={t('projectForm.name')}
        value={values.name}
        dir="auto"
        autoComplete="off"
        required
        onChange={(event) => set('name', event.target.value)}
        onBlur={() => touch('name')}
        error={error('name')}
      />
      <ClientPicker value={values.clientId} onChange={(id) => set('clientId', id)} clients={clients.data ?? []} />
      {mode === 'create' && (
        <SelectField id="project-leader" label={t('projectForm.leader')} value={values.leader} onChange={(event) => set('leader', event.target.value)}>
          <option value="me">{t('projectForm.leaderMe')}</option>
          {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          <option value="none">{t('projectForm.leaderNone')}</option>
        </SelectField>
      )}
      <TextField
        id="project-location"
        label={t('projectForm.location')}
        hint={t('projectForm.locationHint')}
        value={values.location}
        dir="auto"
        onChange={(event) => set('location', event.target.value)}
      />
      <TextField
        id="project-area"
        label={t('projectForm.area')}
        inputMode="decimal"
        value={values.area}
        onChange={(event) => set('area', event.target.value)}
        onBlur={() => touch('area')}
        error={error('area')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="project-contract-start" type="date" label={t('projectForm.contractStartDate')} value={values.contractStartDate} onChange={(event) => set('contractStartDate', event.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="project-start" type="date" label={t('projectForm.startDate')} value={values.startDate} onChange={(event) => set('startDate', event.target.value)} />
        <TextField
          id="project-end"
          type="date"
          label={t('projectForm.endDate')}
          value={values.targetEndDate}
          onChange={(event) => set('targetEndDate', event.target.value)}
          onBlur={() => touch('targetEndDate')}
          error={error('targetEndDate')}
        />
      </div>
      <StageTemplatePicker stages={values.stages} onChange={(stages) => set('stages', stages)} mode={mode} />
      <StageList stages={values.stages} onChange={(stages) => set('stages', stages)} onBlur={() => touch('stages')} error={error('stages')} />
      {mode === 'create' && <TeamPicker people={people} value={values.teamIds} onChange={(ids) => set('teamIds', ids)} />}
      <TextField
        id="project-folder"
        label={t('projectForm.modelFolder')}
        hint={t('projectForm.modelFolderHint')}
        value={values.modelFolderPath}
        dir="ltr"
        onChange={(event) => set('modelFolderPath', event.target.value)}
      />
      <TextArea id="project-description" label={t('projectForm.description')} value={values.description} dir="auto" onChange={(event) => set('description', event.target.value)} />
    </div>
  );
}
