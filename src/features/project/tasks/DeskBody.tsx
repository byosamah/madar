import { useTranslation } from 'react-i18next';
import { AgeRefresh } from '../../../components/Age';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { Button } from '../../../components/Button';
import { SelectField, TextArea, TextField } from '../../../components/Fields';
import { RichText } from '../../../components/RichText';
import { Switch } from '../../../components/Switch';
import { TabPanel, Tabs } from '../../../components/Tabs';
import { BOARD_COLUMNS, moveTargets } from '../../../lib/board';
import { formatDay } from '../../../lib/dates';
import { CommentThread } from '../../comments/CommentThread';
import type { TaskStatus } from '../../../api/contract/entities';
import { DateNotes, TaskNeeds } from './TaskNeeds';
import { Checklist, Fact, History, TaskFiles } from './TaskParts';
import { personOption, TaskHelpers } from './TaskHelpers';
import { durationText, TaskTiming } from './TaskTiming';
import { NewVersion, TaskVersions } from './TaskVersions';
import type { TaskPanel } from './useTaskPanel';

/** The desk layout of the task panel: the same markup and ids as before the split. The phone has its own body (PhoneBody). */
export function DeskBody({ panel }: { panel: TaskPanel }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const {
    data, detail, task, viewerCan, noteFirst, canDetails, canDates, mayChange, root, reviewBlock, title, setTitle, description, setDescription, unsaved,
    note, setNote, patch, move, approve, sendBack, take, join, leave, remove, saveTemplate, newLead, leadJoins, people, choices, teamIds, makerId,
    helping, canUndoAgent, files, section, setSection, timingKey, failures, dates, back, checklistDraft,
  } = panel;
  // A new object on each render: the ages of the history read the clock on each key, as before the memo (RND-4).
  const refresh = {};
  return (
    <div ref={root} className="flex flex-col gap-5 pt-1">
      <Tabs
        label={t('taskSheet.sections')}
        idPrefix="task-section"
        value={section}
        onChange={setSection}
        options={[
          { value: 'details', label: t('taskSheet.details') },
          { value: 'conversation', label: data.commentCount > 0 ? t('taskSheet.conversationCount', { n: data.commentCount }) : t('taskSheet.conversation') },
        ]}
      />
      {section === 'conversation' ? (
        <TabPanel value="conversation" idPrefix="task-section">
          <CommentThread
            targetType="task" targetId={task.id} projectId={detail?.project.id ?? null} stageId={task.stageId} people={people}
            canPost={viewerCan.comment === true}
            canAttach={viewerCan.upload === true}
            everyone={data.everyone}
          />
        </TabPanel>
      ) : (
        <TabPanel value="details" idPrefix="task-section">
          <div className="flex flex-col gap-5">
            {/* An office task says who sees it (owner, 2026-10-06). */}
            {!detail && <p className="text-footnote text-label-2">{t('office.sheetNote')}</p>}
            {/* A team member who neither leads nor helps joins as a helper in one press, so their part shows on the task (fbk_035).
                The leader and the maker name helpers in the people fields, so they get no second way. */}
            {!mayChange && !viewerCan.take && (viewerCan.help && !viewerCan.editAll ? (
              <section aria-label={t('taskHelp.join')} className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
                <p className="text-footnote text-label-2">{t('taskHelp.hint')}</p>
                <Button disabled={join.isPending} onClick={() => join.mutate({ taskId: task.id, help: true })}>{t('taskHelp.join')}</Button>
              </section>
            ) : <p className="rounded-2xl bg-fill p-3 text-footnote text-label-2">{t(detail ? 'taskSheet.readOnly' : 'office.readOnly')}</p>)}
            {/* A task with no lead: one next step, Take it (owner, 2026-10-05). Nobody can finish the task before it has a lead. */}
            {viewerCan.take && (
              <section aria-label={t('lead.noLead')} className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
                <p className="text-footnote text-label-2">{t('lead.takeHint')}</p>
                <Button variant="primary" disabled={take.isPending} onClick={() => take.mutate({ taskId: task.id })}>{t('lead.takeIt')}</Button>
              </section>
            )}
            {/* For the person who reviews a task in review, Approve and Send back are the one next step, so they come first (audit 2026-10-03, PRJ-8). */}
            {/* After "Send back with a note" on the board, the note takes the focus, Send back is the main button and Approve
                steps back to the end (audit 2026-10-03, F-8). */}
            {viewerCan.review && (
              <section ref={reviewBlock} aria-label={t('taskSheet.review')} className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
                {!noteFirst && <Button variant="primary" disabled={approve.isPending} onClick={() => approve.mutate({ id: task.id })}>{t('taskSheet.approve')}</Button>}
                <TextArea id="task-note" label={t('taskSheet.sendBackNote')} value={note} dir="auto" onChange={(event) => setNote(event.target.value)} />
                <Button variant={noteFirst ? 'primary' : 'secondary'} disabled={!note.trim() || sendBack.isPending} onClick={() => sendBack.mutate({ id: task.id, note: note.trim() })}>{t('taskSheet.sendBack')}</Button>
                {noteFirst && <Button disabled={approve.isPending} onClick={() => approve.mutate({ id: task.id })}>{t('taskSheet.approve')}</Button>}
              </section>
            )}
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
                  {/* While the task waits for review, its lead gets the pull-back choices and no Done (audit 2026-10-03, F-19). */}
                  {BOARD_COLUMNS.filter((status) => status === task.status || moveTargets(task.status, false, task.needsReview, task.ownerId !== null).includes(status))
                    .map((status) => <option key={status} value={status}>{t(`taskStatus.${status}`)}</option>)}
                </SelectField>
              ) : <Fact label={t('taskSheet.status')}>{t(`taskStatus.${task.status}`)}</Fact>}
              {viewerCan.editAll ? (
                <SelectField
                  id="task-owner"
                  label={t('taskSheet.owner')}
                  value={task.ownerId ?? ''}
                  onChange={(event) => {
                    const next = event.target.value || null;
                    leadJoins.current = next !== null && !teamIds.has(next);
                    newLead.mutate({ id: task.id, patch: { ownerId: next } });
                  }}
                >
                  {/* "No lead" comes first (owner, 2026-10-05). A task in review or done keeps its lead, so it offers no "No lead". */}
                  {(task.ownerId === null || task.status === 'todo' || task.status === 'in_progress') && <option value="">{t('lead.noLead')}</option>}
                  {(data.owner && !choices.some((person) => person.id === task.ownerId) ? [...choices, data.owner] : choices)
                    .map((person) => <option key={person.id} value={person.id}>{personOption(person, teamIds.has(person.id), t)}</option>)}
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
                <Fact label={t('taskSheet.startDate')}>{task.startDate ? formatDay(task.startDate, lang, 'long') : t('overview.none')}</Fact>
                <Fact label={t('taskSheet.dueDate')}>{task.dueDate ? formatDay(task.dueDate, lang, 'long') : t('overview.none')}</Fact>
                {task.schedule === 'dynamic' && task.durationDays && <Fact label={t('taskSheet.duration')}>{durationText(task.durationDays, t)}</Fact>}
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
            {canDetails ? (
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
            ) : task.description && <Fact label={t('taskSheet.description')}><RichText body={task.description} /></Fact>}
            <Checklist key={failures} task={task} edit={canDetails} tick={viewerCan.contribute} onChange={(checklist) => patch({ checklist })} draft={checklistDraft} />
            <TaskVersions task={task} />
            <TaskFiles views={files} />
            <AgeRefresh.Provider value={refresh}>
              <History data={data} canUndoAgent={canUndoAgent} />
            </AgeRefresh.Provider>
            {(viewerCan.saveTemplate || viewerCan.delete || helping) && (
              <div className="flex flex-wrap gap-3">
                {helping && <Button disabled={leave.isPending} onClick={() => leave.mutate({ taskId: task.id, help: false })}>{t('taskHelp.leave')}</Button>}
                {viewerCan.saveTemplate && (
                  <Button disabled={saveTemplate.isPending} onClick={() => saveTemplate.mutate({ fromTaskId: task.id })}>{t('taskSheet.saveTemplate')}</Button>
                )}
                {viewerCan.delete && (
                  <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate({ id: task.id })}>{t('taskSheet.delete')}</Button>
                )}
              </div>
            )}
          </div>
        </TabPanel>
      )}
      {back.sheet}
      {dates.sheet}
    </div>
  );
}
