import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate } from '../../../api/contract/entities';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { LoadFailed } from '../../../components/LoadFailed';
import { Sheet } from '../../../components/Sheet';

/** The item of the project for each part of the template: a stage for a stage part, a task for a task part. Null: no item. */
type Picks = { stages: Record<string, string | null>; tasks: Record<string, string | null> };

/**
 * One list of picks: each template part with a select of the project's items. An item that another part holds is not offered
 * here, so one item matches one part.
 */
function PickList({ title, parts, items, picked, onPick }: {
  title: string;
  parts: { id: string; label: string }[];
  items: { id: string; label: string }[];
  picked: Record<string, string | null>;
  onPick: (partId: string, itemId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="field-label">{title}</h3>
      {parts.map((part) => {
        const held = new Set(Object.entries(picked).filter(([partId]) => partId !== part.id).map(([, itemId]) => itemId));
        const choices = items.filter((item) => !held.has(item.id));
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
              {choices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
        );
      })}
    </section>
  );
}

/**
 * "Link an older project" (fbk_008 item 4). The picks start from the names (projectTemplates.matchPlan). The Admin changes any pick,
 * then Save link sends the link once. A template part with no pick is dropped from the project. Nothing is sent before Save link.
 */
export function LinkProjectSheet({ projectId, template, onClose }: {
  projectId: string;
  template: ProjectTemplate;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const project = useCall('projects.get', { id: projectId });
  const tasks = useCall('tasks.list', { projectId, includeDone: true, activeProjectsOnly: false });
  const match = useCall('projectTemplates.matchPlan', { projectId, templateId: template.id });
  const users = useCall('users.list', {});
  // The picks that the Admin changed. Until the Admin changes one, the picks are the matches of the names.
  const [changed, setChanged] = useState<Picks | null>(null);
  const picks: Picks = changed ?? match.data ?? { stages: {}, tasks: {} };
  const stages = project.data?.stages ?? [];
  const items = (tasks.data ?? []).map((row) => row.task);
  const save = useAction('projectTemplates.link', {
    onSuccess: () => {
      toast.show({ message: t('projectTemplates.link.linked') });
      onClose();
    },
  });
  const choose = (kind: 'stages' | 'tasks', partId: string, itemId: string) => {
    const next = { ...picks[kind], [partId]: itemId || null };
    setChanged(kind === 'stages' ? { stages: next, tasks: picks.tasks } : { stages: picks.stages, tasks: next });
  };
  const submit = () => {
    if (match.data === undefined || users.data === undefined || save.isPending) return;
    // A role keeps its default person only while that person is active. The server refuses an inactive person.
    const active = new Set(users.data.filter((user) => user.kind === 'human' && user.active).map((user) => user.id));
    save.mutate({
      projectId,
      templateId: template.id,
      stageMatches: Object.fromEntries(template.stages.map((part) => [part.id, picks.stages[part.id] ?? null])),
      taskMatches: Object.fromEntries(template.tasks.map((part) => [part.id, picks.tasks[part.id] ?? null])),
      rolePeople: Object.fromEntries(template.roles.map((role) => [role.id, role.defaultUserId !== null && active.has(role.defaultUserId) ? role.defaultUserId : null])),
    });
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('projectTemplates.link.title')}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={match.data === undefined || users.data === undefined || save.isPending} onClick={submit}>{t('projectTemplates.link.save')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-5 pt-1">
        <LoadFailed query={project} />
        <LoadFailed query={tasks} />
        <LoadFailed query={match} />
        <LoadFailed query={users} />
        <p className="text-subheadline text-ink-2">{t('projectTemplates.link.intro')}</p>
        <div className="hidden text-footnote text-ink-2 sm:flex">
          <span className="sm:w-1/2">{t('projectTemplates.link.partColumn')}</span>
          <span className="sm:w-1/2">{t('projectTemplates.link.itemColumn')}</span>
        </div>
        <p className="text-footnote text-ink-2">{t('projectTemplates.link.dropHint')}</p>
        {match.data !== undefined && (
          <>
            <PickList
              title={t('projectTemplates.link.stages')}
              parts={template.stages.map((part) => ({ id: part.id, label: part.name }))}
              items={stages.map((stage) => ({ id: stage.id, label: stage.name }))}
              picked={picks.stages}
              onPick={(partId, itemId) => choose('stages', partId, itemId)}
            />
            <PickList
              title={t('projectTemplates.link.tasks')}
              parts={template.tasks.map((part) => ({ id: part.id, label: part.title }))}
              items={items.map((task) => ({ id: task.id, label: task.title }))}
              picked={picks.tasks}
              onPick={(partId, itemId) => choose('tasks', partId, itemId)}
            />
          </>
        )}
      </div>
    </Sheet>
  );
}
