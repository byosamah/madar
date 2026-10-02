import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CircleCheckIcon } from '../../../components/icons/animated/circle-check';
import { XIcon } from '../../../components/icons/animated/x';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import type { ChecklistItem, Task, TaskStatus } from '../../../api/contract/entities';
import type { ProjectDetail, TaskDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { SelectField, TextArea, TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { RichText } from '../../../components/RichText';
import { Sheet } from '../../../components/Sheet';
import { Switch } from '../../../components/Switch';
import { TabPanel, Tabs } from '../../../components/Tabs';
import { BOARD_COLUMNS } from '../../../lib/board';
import { formatDay, formatNumber } from '../../../lib/dates';
import { CommentThread } from '../../comments/CommentThread';
import { useFocusLink } from '../../focus/focusLink';
import { historyText } from './history';
import { useStageBack } from './StageBack';
import { DateNotes, TaskNeeds } from './TaskNeeds';
import { personOption, TaskHelpers } from './TaskHelpers';
import { durationText, TaskTiming } from './TaskTiming';
import { NewVersion, TaskVersions } from './TaskVersions';
import { CircleIcon } from '../../../components/icons/animated/circle';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';
import { TimerIcon } from '../../../components/icons/animated/timer';

type Patch = Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'startDate' | 'schedule' | 'durationDays' | 'stageId' | 'ownerId' | 'helperIds' | 'prerequisiteIds' | 'flagged' | 'needsReview' | 'checklist'>>;

/** A label and a value as plain text, for a field the viewer cannot change (spec 2.3: no dead controls). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-footnote text-label-2">{label}</span>
      <span className="min-h-11 py-2 text-body">{children}</span>
    </div>
  );
}

/** edit: add, remove and tick. tick: a helper ticks only. Otherwise the list is plain text. */
function Checklist({ task, edit, tick, onChange }: { task: Task; edit: boolean; tick: boolean; onChange: (items: ChecklistItem[]) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  // A local copy, so two quick ticks build on each other before the saved list comes back.
  const [items, setItems] = useState(task.checklist);
  const saved = JSON.stringify(task.checklist);
  useEffect(() => {
    setItems(JSON.parse(saved) as ChecklistItem[]);
  }, [saved]);
  const change = (next: ChecklistItem[]) => {
    setItems(next);
    onChange(next);
  };
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-headline">{t('taskSheet.checklist')}</h3>
      <ul>
        {!edit && !tick && items.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-3">
            {item.done ? <AnimatedIcon icon={CircleCheckIcon} size={20} className="shrink-0 text-link" aria-hidden /> : <AnimatedIcon icon={CircleIcon} size={20} className="shrink-0 text-label-3" aria-hidden />}
            <span dir="auto" className={`min-w-0 flex-1 ${item.done ? 'text-label-2 line-through' : ''}`}>{item.text}</span>
            {item.done && <span className="sr-only">{t('common.done')}</span>}
          </li>
        ))}
        {(edit || tick) && items.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              aria-label={item.text}
              className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
              checked={item.done}
              onChange={(event) => change(items.map((i) => (i.id === item.id ? { ...i, done: event.target.checked } : i)))}
            />
            <span dir="auto" className={`min-w-0 flex-1 ${item.done ? 'text-label-2 line-through' : ''}`}>{item.text}</span>
            {edit && (
              <IconButton label={t('taskSheet.removeItem', { text: item.text })} onClick={() => change(items.filter((i) => i.id !== item.id))}>
                <AnimatedIcon icon={XIcon} size={16} aria-hidden />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {edit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            if (!value) return;
            const id = `chk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            change([...items, { id, text: value, done: false }]);
            setText('');
          }}
        >
          <input
            aria-label={t('taskSheet.addItem')}
            placeholder={t('taskSheet.addItem')}
            value={text}
            dir="auto"
            onChange={(event) => setText(event.target.value)}
            className="field"
          />
        </form>
      )}
    </section>
  );
}

function History({ data, canUndoAgent }: { data: TaskDetail; canUndoAgent: (actingForId: string) => boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const undo = useAction('events.undo', { onSuccess: () => toast.show({ message: t('taskSheet.undone') }) });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-headline">{t('taskSheet.history')}</h3>
      {data.history.length === 0 ? <p className="text-footnote text-label-2">{t('taskSheet.noHistory')}</p> : (
        <ol className="flex flex-col gap-2">
          {data.history.map(({ event, actor }) => (
            <li key={event.id} className="flex items-center gap-2 text-footnote">
              <Avatar user={actor} size={24} />
              <p className="min-w-0 flex-1">
                <bdi className="font-semibold">{actor.name}</bdi>{' '}
                {actor.kind === 'agent' && <><AgentLabel />{' '}</>}
                <span className="text-label-2">{historyText(event, t, lang, actor.gender)}</span>
              </p>
              <span className="shrink-0 text-caption text-label-2"><Age stamp={event.createdAt} /></span>
              {event.actorKind === 'agent' && !event.undoneBy && event.verb !== 'undo' && canUndoAgent(event.actingForId) && (
                <Button variant="plain" onClick={() => undo.mutate({ eventId: event.id })}>{t('taskSheet.undoAgent')}</Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TaskBody({ detail, data, onClose }: { detail: ProjectDetail; data: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const toast = useToast();
  const session = useCall('session.get', {});
  const files = useCall('files.list', { projectId: detail.project.id, taskId: data.task.id });
  const { task, viewerCan } = data;
  // Reopening a task, or moving it into an earlier stage, can move the project back. The server then asks why (owner, 2026-10-02).
  const back = useStageBack();
  const update = useAction('tasks.update', { onRefused: (error, input) => back.refused(error, input, (next) => update.mutate(next)) });
  const move = useUndoable('tasks.move', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.moved', { status: t(`taskStatus.${output.result}`) })),
    onRefused: (error, input) => back.refused(error, input, (next) => move.mutate(next)),
  });
  const approve = useAction('tasks.approve', { onSuccess: () => toast.show({ message: t('taskSheet.approved') }) });
  const sendBack = useAction('tasks.sendBack', {
    onSuccess: () => {
      setNote('');
      toast.show({ message: t('taskSheet.sentBack') });
    },
  });
  const remove = useUndoable('tasks.delete', { message: () => t('taskSheet.deleted'), onSuccess: onClose });
  const saveTemplate = useAction('taskTemplates.save', { onSuccess: (template) => toast.show({ message: t('taskSheet.templateSaved', { stage: template.stageName }) }) });
  const everyone = useCall('users.list', {});
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [note, setNote] = useState('');
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
  }, [task.title, task.description]);

  const patch = (changes: Patch) => update.mutate({ id: task.id, patch: changes });
  const edit = viewerCan.edit;
  const people = detail.members.map((member) => member.user);
  if (!people.some((person) => person.id === data.owner.id)) people.push(data.owner);
  // The leader and the Admin may pick anyone active. A person outside the team joins it when picked (colleague comment 9).
  const teamIds = new Set([...people.map((person) => person.id), ...(detail.leader ? [detail.leader.id] : [])]);
  const pickable = (everyone.data ?? []).filter((person) => person.kind === 'human');
  const me = session.data?.authority.id;
  const canUndoAgent = (actingForId: string) => detail.viewerCan.review || actingForId === me;
  // The task's own conversation sits one press away, beside its details (owner's request, 2026-10-01). The choice lives in the link.
  const [params, setParams] = useSearchParams();
  const section = params.get('thread') === '1' ? 'conversation' : 'details';
  const setSection = (next: 'details' | 'conversation') => setParams((current) => {
    const value = new URLSearchParams(current);
    if (next === 'conversation') value.set('thread', '1');
    else value.delete('thread');
    return value;
  }, { replace: true });

  return (
    <div className="flex flex-col gap-5 pt-1">
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
          <CommentThread targetType="task" targetId={task.id} projectId={detail.project.id} stageId={task.stageId} people={people} canPost={detail.viewerCan.post} />
        </TabPanel>
      ) : (
        <TabPanel value="details" idPrefix="task-section">
          <div className="flex flex-col gap-5">
            {!edit && <p className="rounded-2xl bg-fill p-3 text-footnote text-label-2">{t('taskSheet.readOnly')}</p>}
            {edit ? (
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
              {data.canMove ? (
                <SelectField id="task-status" label={t('taskSheet.status')} value={task.status} onChange={(event) => move.mutate({ id: task.id, status: event.target.value as TaskStatus })}>
                  {BOARD_COLUMNS.map((status) => <option key={status} value={status}>{t(`taskStatus.${status}`)}</option>)}
                </SelectField>
              ) : <Fact label={t('taskSheet.status')}>{t(`taskStatus.${task.status}`)}</Fact>}
              {viewerCan.editAll ? (
                <SelectField id="task-owner" label={t('taskSheet.owner')} value={task.ownerId} onChange={(event) => patch({ ownerId: event.target.value })}>
                  {(pickable.some((person) => person.id === task.ownerId) ? pickable : [...pickable, data.owner]).map((person) => <option key={person.id} value={person.id}>{personOption(person, teamIds.has(person.id), t)}</option>)}
                </SelectField>
              ) : <Fact label={t('taskSheet.owner')}><bdi>{data.owner.name}</bdi></Fact>}
              {edit ? (
                <SelectField id="task-stage" label={t('taskSheet.stage')} value={task.stageId} onChange={(event) => patch({ stageId: event.target.value })}>
                  {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                </SelectField>
              ) : <Fact label={t('taskSheet.stage')}><bdi>{data.stage.name}</bdi></Fact>}
            </div>
            <TaskHelpers
              helpers={data.helpers}
              leadId={task.ownerId}
              people={pickable}
              teamIds={teamIds}
              canEdit={viewerCan.editAll}
              onChange={(helperIds) => patch({ helperIds })}
            />
            <TaskNeeds data={data} canEdit={viewerCan.editAll} onChange={(prerequisiteIds) => patch({ prerequisiteIds })} />
            {viewerCan.newVersion && <NewVersion key={task.version ?? 1} task={task} />}
            {edit ? (
              <TaskTiming
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
            {edit
              ? <Switch id="task-flag" label={t('taskSheet.flag')} description={t('taskSheet.flagHint')} checked={task.flagged} onChange={(on) => patch({ flagged: on })} />
              : task.flagged && <p className="inline-flex items-center gap-2 text-subheadline text-attn"><AnimatedIcon icon={BadgeAlertIcon} size={14} aria-hidden />{t('tasks.flagged')}</p>}
            {viewerCan.editAll && (
              <Switch id="task-review" label={t('taskSheet.needsReview')} description={t('taskSheet.needsReviewHint')} checked={task.needsReview} onChange={(on) => patch({ needsReview: on })} />
            )}
            {viewerCan.review && (
              <section aria-label={t('taskSheet.review')} className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
                <Button variant="primary" disabled={approve.isPending} onClick={() => approve.mutate({ id: task.id })}>{t('taskSheet.approve')}</Button>
                <TextArea id="task-note" label={t('taskSheet.sendBackNote')} value={note} dir="auto" onChange={(event) => setNote(event.target.value)} />
                <Button disabled={!note.trim() || sendBack.isPending} onClick={() => sendBack.mutate({ id: task.id, note: note.trim() })}>{t('taskSheet.sendBack')}</Button>
              </section>
            )}
            {edit ? (
              <TextArea
                id="task-description"
                label={t('taskSheet.description')}
                value={description}
                dir="auto"
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => {
                  if (description !== task.description) patch({ description });
                }}
              />
            ) : task.description && <Fact label={t('taskSheet.description')}><RichText body={task.description} /></Fact>}
            <Checklist task={task} edit={edit} tick={viewerCan.contribute && !edit} onChange={(checklist) => patch({ checklist })} />
            <TaskVersions task={task} />
            <section className="flex flex-col gap-1">
              <h3 className="text-headline">{t('taskSheet.files')}</h3>
              {(files.data ?? []).length === 0
                ? <p className="text-footnote text-label-2">{t('taskSheet.noFiles')}</p>
                : <ul>{(files.data ?? []).map((view) => <li key={view.file.id} className="text-subheadline"><bdi>{view.file.name}</bdi></li>)}</ul>}
            </section>
            <History data={data} canUndoAgent={canUndoAgent} />
            {(viewerCan.saveTemplate || viewerCan.delete) && (
              <div className="flex flex-wrap gap-3">
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
    </div>
  );
}

/** The task panel: a side panel with no dim layer on desktop, a sheet on a phone (spec 5.4). */
export function TaskSheet({ taskId, detail, onClose }: { taskId: string; detail: ProjectDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const task = useCall('tasks.get', { id: taskId });
  const focus = useFocusLink();
  useEffect(() => {
    if (task.error) onClose();
  }, [task.error, onClose]);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={task.data?.task.title ?? ''}
      blocking={false}
      headerAction={(
        <button type="button" onClick={() => focus.open(taskId)} className="pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-fill px-4 text-subheadline font-semibold text-ink hover:bg-fill-strong">
          <AnimatedIcon icon={TimerIcon} size={16} aria-hidden />
          {t('focus.open')}
        </button>
      )}
    >
      {task.data && <TaskBody detail={detail} data={task.data} onClose={onClose} />}
    </Sheet>
  );
}

/** The task panel outside its project screen, for example over My Work. */
export function ProjectTaskSheet({ projectId, taskId, onClose }: { projectId: string; taskId: string; onClose: () => void }) {
  const detail = useCall('projects.get', { id: projectId });
  if (!detail.data) return null;
  return <TaskSheet taskId={taskId} detail={detail.data} onClose={onClose} />;
}
