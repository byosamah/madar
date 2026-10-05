import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate } from '../../../api/contract/entities';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { Menu } from '../../../components/Menu';
import { Sheet } from '../../../components/Sheet';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { XIcon } from '../../../components/icons/animated/x';
import {
  addRole, addStage, addTask, draftError, draftInput, draftOf, emptyDraft, moveStage, removeRole, removeStage,
  type DraftRole, type DraftStage, type DraftTask, type TemplateDraft,
} from './templateDraft';
import { TemplateTimeline } from './TemplateTimeline';

/** A small field with its label above, for the numbers and the role of a task. The label is the accessible name. */
function SmallLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return <label htmlFor={htmlFor} className="text-caption text-ink-2">{children}</label>;
}

/** The number fields take Arabic digits too, so they are text fields with a number keyboard. */
const NUMBER = 'field min-h-11 w-full tabular';

function TaskRow({ task, draft, onChange, onRemove }: { task: DraftTask; draft: TemplateDraft; onChange: (task: DraftTask) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const id = `tpl-${task.id}`;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <SmallLabel htmlFor={`${id}-title`}>{t('projectTemplates.task')}</SmallLabel>
          <input id={`${id}-title`} className="field min-h-11" dir="auto" autoComplete="off" maxLength={200} value={task.title} onChange={(event) => onChange({ ...task, title: event.target.value })} />
        </div>
        <IconButton label={t('projectTemplates.removeTask', { title: task.title || task.id })} onClick={onRemove}>
          <AnimatedIcon icon={XIcon} size={16} aria-hidden />
        </IconButton>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-end gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <SmallLabel htmlFor={`${id}-role`}>{t('projectTemplates.role')}</SmallLabel>
          <select id={`${id}-role`} className="field min-h-11" value={task.roleId} onChange={(event) => onChange({ ...task, roleId: event.target.value })}>
            <option value="">{t('lead.noLead')}</option>
            {draft.roles.map((role, index) => <option key={role.id} value={role.id}>{role.name || String(index + 1)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <SmallLabel htmlFor={`${id}-start`}>{t('projectTemplates.startDay')}</SmallLabel>
          <input id={`${id}-start`} className={NUMBER} inputMode="numeric" autoComplete="off" value={task.start} onChange={(event) => onChange({ ...task, start: event.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <SmallLabel htmlFor={`${id}-days`}>{t('projectTemplates.days')}</SmallLabel>
          <input id={`${id}-days`} className={NUMBER} inputMode="numeric" autoComplete="off" value={task.days} onChange={(event) => onChange({ ...task, days: event.target.value })} />
        </div>
      </div>
      <label htmlFor={`${id}-flexible`} className="flex min-h-11 items-center gap-3 self-start rounded-xl pe-2 hover:bg-fill">
        <input
          id={`${id}-flexible`}
          type="checkbox"
          className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
          checked={task.flexible}
          onChange={(event) => onChange({ ...task, flexible: event.target.checked })}
        />
        <span className="text-subheadline">{t('projectTemplates.canStretch')}</span>
      </label>
    </li>
  );
}

function StageCard({
  stage, index, count, draft, setDraft,
}: { stage: DraftStage; index: number; count: number; draft: TemplateDraft; setDraft: (draft: TemplateDraft) => void }) {
  const { t } = useTranslation();
  const tasks = draft.tasks.filter((task) => task.stageId === stage.id);
  const n = index + 1;
  const setStage = (next: DraftStage) => setDraft({ ...draft, stages: draft.stages.map((s) => (s.id === stage.id ? next : s)) });
  const setTask = (next: DraftTask) => setDraft({ ...draft, tasks: draft.tasks.map((task) => (task.id === next.id ? next : task)) });
  const id = `tpl-${stage.id}`;
  return (
    <li className="flex flex-col gap-1 rounded-2xl border border-separator p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="tabular w-6 shrink-0 text-center text-footnote text-ink-2">{n}</span>
        <input
          id={`${id}-name`}
          aria-label={t('projectTemplates.stageNameOf', { n })}
          className="field min-h-11 min-w-0 flex-1 font-semibold"
          dir="auto"
          autoComplete="off"
          maxLength={60}
          value={stage.name}
          onChange={(event) => setStage({ ...stage, name: event.target.value })}
        />
        <Menu
          label={t('projectTemplates.stageActions', { n })}
          items={[
            { label: t('projectTemplates.moveUp'), onSelect: () => setDraft(moveStage(draft, stage.id, -1)), hidden: index === 0 },
            { label: t('projectTemplates.moveDown'), onSelect: () => setDraft(moveStage(draft, stage.id, 1)), hidden: index === count - 1 },
            { label: t('projectTemplates.removeStage'), onSelect: () => setDraft(removeStage(draft, stage.id)), destructive: true },
          ]}
        />
      </div>
      {tasks.length === 0 && (
        <div className="flex flex-col gap-2 pt-2">
          <p className="text-footnote text-ink-2">{t('projectTemplates.stageDaysHint')}</p>
          <div className="grid max-w-56 grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <SmallLabel htmlFor={`${id}-start`}>{t('projectTemplates.startDay')}</SmallLabel>
              <input id={`${id}-start`} className={NUMBER} inputMode="numeric" autoComplete="off" value={stage.start} onChange={(event) => setStage({ ...stage, start: event.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <SmallLabel htmlFor={`${id}-days`}>{t('projectTemplates.days')}</SmallLabel>
              <input id={`${id}-days`} className={NUMBER} inputMode="numeric" autoComplete="off" value={stage.days} onChange={(event) => setStage({ ...stage, days: event.target.value })} />
            </div>
          </div>
        </div>
      )}
      {tasks.length > 0 && (
        <ul className="hairline flex flex-col">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              draft={draft}
              onChange={setTask}
              onRemove={() => setDraft({ ...draft, tasks: draft.tasks.filter((other) => other.id !== task.id) })}
            />
          ))}
        </ul>
      )}
      <Button variant="plain" className="self-start" onClick={() => setDraft(addTask(draft, stage.id))}>
        <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
        {t('projectTemplates.addTask')}
      </Button>
    </li>
  );
}

function RoleRow({ role, n, people, onChange, onRemove }: {
  role: DraftRole; n: number; people: { id: string; label: string }[]; onChange: (role: DraftRole) => void; onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
      <input
        aria-label={t('projectTemplates.roleNameOf', { n })}
        className="field min-h-11"
        dir="auto"
        autoComplete="off"
        maxLength={60}
        value={role.name}
        onChange={(event) => onChange({ ...role, name: event.target.value })}
      />
      <select aria-label={t('projectTemplates.defaultPersonOf', { n })} className="field min-h-11" value={role.defaultUserId} onChange={(event) => onChange({ ...role, defaultUserId: event.target.value })}>
        <option value="">{t('projectTemplates.noDefault')}</option>
        {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
      </select>
      <IconButton label={t('projectTemplates.removeRole', { n })} onClick={onRemove}>
        <AnimatedIcon icon={XIcon} size={16} aria-hidden />
      </IconButton>
    </li>
  );
}

/**
 * The editor of one project template (owner, 2026-10-05, item 6a), in a sheet: the name, the roles with a default person, the
 * stages in order with their tasks (title, role, start day, working days, "Can stretch"), and a small timeline. One main
 * button: Save template. The first problem shows above it, in the order of the form.
 */
export function ProjectTemplateEditor({ template, onClose }: { template: ProjectTemplate | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const users = useCall('users.list', {});
  const people = (users.data ?? [])
    .filter((user) => user.kind === 'human' && (user.active || template?.roles.some((role) => role.defaultUserId === user.id)))
    .sort(byName)
    .map((user) => ({ id: user.id, label: nameOf(user) }));
  const [draft, setDraft] = useState<TemplateDraft>(() => (template ? draftOf(template) : emptyDraft()));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction('projectTemplates.save', {
    onSuccess: () => {
      toast.show({ message: t('projectTemplates.saved') });
      onClose();
    },
  });
  const submit = () => {
    const error = draftError(draft);
    setProblem(error);
    // The message sits under the timeline: bring it into view, as the Save button stays at the foot of the sheet.
    if (error) requestAnimationFrame(() => document.getElementById('template-problem')?.scrollIntoView?.({ block: 'nearest' }));
    if (error || save.isPending) return;
    save.mutate({ ...draftInput(draft), ...(template ? { id: template.id } : {}) });
  };
  const setRole = (next: DraftRole) => setDraft({ ...draft, roles: draft.roles.map((role) => (role.id === next.id ? next : role)) });

  return (
    <Sheet
      open
      wide
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={template ? template.name : t('projectTemplates.newTitle')}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>{t('projectTemplates.save')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-6 pt-1">
        <TextField
          id="template-name"
          label={t('projectTemplates.name')}
          required
          dir="auto"
          autoComplete="off"
          maxLength={60}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />

        <section aria-labelledby="template-roles" className="flex flex-col gap-2">
          <h3 id="template-roles" className="field-label">{t('projectTemplates.roles')}</h3>
          <p className="text-footnote text-ink-2">{t('projectTemplates.rolesHint')}</p>
          {draft.roles.length > 0 && (
            <>
              <div aria-hidden className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 text-caption text-ink-2">
                <span>{t('projectTemplates.roleName')}</span>
                <span>{t('projectTemplates.defaultPerson')}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {draft.roles.map((role, index) => (
                  <RoleRow key={role.id} role={role} n={index + 1} people={people} onChange={setRole} onRemove={() => setDraft(removeRole(draft, role.id))} />
                ))}
              </ul>
            </>
          )}
          <Button variant="plain" className="self-start" onClick={() => setDraft(addRole(draft))}>
            <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
            {t('projectTemplates.addRole')}
          </Button>
        </section>

        <section aria-labelledby="template-stages" className="flex flex-col gap-2">
          <h3 id="template-stages" className="field-label">{t('projectTemplates.stages')}</h3>
          <p className="text-footnote text-ink-2">{t('projectTemplates.stagesHint')}</p>
          <ol className="flex flex-col gap-3">
            {draft.stages.map((stage, index) => (
              <StageCard key={stage.id} stage={stage} index={index} count={draft.stages.length} draft={draft} setDraft={setDraft} />
            ))}
          </ol>
          <Button className="self-start" onClick={() => setDraft(addStage(draft))}>
            <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
            {t('projectTemplates.addStage')}
          </Button>
        </section>

        <TemplateTimeline draft={draft} />
        {problem && <p id="template-problem" role="alert" className="text-footnote text-late">{t(problem)}</p>}
      </div>
    </Sheet>
  );
}
