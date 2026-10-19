import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { XIcon } from '../../components/icons/animated/x';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, GeoPoint, ProjectTemplate, SubCompany, User } from '../../api/contract/entities';
import { useLang } from '../../app/lang';
import { useByPersonName, usePersonName } from '../../app/personName';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { SelectField, TextArea, TextField } from '../../components/Fields';
import { Sheet } from '../../components/Sheet';
import { IconButton } from '../../components/IconButton';
import { clientName } from '../../lib/clientName';
import { ClientForm, useClientForm } from './ClientForm';
import { clientInput, emptyClientDraft } from './clientRules';
import { FREE_CODE_MAX } from '../../lib/projectCode';
import { CODE_FIELDS, isCodeWarning, upperCodeHead } from './codeForm';
import { CodeAnywayTick, ProjectCodeFields } from './ProjectCodeFields';
import { TemplateDetails, TemplatePicker } from './TemplateUse';
import { PinPicker, coordinatesOf } from '../map/PinPicker';
import { validateProjectForm, type ProjectFormErrors, type ProjectFormRules, type ProjectFormValues } from './projectForm';

const CHECKED: (keyof ProjectFormErrors)[] = ['name', 'area', 'startDate', 'targetEndDate', 'stages', 'code', 'template', 'subCompanyId', ...CODE_FIELDS];

/**
 * Form state that shows an error only after the person changes a field and leaves it, or on submit (spec 4.4). A field that the
 * focus only passes through stays quiet: a message on that blur moved New client down during the press (2026-10-05).
 */
export function useProjectForm(initial: ProjectFormValues, rules: ProjectFormRules = {}) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const edited = useRef(new Set<string>());
  const all = validateProjectForm(values, rules);
  const errors = Object.fromEntries(Object.entries(all).filter(([field]) => touched.has(field))) as ProjectFormErrors;
  return {
    values,
    errors,
    set<K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) {
      edited.current.add(key);
      setValues((current) => ({ ...current, [key]: value }));
    },
    /** Each error field has the name of its value, so a field shows its message on blur only after a change. */
    touch(field: keyof ProjectFormErrors) {
      if (!edited.current.has(field)) return;
      setTouched((current) => new Set(current).add(field));
    },
    /** Shows every error. True when the form can go. */
    check(): boolean {
      setTouched(new Set(CHECKED));
      return Object.keys(all).length === 0;
    },
    reset(next: ProjectFormValues) {
      edited.current = new Set();
      setValues(next);
      setTouched(new Set());
    },
  };
}
export type ProjectForm = ReturnType<typeof useProjectForm>;

/** The client select, and "New client" with the one client form (owner, 2026-10-05, items 1 and 3). */
function ClientPicker({ value, onChange, clients }: { value: string; onChange: (id: string) => void; clients: Client[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const lang = useLang();
  const [adding, setAdding] = useState(false);
  const form = useClientForm(emptyClientDraft());
  const create = useAction('clients.create', {
    onSuccess: (client) => {
      onChange(client.id);
      setAdding(false);
      form.reset(emptyClientDraft());
      toast.show({ message: t('projectForm.clientAdded') });
    },
  });
  // A press on Add shows every message first. The client goes only when every rule holds.
  const add = () => {
    if (create.isPending || !form.check()) return;
    create.mutate(clientInput(form.values, lang));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <SelectField id="project-client" className="flex-1" label={t('projectForm.client')} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{t('projectForm.noClient')}</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{clientName(client, lang)}</option>)}
        </SelectField>
        <Button aria-expanded={adding} onClick={() => setAdding((open) => !open)}>{t('projectForm.newClient')}</Button>
      </div>
      {adding && (
        // An outline, not a fill: the grey fields on a grey box looked faint (2026-10-05). The same look as the template cards.
        <div role="group" aria-label={t('projectForm.newClient')} className="flex flex-col gap-3 rounded-2xl border border-separator p-3">
          <ClientForm form={form} idPrefix="client" clients={clients} onEnter={add} />
          {/* A plain button: Create project stays the one main button of the sheet (calm rule, 2026-10-05). */}
          <Button className="sm:self-start" disabled={create.isPending} onClick={add}>
            {t('projectForm.addClient')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The sub-company select (fbk_007). It shows only when the office has sub-companies. A new project needs one, so its first choice
 * names the step; an edit may leave the project with none.
 */
function SubCompanyPicker({ value, onChange, subCompanies, required, error }: {
  value: string; onChange: (id: string) => void; subCompanies: SubCompany[]; required: boolean; error?: string;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <SelectField
      id="project-sub-company"
      label={t('subCompanies.label')}
      required={required}
      error={error}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{required ? t('subCompanies.choose') : t('subCompanies.none')}</option>
      {subCompanies.map((sub) => <option key={sub.id} value={sub.id}>{lang === 'ar' ? sub.nameAr : sub.name}</option>)}
    </SelectField>
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
              autoComplete="off"
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
  const nameOf = usePersonName();
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
            <span className="min-w-0 flex-1 truncate">{nameOf(person)}</span>
            <span className="text-footnote text-label-2">{person.discipline}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The project fields of spec 4.4. "edit" leaves out the leader and the team, which the header and the Team tab change.
 * "create" adds the Project code group (owner, 2026-10-05). "editCode" gives the Admin the code field in the edit form.
 * "create" also offers the project templates (owner, 2026-10-05, item 6a): a chosen template gives the stages, so its part
 * takes the place of the stage list, and the start date becomes required.
 */
export function ProjectFields({
  form, mode, editCode = false, templates = [],
}: { form: ProjectForm; mode: 'create' | 'edit'; editCode?: boolean; templates?: readonly ProjectTemplate[] }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const session = useCall('session.get', {});
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
  const subCompanies = useCall('subCompanies.list', {});
  const meId = session.data?.authority.id;
  const humans = (users.data ?? []).filter((user) => user.kind === 'human');
  const people = humans.filter((user) => user.id !== meId).sort(byName);
  const { values, errors, set, touch } = form;
  const template = mode === 'create' && values.templateId ? templates.find((t) => t.id === values.templateId) : undefined;
  const error = (field: keyof ProjectFormErrors) => (errors[field] ? t(errors[field] as string, { example: '260902AZT-RES-Villa' }) : undefined);
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
      {mode === 'edit' && editCode && (
        <div className="flex flex-col gap-1">
          <TextField
            id="project-code"
            label={t('projectCode.group')}
            hint={t('projectCode.editHint')}
            required
            dir="ltr"
            autoComplete="off"
            maxLength={FREE_CODE_MAX}
            value={values.code}
            onChange={(event) => {
              set('code', upperCodeHead(event.target.value));
              set('codeAnyway', false);
            }}
            onBlur={() => touch('code')}
            error={error('code')}
          />
          {(isCodeWarning(errors.code) || values.codeAnyway) && (
            <CodeAnywayTick id="project-code-anyway" checked={values.codeAnyway} onChange={(checked) => set('codeAnyway', checked)} />
          )}
        </div>
      )}
      <ClientPicker value={values.clientId} onChange={(id) => set('clientId', id)} clients={clients.data ?? []} />
      {(subCompanies.data ?? []).length > 0 && (
        <SubCompanyPicker
          value={values.subCompanyId}
          onChange={(id) => set('subCompanyId', id)}
          subCompanies={subCompanies.data ?? []}
          required={mode === 'create'}
          error={error('subCompanyId')}
        />
      )}
      {mode === 'create' && <ProjectCodeFields form={form} clients={clients.data ?? []} />}
      {mode === 'create' && (
        <SelectField id="project-leader" label={t('projectForm.leader')} value={values.leader} onChange={(event) => set('leader', event.target.value)}>
          <option value="me">{t('projectForm.leaderMe')}</option>
          {people.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}</option>)}
          <option value="none">{t('projectForm.leaderNone')}</option>
        </SelectField>
      )}
      <TextField
        id="project-location"
        label={t('projectForm.location')}
        hint={t('projectForm.locationHint')}
        value={values.location}
        dir="auto"
        autoComplete="off"
        onChange={(event) => set('location', event.target.value)}
      />
      <PinLine value={values.geo} onChange={(geo) => set('geo', geo)} />
      <TextField
        id="project-area"
        label={t('projectForm.area')}
        inputMode="decimal"
        autoComplete="off"
        value={values.area}
        onChange={(event) => set('area', event.target.value)}
        onBlur={() => touch('area')}
        error={error('area')}
      />
      {/* The dates sit in two equal columns at every width, so the contract start lines up with the start date below. */}
      <div className="grid grid-cols-2 gap-4">
        <DateField id="project-contract-start" label={t('projectForm.contractStartDate')} value={values.contractStartDate} onChange={(day) => set('contractStartDate', day)} />
      </div>
      {mode === 'create' && templates.length > 0 && <TemplatePicker form={form} templates={templates} />}
      <div className="grid grid-cols-2 gap-4">
        <DateField
          id="project-start"
          label={t('projectForm.startDate')}
          required={template !== undefined}
          value={values.startDate}
          onChange={(day) => set('startDate', day)}
          onBlur={() => touch('startDate')}
          error={template ? error('startDate') : undefined}
        />
        <DateField
          id="project-end"
          label={t('projectForm.endDate')}
          hint={template ? t('templateUse.endHint') : undefined}
          // The plan line (TemplateDetails) says why the locked tasks do not fit. The field only carries the mark, so the focus comes here.
          {...(errors.template ? { 'aria-invalid': true, 'aria-describedby': 'project-end-hint template-plan-line' } : {})}
          value={values.targetEndDate}
          min={values.startDate || undefined}
          onChange={(day) => set('targetEndDate', day)}
          onBlur={() => touch('targetEndDate')}
          error={error('targetEndDate')}
        />
      </div>
      {template
        ? <TemplateDetails form={form} template={template} people={humans} />
        : <StageList stages={values.stages} onChange={(stages) => set('stages', stages)} onBlur={() => touch('stages')} error={error('stages')} />}
      {mode === 'create' && <TeamPicker people={people} value={values.teamIds} onChange={(ids) => set('teamIds', ids)} />}
      <TextField
        id="project-folder"
        label={t('projectForm.modelFolder')}
        hint={t('projectForm.modelFolderHint')}
        value={values.modelFolderPath}
        dir="ltr"
        autoComplete="off"
        onChange={(event) => set('modelFolderPath', event.target.value)}
      />
      <TextArea id="project-description" label={t('projectForm.description')} autoComplete="off" value={values.description} dir="auto" onChange={(event) => set('description', event.target.value)} />
    </div>
  );
}

/**
 * The pin line under Location (owner, 2026-10-18, fbk_017): the state of the pin, then "Set pin" (or "Change"), and "Remove" with a
 * pin. "Set pin" opens the pin picker in a sheet. A change waits for the form's Save, as every other field does.
 */
function PinLine({ value, onChange }: { value: GeoPoint | null; onChange: (point: GeoPoint | null) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-subheadline text-ink-2">{t('map.pin.label')}</span>
      <span dir="auto" className="text-subheadline">{value ? t('map.pin.value', coordinatesOf(value)) : t('map.pin.none')}</span>
      <Button onClick={() => setOpen(true)}>{value ? t('map.pin.change') : t('map.pin.set')}</Button>
      {value && <Button onClick={() => onChange(null)}>{t('map.pin.remove')}</Button>}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('map.pinSheet.title')}
        footer={<Button variant="primary" onClick={() => setOpen(false)}>{t('map.pinSheet.done')}</Button>}
      >
        <PinPicker value={value} onChange={onChange} />
      </Sheet>
    </div>
  );
}
