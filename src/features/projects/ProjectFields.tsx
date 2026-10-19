import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { XIcon } from '../../components/icons/animated/x';
import { useEffect, useRef, useState } from 'react';
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
import { SegmentedControl } from '../../components/SegmentedControl';
import { SubCompanyLogo } from '../../components/SubCompanyLogo';
import { IconButton } from '../../components/IconButton';
import { clientName } from '../../lib/clientName';
import { ClientForm, useClientForm } from './ClientForm';
import { clientInput, emptyClientDraft } from './clientRules';
import { FREE_CODE_MAX } from '../../lib/projectCode';
import { CODE_FIELDS, isCodeWarning, upperCodeHead } from './codeForm';
import { CodeAnywayTick, ProjectCodeFields } from './ProjectCodeFields';
import { TemplateDetails, TemplatePicker } from './TemplateUse';
import { PinSheet } from '../map/PinSheet';
import { googleMapsUrl } from '../../lib/geo';
import { roleChoice } from './templateForm';
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
    /** True when the person changed the field since the form opened (or since the last reset). */
    edited(key: keyof ProjectFormValues): boolean {
      return edited.current.has(key);
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

/** With this many sub-companies or fewer, the choice is one row of logos. A longer list keeps a select. */
const MAX_LOGO_CHOICES = 5;

/**
 * The sub-company choice (fbk_007, PRJ-17). It shows only when the office has sub-companies. A few of them show as one row, each with
 * its logo and its name, so one tap picks. A long list keeps the select. A new project needs one. An edit may leave a project with none,
 * but a project that has one can change it, never clear it.
 */
function SubCompanyPicker({ value, onChange, subCompanies, required, error }: {
  value: string; onChange: (id: string) => void; subCompanies: SubCompany[]; required: boolean; error?: string;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = (sub: SubCompany) => (lang === 'ar' ? sub.nameAr : sub.name);
  if (subCompanies.length > MAX_LOGO_CHOICES) {
    return (
      <SelectField id="project-sub-company" label={t('subCompanies.label')} required={required} error={error} value={value} onChange={(event) => onChange(event.target.value)}>
        {(!required || value === '') && <option value="">{required ? t('subCompanies.choose') : t('subCompanies.none')}</option>}
        {subCompanies.map((sub) => <option key={sub.id} value={sub.id}>{nameOf(sub)}</option>)}
      </SelectField>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline gap-0.5">
        <span className="field-label">{t('subCompanies.label')}</span>
        {required && <span aria-hidden="true" className="field-label">*</span>}
      </div>
      <SegmentedControl
        label={t('subCompanies.label')}
        value={value}
        onChange={onChange}
        options={subCompanies.map((sub) => ({ value: sub.id, label: nameOf(sub), icon: <SubCompanyLogo subCompanyId={sub.id} size={22} /> }))}
      />
      {error && <p role="alert" className="text-footnote text-late">{error}</p>}
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

/**
 * The team ticks. A person who takes a role of the chosen template is ticked and locked with a small note, "Architect in the template"
 * (ADM-20): the server adds that person to the team, so the list says so.
 */
function TeamPicker({ people, value, onChange, locked }: { people: User[]; value: string[]; onChange: (ids: string[]) => void; locked: ReadonlyMap<string, string> }) {
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
              checked={locked.has(person.id) || value.includes(person.id)}
              disabled={locked.has(person.id)}
              onChange={(event) => onChange(event.target.checked ? [...value, person.id] : value.filter((id) => id !== person.id))}
            />
            <Avatar user={person} size={28} />
            <span className="min-w-0 flex-1 truncate">{nameOf(person)}</span>
            <span className="text-footnote text-label-2">{locked.has(person.id) ? t('templateUse.roleNote', { roles: locked.get(person.id) }) : person.discipline}</span>
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
  // The sub-company of a new project starts filled when the answer is clear (PRJ-17): the only one of the office, or the one of the
  // last project of the same client. A tap of the person ends this for good.
  const picked = useRef(false);
  const subs = subCompanies.data ?? [];
  const ofClient = useCall(
    'projects.list',
    { status: 'all', clientId: values.clientId || undefined },
    { enabled: mode === 'create' && values.clientId !== '' && subs.length > 1 },
  );
  useEffect(() => {
    if (mode !== 'create' || picked.current) return;
    if (subs.length === 1) {
      if (values.subCompanyId !== subs[0].id) set('subCompanyId', subs[0].id);
      return;
    }
    if (values.clientId === '' || !ofClient.data) return;
    const last = ofClient.data
      .filter((row) => row.subCompanyId && subs.some((item) => item.id === row.subCompanyId))
      .sort((a, b) => b.project.createdAt.localeCompare(a.project.createdAt))[0];
    if (last?.subCompanyId && values.subCompanyId !== last.subCompanyId) set('subCompanyId', last.subCompanyId);
  }, [mode, subs, values.clientId, values.subCompanyId, ofClient.data, set]);
  const template = mode === 'create' && values.templateId ? templates.find((t) => t.id === values.templateId) : undefined;
  // The people of the roles of the chosen template, with their role names. They are on the team whatever the ticks say (ADM-20).
  const rolePeople = new Map<string, string>();
  for (const role of template?.roles ?? []) {
    const personId = roleChoice(role, values, humans);
    if (personId) rolePeople.set(personId, [rolePeople.get(personId), role.name].filter(Boolean).join(', '));
  }
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
      {/* The template decides the whole plan, so it is the first choice after the name (ADM-20). */}
      {mode === 'create' && templates.length > 0 && <TemplatePicker form={form} templates={templates} />}
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
          onChange={(id) => {
            picked.current = true;
            set('subCompanyId', id);
          }}
          subCompanies={subCompanies.data ?? []}
          required={mode === 'create' || values.subCompanyId !== ''}
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
      <PinLine value={values.geo} changed={mode !== 'create' && form.edited('geo')} onChange={(geo) => set('geo', geo)} />
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
      {mode === 'create' && <TeamPicker people={people} value={values.teamIds} onChange={(ids) => set('teamIds', ids)} locked={rolePeople} />}
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
 * The pin line under Location (owner, 2026-10-18, fbk_017): the state of the pin ("Set" or "Not set", with a link that opens the
 * place in Google Maps), then "Set pin" (or "Change"), and "Remove" with a pin. "Set pin" opens the pin sheet; its "Use this place"
 * keeps the pin in the form. A change waits for the form's Save, as every other field does, and the line says so (PRJ-13, PRJ-21).
 */
function PinLine({ value, changed, onChange }: { value: GeoPoint | null; changed: boolean; onChange: (point: GeoPoint | null) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The name of the place, when a search hit set the pin in this sheet. A pin from the map or a link has no name.
  const [place, setPlace] = useState<string | null>(null);
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-subheadline text-ink-2">{t('map.pin.label')}</span>
      <span className="text-subheadline">
        {value ? (place ? <>{t('map.pin.state')}: <bdi dir="auto">{place}</bdi></> : t('map.pin.state')) : t('map.pin.none')}
      </span>
      {changed && <span className="text-footnote text-ink-2">{t('map.pin.unsaved')}</span>}
      {value && (
        <a href={googleMapsUrl(value)} target="_blank" rel="noopener noreferrer" className="pressable inline-flex min-h-11 items-center text-subheadline text-link underline underline-offset-2">
          {t('map.pin.open')}
        </a>
      )}
      <Button onClick={() => setOpen(true)}>{value ? t('map.pin.change') : t('map.pin.set')}</Button>
      {value && (
        <Button
          onClick={() => {
            setPlace(null);
            onChange(null);
          }}
        >
          {t('map.pin.remove')}
        </Button>
      )}
      <PinSheet
        open={open}
        onOpenChange={setOpen}
        initial={value}
        onUse={(point, name) => {
          setPlace(name);
          onChange(point);
          setOpen(false);
        }}
      />
    </div>
  );
}
