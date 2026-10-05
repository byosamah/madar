import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate, User } from '../../api/contract/entities';
import { useLang } from '../../app/lang';
import { useByPersonName, usePersonName } from '../../app/personName';
import { SelectField } from '../../components/Fields';
import { formatDay } from '../../lib/dates';
import { templateDays } from '../../lib/projectPlan';
import { emptyTemplateChoice } from './projectForm';
import type { ProjectForm } from './ProjectFields';
import { planOfForm, roleChoice, setStageStretch, showStretch, stageStretch } from './templateForm';

/** "Start from a template" (owner, 2026-10-05, item 6a): one select. A new pick starts the roles and the ticks again. */
export function TemplatePicker({ form, templates }: { form: ProjectForm; templates: readonly ProjectTemplate[] }) {
  const { t } = useTranslation();
  const choose = (templateId: string) => {
    const empty = emptyTemplateChoice();
    form.set('templateId', templateId);
    form.set('templateRoles', empty.templateRoles);
    form.set('templateStretch', empty.templateStretch);
  };
  return (
    <SelectField id="project-template" label={t('templateUse.startFrom')} value={form.values.templateId} onChange={(event) => choose(event.target.value)}>
      <option value="">{t('templateUse.none')}</option>
      {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
    </SelectField>
  );
}

/** A tick that can show "some": a stage whose tasks are partly ticked. */
function Tick({ id, label, state, onChange, strong = false }: { id: string; label: string; state: 'on' | 'off' | 'mixed'; onChange: (on: boolean) => void; strong?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'mixed';
  }, [state]);
  return (
    <label htmlFor={id} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-fill">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
        checked={state === 'on'}
        aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
        onChange={(event) => onChange(event.target.checked)}
      />
      <bdi className={`min-w-0 flex-1 truncate ${strong ? 'font-semibold' : ''}`}>{label}</bdi>
    </label>
  );
}

/**
 * The part of the new-project form under the dates when a template is chosen: one line with the template length and the new
 * length (or why the locked tasks do not fit), the folded "Stretch or shrink" ticks when the end date changes the length, and
 * one person for each role. The fewest controls stay in view: the ticks only matter when the length changes.
 */
export function TemplateDetails({ form, template, people }: { form: ProjectForm; template: ProjectTemplate; people: User[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const { values, set } = form;
  const plan = planOfForm(template, values);
  const stretch = values.templateStretch;
  const sorted = [...people].sort(byName);

  let line: string;
  if (plan && !plan.ok) line = t('templateUse.tooShort', { needs: plan.needs });
  else if (plan && values.targetEndDate && plan.days !== plan.templateDays) line = t('templateUse.lengthNew', { template: plan.templateDays, project: plan.days });
  else if (plan?.endDate) line = t('templateUse.lengthEnds', { template: plan.templateDays, date: formatDay(plan.endDate, lang, 'long') });
  else line = t('templateUse.lengthOnly', { template: plan?.templateDays ?? templateDays(template) });

  return (
    <div className="flex flex-col gap-4">
      <p role={plan && !plan.ok ? 'alert' : 'status'} className={`text-subheadline ${plan && !plan.ok ? 'text-attn' : 'text-ink-2'}`}>{line}</p>
      {showStretch(template, values) && (
        <details className="rounded-2xl bg-fill px-3 py-2">
          <summary className="pressable flex min-h-11 cursor-pointer items-center font-semibold">{t('templateUse.stretch')}</summary>
          <p id="template-stretch-hint" className="pb-2 text-footnote text-ink-2">{t('templateUse.stretchHint')}</p>
          <ul aria-describedby="template-stretch-hint" className="flex flex-col gap-1 pb-1">
            {template.stages.map((stage) => {
              const tasks = template.tasks.filter((task) => task.stageId === stage.id);
              if (tasks.length === 0 && stage.startOffset === null) return null;
              return (
                <li key={stage.id} className="flex flex-col">
                  <Tick
                    id={`stretch-${stage.id}`}
                    label={stage.name}
                    strong
                    state={stageStretch(template, stage.id, stretch)}
                    onChange={(on) => set('templateStretch', setStageStretch(template, stage.id, on, stretch))}
                  />
                  {tasks.length > 0 && (
                    <ul className="flex flex-col ps-7">
                      {tasks.map((task) => (
                        <li key={task.id}>
                          <Tick
                            id={`stretch-${task.id}`}
                            label={task.title}
                            state={(stretch[task.id] ?? task.flexible) ? 'on' : 'off'}
                            onChange={(on) => set('templateStretch', { ...stretch, [task.id]: on })}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {template.roles.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="pb-1 text-footnote text-label-2">{t('templateUse.roles')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {template.roles.map((role) => {
              const fallback = people.find((person) => person.id === role.defaultUserId && person.active);
              const others = sorted.filter((person) => person.id !== fallback?.id && person.active);
              return (
                <SelectField
                  key={role.id}
                  id={`template-role-${role.id}`}
                  label={role.name}
                  value={roleChoice(role, values, people)}
                  onChange={(event) => set('templateRoles', { ...values.templateRoles, [role.id]: event.target.value })}
                >
                  {fallback && <option value={fallback.id}>{nameOf(fallback)}</option>}
                  {others.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}</option>)}
                  <option value="">{t('lead.noLead')}</option>
                </SelectField>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
