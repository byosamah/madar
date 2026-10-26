import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate } from '../../../api/contract/entities';
import { newStoryId } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { LoadFailed } from '../../../components/LoadFailed';
import { Sheet } from '../../../components/Sheet';
import { formatDay, todayISO } from '../../../lib/dates';
import { planProject, shiftAdded } from '../../../lib/projectPlan';
import { DEFAULT_CHOICES } from './SyncSteps';
import { useProjectName } from '../../../app/projectName';

/** The item of the project for each part of the template: a stage for a stage part, a task for a task part. Null: no item. */
type Picks = { stages: Record<string, string | null>; tasks: Record<string, string | null> };

/** A project item to pick: its id, its name, and the name of its stage when the list groups by stage. */
type Item = { id: string; label: string; group?: string };

/**
 * One list of picks: each template part with a select of the project's items. An item that another part holds is not offered here,
 * so one item matches one part. Task items sit in groups by stage, so two tasks of one name in two stages look different (ADM-11).
 */
function PickList({ title, parts, items, picked, onPick }: {
  title: string;
  parts: { id: string; label: string }[];
  items: Item[];
  picked: Record<string, string | null>;
  onPick: (partId: string, itemId: string) => void;
}) {
  const { t } = useTranslation();
  if (parts.length === 0) return null;
  const groups = [...new Set(items.map((item) => item.group))];
  return (
    <section className="flex flex-col gap-2">
      <h4 className="field-label">{title}</h4>
      {parts.map((part) => {
        const held = new Set(Object.entries(picked).filter(([partId]) => partId !== part.id).map(([, itemId]) => itemId));
        const choices = items.filter((item) => !held.has(item.id));
        const option = (item: Item) => <option key={item.id} value={item.id}>{item.label}</option>;
        return (
          <div key={part.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span dir="auto" className="text-subheadline sm:w-1/2">{part.label}</span>
            <select
              aria-label={t('projectTemplates.link.itemFor', { name: part.label })}
              className="field min-h-11 sm:w-1/2"
              value={picked[part.id] ?? ''}
              onChange={(event) => onPick(part.id, event.target.value)}
            >
              <option value="">{t('projectTemplates.link.noMatch')}</option>
              {groups.length > 1 || groups[0] !== undefined
                ? groups.map((group) => <optgroup key={group ?? ''} label={group ?? ''}>{choices.filter((item) => item.group === group).map(option)}</optgroup>)
                : choices.map(option)}
            </select>
          </div>
        );
      })}
    </section>
  );
}

/**
 * "Link <project> to <template>" (fbk_008 item 4; ADM-11). The picks start from the names (projectTemplates.matchPlan). The sheet says
 * how many parts match, shows the parts with no match first, and folds the matched parts. One choice covers every part with no match:
 * leave them out (the older project keeps its own plan) or add them to the project with the dates of the template. Save link sends the
 * link once, with the adding in the same story, and the toast has an Undo. Nothing is sent before Save link.
 *
 * The same sheet is the matching step of "Apply a template" in the project menu (mode "apply", fbk_020): "Add them" is the start choice,
 * and the main button says Apply template. The added parts start today when the dates of the template are past (shiftAdded, the same
 * function as the server). A project that follows another template takes this one only with "replace".
 */
export function LinkProjectSheet({ projectId, template, onClose, onDone, mode = 'link', replace = false }: {
  projectId: string;
  template: ProjectTemplate;
  /** Cancel and the close button. */
  onClose: () => void;
  /** After a save. It is onClose when the caller gives none. */
  onDone?: () => void;
  mode?: 'link' | 'apply';
  /** The project follows another template, and the person confirmed to apply this one instead. */
  replace?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { api } = useRuntime();
  const project = useCall('projects.get', { id: projectId });
  const tasks = useCall('tasks.list', { projectId, includeDone: true, activeProjectsOnly: false });
  const match = useCall('projectTemplates.matchPlan', { projectId, templateId: template.id });
  const users = useCall('users.list', {});
  const lang = useLang();
  const projectName = useProjectName();
  // The picks that the Admin changed. Until the Admin changes one, the picks are the matches of the names.
  const [changed, setChanged] = useState<Picks | null>(null);
  const [rest, setRest] = useState<'leave' | 'add'>(mode === 'apply' ? 'add' : 'leave');
  const [saving, setSaving] = useState(false);
  const picks: Picks = changed ?? match.data ?? { stages: {}, tasks: {} };
  const stages = project.data?.stages ?? [];
  const stageName = new Map(stages.map((stage) => [stage.id, stage.name]));
  const items = (tasks.data ?? []).map((row) => row.task);
  const choose = (kind: 'stages' | 'tasks', partId: string, itemId: string) => {
    const next = { ...picks[kind], [partId]: itemId || null };
    setChanged(kind === 'stages' ? { stages: next, tasks: picks.tasks } : { stages: picks.stages, tasks: next });
  };
  const picked = (kind: 'stages' | 'tasks', partId: string) => Boolean(picks[kind][partId]);
  // The lists group by the match of the names, so a part does not jump to the other list under the pointer when the person picks.
  const matched = (kind: 'stages' | 'tasks', partId: string) => Boolean(match.data?.[kind][partId]);
  const stageParts = template.stages.map((part) => ({ id: part.id, label: part.name }));
  const taskParts = template.tasks.map((part) => ({ id: part.id, label: part.title }));
  const stageItems: Item[] = stages.map((stage) => ({ id: stage.id, label: stage.name }));
  const taskItems: Item[] = items.map((task) => ({ id: task.id, label: task.title, group: task.stageId ? stageName.get(task.stageId) ?? '' : '' }));
  const noMatch = stageParts.filter((part) => !picked('stages', part.id)).length + taskParts.filter((part) => !picked('tasks', part.id)).length;
  const unmatchedCount = stageParts.filter((part) => !matched('stages', part.id)).length + taskParts.filter((part) => !matched('tasks', part.id)).length;
  const matchedCount = stageParts.length + taskParts.length - unmatchedCount;
  // The dates that the added parts get: the plan from the project start, moved forward when it is past (the server uses the same function).
  const startDate = project.data?.project.startDate ?? null;
  const addedDates = useMemo(() => {
    if (!startDate) return null;
    const plan = planProject(template, { startDate, fixedIds: [] });
    if (!plan.ok) return null;
    const open = (kind: 'stages' | 'tasks', parts: { id: string }[]) => parts.filter((part) => !picks[kind][part.id]).map((part) => part.id);
    return shiftAdded(plan, { taskIds: open('tasks', template.tasks), stageIds: open('stages', template.stages) }, todayISO());
  }, [startDate, template, picks]);
  const datesLine = !startDate
    ? t('projectTemplates.apply.noStart')
    : addedDates?.startDate && addedDates.endDate
      ? [t('projectTemplates.apply.dates', { from: formatDay(addedDates.startDate, lang), to: formatDay(addedDates.endDate, lang) }), ...(addedDates.shiftDays > 0 ? [t('projectTemplates.apply.datesMoved')] : [])].join(' ')
      : null;

  const submit = async () => {
    if (match.data === undefined || users.data === undefined || saving) return;
    setSaving(true);
    // A role keeps its default person only while that person is active. The server refuses an inactive person.
    const active = new Set(users.data.filter((user) => user.kind === 'human' && user.active).map((user) => user.id));
    let storyId = newStoryId();
    try {
      const linked = await api.run('projectTemplates.link', {
        projectId,
        templateId: template.id,
        stageMatches: Object.fromEntries(template.stages.map((part) => [part.id, picks.stages[part.id] ?? null])),
        taskMatches: Object.fromEntries(template.tasks.map((part) => [part.id, picks.tasks[part.id] ?? null])),
        rolePeople: Object.fromEntries(template.roles.map((role) => [role.id, role.defaultUserId !== null && active.has(role.defaultUserId) ? role.defaultUserId : null])),
        ...(replace ? { replace: true } : {}),
      }, { correlationId: storyId });
      storyId = linked.storyId;
      // "Add them": the parts with no match come back at once, with the dates of the template, in the same story.
      if (rest === 'add' && noMatch > 0) {
        const added = await api.run('projectTemplates.syncApply', {
          templateId: template.id,
          projectId,
          choices: { ...DEFAULT_CHOICES, add: false, text: false, dates: false, leads: false, stages: false, bringBack: true },
          // The apply of a template to an ongoing project: the project right is enough, and the dates start from today.
          apply: true,
        }, { correlationId: storyId });
        storyId = added.storyId;
      }
    } catch (error) {
      setSaving(false);
      toast.failed(error);
      return;
    }
    const story = storyId;
    toast.undo(t(mode === 'apply' ? 'projectTemplates.apply.done' : 'projectTemplates.link.linked'), () => {
      api.call('events.undoStory', { correlationId: story }).then(() => undefined, (error: unknown) => toast.failed(error));
    });
    (onDone ?? onClose)();
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t(mode === 'apply' ? 'projectTemplates.apply.matchTitle' : 'projectTemplates.link.title', { project: project.data ? projectName(project.data.project) : '', template: template.name })}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={match.data === undefined || users.data === undefined || saving} onClick={() => { void submit(); }}>{t(mode === 'apply' ? 'projectTemplates.apply.save' : 'projectTemplates.link.save')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-5 pt-1">
        <LoadFailed query={project} />
        <LoadFailed query={tasks} />
        <LoadFailed query={match} />
        <LoadFailed query={users} />
        <p className="text-subheadline text-ink-2">{t('projectTemplates.link.intro')}</p>
        {match.data !== undefined && (
          <>
            <p className="text-subheadline font-semibold text-ink">
              {t('projectTemplates.link.summary', {
                stages: stageParts.filter((part) => picked('stages', part.id)).length, stageTotal: stageParts.length,
                tasks: taskParts.filter((part) => picked('tasks', part.id)).length, taskTotal: taskParts.length,
              })}
            </p>
            {unmatchedCount > 0 && (
              <section aria-labelledby="link-no-match" className="flex flex-col gap-4">
                <h3 id="link-no-match" className="text-headline">{t('projectTemplates.link.noMatchTitle', { count: unmatchedCount })}</h3>
                <fieldset className="flex flex-col gap-1">
                  <legend className="sr-only">{t('projectTemplates.link.restLabel')}</legend>
                  {(['leave', 'add'] as const).map((value) => (
                    <label key={value} className="flex min-h-11 items-center gap-3 text-body text-ink">
                      <input type="radio" name="link-rest" checked={rest === value} onChange={() => setRest(value)} className="size-5 accent-[var(--sig-from)]" />
                      {t(value === 'leave' ? 'projectTemplates.link.leaveOut' : 'projectTemplates.link.addThem')}
                    </label>
                  ))}
                </fieldset>
                {rest === 'add' && noMatch > 0 && (
                  <div className="flex flex-col gap-1 text-footnote text-ink-2">
                    <p>{t('projectTemplates.apply.leads')}</p>
                    {datesLine !== null && <p>{datesLine}</p>}
                  </div>
                )}
                <PickList
                  title={t('projectTemplates.link.stages')}
                  parts={stageParts.filter((part) => !matched('stages', part.id))}
                  items={stageItems}
                  picked={picks.stages}
                  onPick={(partId, itemId) => choose('stages', partId, itemId)}
                />
                <PickList
                  title={t('projectTemplates.link.tasks')}
                  parts={taskParts.filter((part) => !matched('tasks', part.id))}
                  items={taskItems}
                  picked={picks.tasks}
                  onPick={(partId, itemId) => choose('tasks', partId, itemId)}
                />
              </section>
            )}
            {matchedCount > 0 && (
              <details className="rounded-xl border border-separator px-3 py-1">
                <summary className="flex min-h-11 cursor-pointer items-center text-subheadline font-medium">{t('projectTemplates.link.matchedTitle', { count: matchedCount })}</summary>
                <div className="flex flex-col gap-4 pb-3 pt-2">
                  <PickList
                    title={t('projectTemplates.link.stages')}
                    parts={stageParts.filter((part) => matched('stages', part.id))}
                    items={stageItems}
                    picked={picks.stages}
                    onPick={(partId, itemId) => choose('stages', partId, itemId)}
                  />
                  <PickList
                    title={t('projectTemplates.link.tasks')}
                    parts={taskParts.filter((part) => matched('tasks', part.id))}
                    items={taskItems}
                    picked={picks.tasks}
                    onPick={(partId, itemId) => choose('tasks', partId, itemId)}
                  />
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
