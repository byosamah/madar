import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate } from '../../../api/contract/entities';
import { useByPersonName, usePersonName } from '../../../app/personName';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { useIsPhone } from '../../../app/useIsPhone';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { Sheet } from '../../../components/Sheet';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { XIcon } from '../../../components/icons/animated/x';
import type { ProjectTemplateRow } from '../../../api/handlers/projectTemplates';
import {
  addRole, addStage, addTask, addWait, draftInput, draftOf, draftProblem, emptyDraft, importStages, NAME_MAX, removeRole, removeWait,
  type DraftProblem, type DraftRole, type TemplateDraft,
} from './templateDraft';
import { AddStagesSheet } from './AddStagesSheet';
import { TemplateDetails } from './TemplateDetails';
import { TemplateGantt, type Kind, type Picked } from './TemplateGantt';
import { TemplateList } from './TemplateList';

function RoleRow({ role, n, people, onChange, onRemove, error }: {
  role: DraftRole; n: number; people: { id: string; label: string }[]; onChange: (role: DraftRole) => void; onRemove: () => void; error?: string;
}) {
  const { t } = useTranslation();
  return (
    // A phone stacks the person under the name. A wider screen puts them side by side, under the column names.
    <li className="flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem]">
        <input
          aria-label={t('projectTemplates.roleNameOf', { n })}
          aria-invalid={error ? true : undefined}
          className="field col-start-1 row-start-1 min-h-11"
          dir="auto"
          autoComplete="off"
          maxLength={NAME_MAX}
          value={role.name}
          onChange={(event) => onChange({ ...role, name: event.target.value })}
        />
        <select
          aria-label={t('projectTemplates.defaultPersonOf', { n })}
          className="field col-span-2 min-h-11 sm:col-span-1 sm:col-start-2 sm:row-start-1"
          value={role.defaultUserId}
          onChange={(event) => onChange({ ...role, defaultUserId: event.target.value })}
        >
          <option value="">{t('projectTemplates.noDefault')}</option>
          {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
        </select>
        <IconButton label={t('projectTemplates.removeRole', { n })} className="col-start-2 row-start-1 sm:col-start-3" onClick={onRemove}>
          <AnimatedIcon icon={XIcon} size={16} aria-hidden />
        </IconButton>
      </div>
      {error && <p className="text-footnote text-late">{error}</p>}
    </li>
  );
}

/**
 * The editor of one project template (owner, 2026-10-05, item 6a; ADM-06). On a computer it fills the screen: the timeline is the main
 * view, one row for each stage and task, and a press on a row shows its details beside the chart. A phone keeps a list of the same
 * rows, and a press opens the details in a sheet. The name and the task leads sit above. One main button: Save template. A save that
 * finds a problem opens the part, marks the field and says what to fix. The editor never loses changes by accident: Cancel, Escape,
 * the close button and a press outside ask "Discard the changes?" first (ADM-02). A copy (Duplicate) opens filled with its draft, and
 * Save makes a new template from it.
 */
export function ProjectTemplateEditor({ template, copy, onClose, onSaved }: {
  template: ProjectTemplate | null;
  copy?: TemplateDraft;
  onClose: () => void;
  /** The saved row, and whether the save changed the template. The list shows the toast. */
  onSaved: (row: ProjectTemplateRow, changed: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const nameOf = usePersonName();
  const byName = useByPersonName();
  const users = useCall('users.list', {});
  const people = (users.data ?? [])
    .filter((user) => user.kind === 'human' && (user.active || template?.roles.some((role) => role.defaultUserId === user.id)))
    .sort(byName)
    .map((user) => ({ id: user.id, label: nameOf(user) }));
  const first = useRef<TemplateDraft | null>(null);
  first.current ??= template ? draftOf(template) : (copy ?? emptyDraft());
  const [draft, setDraft] = useState<TemplateDraft>(first.current);
  const dirty = JSON.stringify(draft) !== JSON.stringify(first.current);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  // The sheet that takes stages from another saved template (fbk_008 item 7).
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const phone = useIsPhone();
  const save = useAction('projectTemplates.save', {
    onSuccess: (row) => {
      onSaved(row, dirty);
      onClose();
    },
  });

  // A pick of a part that is gone (removed, or the draft changed) shows nothing.
  const pickedNow = picked && (picked.kind === 'stage' ? draft.stages : draft.tasks).some((part) => part.id === picked.id) ? picked : null;
  const problem: DraftProblem | null = attempted ? draftProblem(draft) : null;
  const requestClose = () => (dirty ? setAsking(true) : onClose());

  const submit = () => {
    const found = draftProblem(draft);
    setAttempted(true);
    if (found) {
      // Open the part that holds the problem, so the marked field is on the screen.
      if (found.part?.kind === 'role') setRolesOpen(true);
      else if (found.part) setPicked({ kind: found.part.kind, id: found.part.id });
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.scrollIntoView?.({ block: 'nearest' }));
      return;
    }
    if (save.isPending) return;
    save.mutate({ ...draftInput(draft), ...(template ? { id: template.id } : {}) });
  };
  const setRole = (next: DraftRole) => setDraft({ ...draft, roles: draft.roles.map((role) => (role.id === next.id ? next : role)) });

  // A new wait. A waiting part that starts too early moves to the day after the needed part ends, and the toast says so with Undo (ADM-08).
  const link = (kind: Kind, waitingId: string, neededId: string) => {
    const result = addWait(draft, kind, waitingId, neededId);
    if (result.draft === draft) return;
    setDraft(result.draft);
    const [moved] = result.moved;
    if (!moved) return;
    toast.undo(
      t(result.moved.length > 1 ? 'projectTemplates.nowStartsMore' : 'projectTemplates.nowStarts', { name: moved.name, day: moved.start }),
      () => setDraft((current) => (current === result.draft ? draft : current)),
    );
  };
  const unlink = (kind: Kind, waitingId: string, neededId: string) => setDraft(removeWait(draft, kind, waitingId, neededId));

  const focusLater = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
  const newStage = () => {
    const next = addStage(draft);
    setDraft(next);
    setPicked({ kind: 'stage', id: next.stages[next.stages.length - 1].id });
    focusLater('tpl-detail-name');
  };
  // A new task goes to the stage of the pick, or to the last stage.
  const newTask = () => {
    const stageId = pickedNow?.kind === 'stage'
      ? pickedNow.id
      : pickedNow?.kind === 'task' ? draft.tasks.find((task) => task.id === pickedNow.id)?.stageId : undefined;
    const target = stageId ?? draft.stages[draft.stages.length - 1]?.id;
    if (!target) return;
    const next = addTask(draft, target);
    setDraft(next);
    setPicked({ kind: 'task', id: next.tasks.find((task) => !draft.tasks.some((old) => old.id === task.id))!.id });
    focusLater('tpl-detail-title');
  };

  const nameError = problem?.part === null && problem.field === 'name' ? t(problem.key, problem.vars) : undefined;
  const roleError = (id: string) => (problem?.part?.kind === 'role' && problem.part.id === id ? t(problem.key, problem.vars) : undefined);
  const details = pickedNow && (
    <TemplateDetails draft={draft} setDraft={setDraft} picked={pickedNow} onLink={link} onUnlink={unlink} onPick={setPicked} problem={problem} />
  );
  const pickedName = pickedNow
    ? (pickedNow.kind === 'stage' ? draft.stages.find((part) => part.id === pickedNow.id)?.name : draft.tasks.find((part) => part.id === pickedNow.id)?.title) ?? ''
    : '';

  return (
    <Sheet
      open
      full
      keepOnOutsidePress={dirty}
      onOpenChange={(open) => { if (!open) requestClose(); }}
      title={template ? template.name : (copy?.name ?? t('projectTemplates.newTitle'))}
      footer={(
        <>
          {problem && <p role="alert" className="me-auto self-center text-footnote text-late">{t('projectTemplates.fixToSave')}</p>}
          <Button onClick={requestClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>{t('projectTemplates.save')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-5 pt-1">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <TextField
            id="template-name"
            label={t('projectTemplates.name')}
            required
            dir="auto"
            autoComplete="off"
            maxLength={NAME_MAX}
            className="w-full max-w-sm"
            value={draft.name}
            error={nameError}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <Button variant="plain" aria-expanded={rolesOpen} aria-controls="template-roles" onClick={() => setRolesOpen(!rolesOpen)}>
            {t('projectTemplates.rolesToggle', { count: draft.roles.length })}
          </Button>
          <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
            <Button onClick={newStage}>
              <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
              {t('projectTemplates.addStage')}
            </Button>
            <Button variant="plain" onClick={newTask}>
              <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
              {t('projectTemplates.addTask')}
            </Button>
            <Button variant="plain" onClick={() => setAdding(true)}>{t('projectTemplates.addStagesFrom')}</Button>
          </div>
        </div>

        {rolesOpen && (
          <section id="template-roles" aria-label={t('projectTemplates.roles')} className="flex flex-col gap-2 rounded-card border border-separator p-3">
            <p className="text-footnote text-ink-2">{t('projectTemplates.rolesHint')}</p>
            {draft.roles.length > 0 && (
              <>
                <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 text-caption text-ink-2 sm:grid">
                  <span>{t('projectTemplates.roleName')}</span>
                  <span>{t('projectTemplates.defaultPerson')}</span>
                </div>
                <ul className="flex flex-col gap-4 sm:gap-2">
                  {draft.roles.map((role, index) => (
                    <RoleRow
                      key={role.id} role={role} n={index + 1} people={people} onChange={setRole} error={roleError(role.id)}
                      onRemove={() => setDraft(removeRole(draft, role.id))}
                    />
                  ))}
                </ul>
              </>
            )}
            <Button variant="plain" className="self-start" onClick={() => setDraft(addRole(draft))}>
              <AnimatedIcon icon={PlusIcon} size={16} aria-hidden />
              {t('projectTemplates.addRole')}
            </Button>
          </section>
        )}

        {phone ? (
          <section aria-label={t('projectTemplates.stages')} className="flex flex-col gap-2">
            <TemplateList draft={draft} onSelect={setPicked} />
          </section>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <section aria-label={t('projectTemplates.timeline')} className="min-w-0">
              <TemplateGantt draft={draft} onChange={setDraft} onLink={link} selected={pickedNow} onSelect={setPicked} />
            </section>
            <aside aria-label={t('projectTemplates.details')} className="surface flex flex-col gap-3 rounded-card p-4 lg:sticky lg:top-0">
              {details || <p className="text-subheadline text-ink-2">{t('projectTemplates.pickPart')}</p>}
            </aside>
          </div>
        )}
      </div>

      {phone && pickedNow && (
        <Sheet
          open
          onOpenChange={(open) => { if (!open) setPicked(null); }}
          title={pickedName || t('projectTemplates.details')}
          footer={<Button variant="primary" onClick={() => setPicked(null)}>{t('common.done')}</Button>}
        >
          <div className="pt-1">{details}</div>
        </Sheet>
      )}
      {adding && (
        <AddStagesSheet
          exclude={template?.id ?? null}
          onClose={() => setAdding(false)}
          onAdd={(source, stageIds, withTasks, keepDays) => {
            setDraft(importStages(draft, source, stageIds, withTasks, keepDays));
            setAdding(false);
          }}
        />
      )}
      {asking && (
        <Sheet
          open
          onOpenChange={(open) => { if (!open) setAsking(false); }}
          title={t('projectTemplates.discardTitle')}
          footer={(
            <>
              <Button variant="destructive" onClick={onClose}>{t('projectTemplates.discard')}</Button>
              <Button variant="primary" data-autofocus onClick={() => setAsking(false)}>{t('projectTemplates.keepEditing')}</Button>
            </>
          )}
        >
          <p className="pt-1 text-subheadline text-ink-2">{t('projectTemplates.discardBody')}</p>
        </Sheet>
      )}
    </Sheet>
  );
}
