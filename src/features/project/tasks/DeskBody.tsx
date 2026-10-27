import { useTranslation } from 'react-i18next';
import { AgeRefresh } from '../../../components/Age';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { SelectField, TextField } from '../../../components/Fields';
import { RichText } from '../../../components/RichText';
import { Switch } from '../../../components/Switch';
import { TabPanel, Tabs } from '../../../components/Tabs';
import type { TaskStatus } from '../../../api/contract/entities';
import { DateNotes, TaskNeeds } from './TaskNeeds';
import { Checklist, Fact, History, TaskFiles } from './TaskParts';
import { ConversationView, sectionOptions } from './Conversation';
import { JoinBlock, ReviewBlock, TakeBlock, type StepLook } from './StepBlocks';
import { TaskHelpers } from './TaskHelpers';
import { DescriptionField, FooterActions, readOnlyDates } from './TaskPanelParts';
import { TaskTiming } from './TaskTiming';
import { NewVersion, TaskVersions } from './TaskVersions';
import type { TaskPanel } from './useTaskPanel';

const LOOK: StepLook = { variant: 'primary', hint: 'text-footnote text-label-2' };

/** The desk layout of the task panel: the same markup and ids as before the split. The phone has its own body (PhoneBody). */
export function DeskBody({ panel }: { panel: TaskPanel }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const {
    data, detail, task, viewerCan, canDetails, canDates, mayChange, root, title, setTitle, patch, move, changeLead, statusOptions, ownerOptions,
    choices, teamIds, makerId, canUndoAgent, files, section, setSection, timingKey, failures, dates, back, checklistDraft,
  } = panel;
  const readOnly = readOnlyDates(task, lang, t);
  // A new object on each render: the ages of the history read the clock on each key, as before the memo (RND-4).
  const refresh = {};
  return (
    <div ref={root} className="flex flex-col gap-5 pt-1">
      <Tabs
        label={t('taskSheet.sections')}
        idPrefix="task-section"
        value={section}
        onChange={setSection}
        options={sectionOptions(t, data.commentCount)}
      />
      {section === 'conversation' ? (
        <TabPanel value="conversation" idPrefix="task-section">
          <ConversationView panel={panel} />
        </TabPanel>
      ) : (
        <TabPanel value="details" idPrefix="task-section">
          <div className="flex flex-col gap-5">
            {/* An office task says who sees it (owner, 2026-10-06). */}
            {!detail && <p className="text-footnote text-label-2">{t('office.sheetNote')}</p>}
            {/* A team member who neither leads nor helps joins as a helper in one press, so their part shows on the task (fbk_035).
                The leader and the maker name helpers in the people fields, so they get no second way. */}
            {!mayChange && !viewerCan.take && (viewerCan.help ? <JoinBlock panel={panel} look={LOOK} /> : <p className="rounded-2xl bg-fill p-3 text-footnote text-label-2">{t(detail ? 'taskSheet.readOnly' : 'office.readOnly')}</p>)}
            {viewerCan.take && <TakeBlock panel={panel} look={LOOK} />}
            {viewerCan.review && <ReviewBlock panel={panel} look={LOOK} />}
            {canDetails ? (
              <TextField
                id="task-title"
                label={t('taskSheet.title')}
                value={title}
                dir="auto"
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => {
                  if (title.trim() && title.trim() !== task.title) patch({ title: title.trim() });
                }}
              />
            ) : <Fact label={t('taskSheet.title')}><bdi>{task.title}</bdi></Fact>}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* The reviewer finishes or returns a task in review with Approve or Send back only, so the Status menu hides (audit 2026-10-03, PRJ-2). */}
              {data.canMove && !viewerCan.review ? (
                <SelectField id="task-status" label={t('taskSheet.status')} value={task.status} onChange={(event) => move.mutate({ id: task.id, status: event.target.value as TaskStatus })}>
                  {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </SelectField>
              ) : <Fact label={t('taskSheet.status')}>{t(`taskStatus.${task.status}`)}</Fact>}
              {viewerCan.editAll ? (
                <SelectField
                  id="task-owner"
                  label={t('taskSheet.owner')}
                  value={task.ownerId ?? ''}
                  onChange={(event) => changeLead(event.target.value || null)}
                >
                  {ownerOptions.showNoLead && <option value="">{t('lead.noLead')}</option>}
                  {ownerOptions.people.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </SelectField>
              ) : <Fact label={t('taskSheet.owner')}>{data.owner ? <bdi>{nameOf(data.owner)}</bdi> : t('lead.noLead')}</Fact>}
              {/* An office task has no stage. A stage name is long, so the field takes a full row from 640 px up (its first letters were cut in Arabic). */}
              {detail && (canDetails ? (
                <SelectField id="task-stage" className="sm:col-span-2" label={t('taskSheet.stage')} value={task.stageId ?? ''} onChange={(event) => patch({ stageId: event.target.value })}>
                  {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                </SelectField>
              ) : <Fact label={t('taskSheet.stage')}><bdi>{data.stage?.name ?? ''}</bdi></Fact>)}
            </div>
            <TaskHelpers
              helpers={data.helpers}
              leadId={task.ownerId}
              people={choices}
              teamIds={teamIds}
              canEdit={viewerCan.editAll}
              onChange={(helperIds) => patch({ helperIds })}
              // Only the leader and the Admin add a person to the team from this list, so only they read that a person joins it.
              hint={detail?.viewerCan.editTeam ? undefined : t('office.helpersHint')}
            />
            {/* An office task waits for no task. */}
            {detail && <TaskNeeds data={data} canEdit={viewerCan.editAll && canDetails} onChange={(prerequisiteIds) => patch({ prerequisiteIds })} />}
            {viewerCan.newVersion && <NewVersion key={task.version ?? 1} task={task} />}
            {canDates ? (
              <TaskTiming
                key={`${timingKey}-${failures}`}
                idPrefix="task"
                value={{ startDate: task.startDate ?? null, schedule: task.schedule ?? 'static', durationDays: task.durationDays ?? null, dueDate: task.dueDate }}
                onPatch={patch}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Fact label={t('taskSheet.startDate')}>{readOnly.start}</Fact>
                <Fact label={t('taskSheet.dueDate')}>{readOnly.due}</Fact>
                {readOnly.duration && <Fact label={t('taskSheet.duration')}>{readOnly.duration}</Fact>}
              </div>
            )}
            <DateNotes data={data} />
            {canDetails
              ? <Switch id="task-flag" label={t('taskSheet.flag')} description={t('taskSheet.flagHint')} checked={task.flagged} onChange={(on) => patch({ flagged: on })} />
              : task.flagged && <p className="inline-flex items-center gap-2 text-subheadline text-attn"><AnimatedIcon icon={BadgeAlertIcon} size={14} aria-hidden />{t('tasks.flagged')}</p>}
            {/* The maker reviews an office task, so a task that its maker leads has no review to turn on (owner, 2026-10-06). On a
                project task the review need belongs to the leader, never to the maker (owner, 2026-10-07). */}
            {viewerCan.setNeedsReview && (detail || task.ownerId !== makerId) && (
              <Switch
                id="task-review" label={t('taskSheet.needsReview')} description={t(detail ? 'taskSheet.needsReviewHint' : 'office.needsReviewHint')}
                checked={task.needsReview} onChange={(on) => patch({ needsReview: on })}
              />
            )}
            {canDetails ? <DescriptionField panel={panel} /> : task.description && <Fact label={t('taskSheet.description')}><RichText body={task.description} /></Fact>}
            <Checklist key={failures} task={task} edit={canDetails} tick={viewerCan.contribute} onChange={(checklist) => patch({ checklist })} draft={checklistDraft} />
            <TaskVersions task={task} />
            <TaskFiles views={files} />
            <AgeRefresh.Provider value={refresh}>
              <History data={data} canUndoAgent={canUndoAgent} />
            </AgeRefresh.Provider>
            <FooterActions panel={panel} className="flex flex-wrap gap-3" />
          </div>
        </TabPanel>
      )}
      {back.sheet}
      {dates.sheet}
    </div>
  );
}
