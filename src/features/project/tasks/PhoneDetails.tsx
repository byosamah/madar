import { useTranslation } from 'react-i18next';
import { AgeRefresh } from '../../../components/Age';
import { Button } from '../../../components/Button';
import type { TaskStatus } from '../../../api/contract/entities';
import { usePersonName } from '../../../app/personName';
import { Avatar } from '../../../components/Avatar';
import { TextArea } from '../../../components/Fields';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';
import { NoLeadMark } from '../../../components/NoLeadMark';
import { RichText } from '../../../components/RichText';
import { BOARD_COLUMNS, moveTargets } from '../../../lib/board';
import { formatDay } from '../../../lib/dates';
import { useLang } from '../../../app/lang';
import { Group, PickRow, SwitchRow, ValueRow } from './DetailRows';
import { DateNotes, TaskNeeds } from './TaskNeeds';
import { Checklist, History, TaskFiles } from './TaskParts';
import { TaskVersions } from './TaskVersions';
import { personOption, TaskHelpers } from './TaskHelpers';
import { durationText, TaskTiming } from './TaskTiming';
import type { TaskPanel } from './useTaskPanel';

/** The people of the to-do: the lead, then the helpers and the row that adds one. */
function People({ panel }: { panel: TaskPanel }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const { data, detail, task, viewerCan, newLead, leadJoins, choices, teamIds, patch } = panel;
  const owner = data.owner;
  const value = owner
    ? <><Avatar user={owner} size={22} /><bdi className="truncate">{nameOf(owner)}</bdi></>
    : <><NoLeadMark size={22} /><span>{t('lead.noLead')}</span></>;
  return (
    <Group title={t('phoneTask.groupPeople')} hint={viewerCan.editAll ? (detail?.viewerCan.editTeam ? t('taskSheet.helpersHint') : t('office.helpersHint')) : undefined}>
      {viewerCan.editAll ? (
        <PickRow
          id="task-owner"
          label={t('taskSheet.owner')}
          value={task.ownerId ?? ''}
          display={value}
          onChange={(next) => {
            const id = next || null;
            leadJoins.current = id !== null && !teamIds.has(id);
            newLead.mutate({ id: task.id, patch: { ownerId: id } });
          }}
        >
          {/* "No lead" comes first (owner, 2026-10-05). A task in review or done keeps its lead, so it offers no "No lead". */}
          {(task.ownerId === null || task.status === 'todo' || task.status === 'in_progress') && <option value="">{t('lead.noLead')}</option>}
          {(owner && !choices.some((person) => person.id === task.ownerId) ? [...choices, owner] : choices)
            .map((person) => <option key={person.id} value={person.id}>{personOption(person, teamIds.has(person.id), t)}</option>)}
        </PickRow>
      ) : <ValueRow label={t('taskSheet.owner')}>{value}</ValueRow>}
      <TaskHelpers
        layout="rows"
        helpers={data.helpers}
        leadId={task.ownerId}
        people={choices}
        teamIds={teamIds}
        canEdit={viewerCan.editAll}
        onChange={(helperIds) => patch({ helperIds })}
      />
    </Group>
  );
}

/** The dates: Start, Timing and Due (or Duration). A person who cannot change the dates reads plain rows. */
function When({ panel }: { panel: TaskPanel }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { task, canDates, patch, timingKey, failures } = panel;
  return (
    <Group title={t('phoneTask.groupWhen')}>
      {canDates ? (
        <TaskTiming
          layout="rows"
          key={`${timingKey}-${failures}`}
          idPrefix="task"
          value={{ startDate: task.startDate ?? null, schedule: task.schedule ?? 'static', durationDays: task.durationDays ?? null, dueDate: task.dueDate }}
          onPatch={patch}
        />
      ) : (
        <>
          <ValueRow label={t('taskSheet.startDate')}>{task.startDate ? formatDay(task.startDate, lang, 'long') : t('overview.none')}</ValueRow>
          <ValueRow label={t('taskSheet.dueDate')}>{task.dueDate ? formatDay(task.dueDate, lang, 'long') : t('overview.none')}</ValueRow>
          {task.schedule === 'dynamic' && task.durationDays && <ValueRow label={t('taskSheet.duration')}>{durationText(task.durationDays, t)}</ValueRow>}
        </>
      )}
    </Group>
  );
}

/** The state of the to-do: Status, Stage, Flag, Needs review and the description. */
function ThisTodo({ panel }: { panel: TaskPanel }) {
  const { t } = useTranslation();
  const {
    data, detail, task, viewerCan, canDetails, makerId, description, setDescription, unsaved, patch, move,
  } = panel;
  return (
    <Group title={t('phoneTask.groupThis')}>
      {/* The reviewer finishes or returns a task in review with Approve or Send back only, so the Status row has no picker for them. */}
      {data.canMove && !viewerCan.review ? (
        <PickRow
          id="task-status"
          label={t('taskSheet.status')}
          value={task.status}
          display={t(`taskStatus.${task.status}`)}
          onChange={(status) => move.mutate({ id: task.id, status: status as TaskStatus })}
        >
          {/* While the task waits for review, its lead gets the pull-back choices and no Done (audit 2026-10-03, F-19). */}
          {BOARD_COLUMNS.filter((status) => status === task.status || moveTargets(task.status, false, task.needsReview, task.ownerId !== null).includes(status))
            .map((status) => <option key={status} value={status}>{t(`taskStatus.${status}`)}</option>)}
        </PickRow>
      ) : <ValueRow label={t('taskSheet.status')}>{t(`taskStatus.${task.status}`)}</ValueRow>}
      {detail && (canDetails ? (
        <PickRow
          id="task-stage"
          label={t('taskSheet.stage')}
          value={task.stageId ?? ''}
          display={<bdi className="truncate">{data.stage?.name ?? ''}</bdi>}
          onChange={(stageId) => patch({ stageId })}
        >
          {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </PickRow>
      ) : <ValueRow label={t('taskSheet.stage')}><bdi className="truncate">{data.stage?.name ?? ''}</bdi></ValueRow>)}
      {canDetails
        ? <SwitchRow id="task-flag" label={t('taskSheet.flag')} description={t('taskSheet.flagHint')} checked={task.flagged} onChange={(on) => patch({ flagged: on })} />
        : task.flagged && (
          <ValueRow label={t('taskSheet.flag')}>
            <span className="inline-flex items-center gap-1 text-attn"><AnimatedIcon icon={BadgeAlertIcon} size={14} aria-hidden />{t('tasks.flagged')}</span>
          </ValueRow>
        )}
      {/* The maker reviews an office task, so a task that its maker leads has no review to turn on (owner, 2026-10-06). On a project task the
          review need belongs to the leader, never to the maker (owner, 2026-10-07). */}
      {viewerCan.setNeedsReview && (detail || task.ownerId !== makerId) && (
        <SwitchRow
          id="task-review"
          label={t('taskSheet.needsReview')}
          description={t(detail ? 'taskSheet.needsReviewHint' : 'office.needsReviewHint')}
          checked={task.needsReview}
          onChange={(on) => patch({ needsReview: on })}
        />
      )}
      {canDetails ? (
        <div className="px-4 py-3">
          <TextArea
            id="task-description"
            label={t('taskSheet.description')}
            value={description}
            dir="auto"
            error={unsaved && description !== task.description ? t('taskSheet.notSaved') : undefined}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => {
              if (description !== task.description) patch({ description });
            }}
          />
        </div>
      ) : task.description && (
        <div className="flex flex-col gap-1 px-4 py-3">
          <span className="text-footnote text-ink-2">{t('taskSheet.description')}</span>
          <RichText body={task.description} />
        </div>
      )}
    </Group>
  );
}

/** The Details view of the task panel on a phone: groups of rows over the native pickers. */
export function PhoneDetails({ panel }: { panel: TaskPanel }) {
  const { t } = useTranslation();
  const { data, detail, task, viewerCan, canDetails, patch, files, canUndoAgent, helping, leave, saveTemplate, remove } = panel;
  // A new object on each render: the ages of the history read the clock on each key, as before the memo (RND-4).
  const refresh = {};
  return (
    <div className="flex flex-col gap-5">
      <People panel={panel} />
      <When panel={panel} />
      <DateNotes data={panel.data} />
      <ThisTodo panel={panel} />
      <Checklist rows key={panel.failures} task={panel.task} edit={panel.canDetails} tick={panel.viewerCan.contribute} onChange={(checklist) => panel.patch({ checklist })} draft={panel.checklistDraft} />
      <TaskFiles layout="rows" views={files} />
      {/* An office task waits for no task. */}
      {detail && <TaskNeeds layout="rows" data={data} canEdit={viewerCan.editAll && canDetails} onChange={(prerequisiteIds) => patch({ prerequisiteIds })} />}
      <TaskVersions layout="rows" task={task} />
      <AgeRefresh.Provider value={refresh}>
        <History layout="rows" data={data} canUndoAgent={canUndoAgent} />
      </AgeRefresh.Provider>
      {(viewerCan.saveTemplate || viewerCan.delete || helping) && (
        <div className="flex flex-col gap-3">
          {helping && <Button className="min-h-12 w-full" disabled={leave.isPending} onClick={() => leave.mutate({ taskId: task.id, help: false })}>{t('taskHelp.leave')}</Button>}
          {viewerCan.saveTemplate && (
            <Button className="min-h-12 w-full" disabled={saveTemplate.isPending} onClick={() => saveTemplate.mutate({ fromTaskId: task.id })}>{t('taskSheet.saveTemplate')}</Button>
          )}
          {viewerCan.delete && (
            <Button variant="destructive" className="min-h-12 w-full" disabled={remove.isPending} onClick={() => remove.mutate({ id: task.id })}>{t('taskSheet.delete')}</Button>
          )}
        </div>
      )}
    </div>
  );
}
