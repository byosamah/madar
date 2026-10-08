import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CircleCheckIcon } from '../../../components/icons/animated/circle-check';
import { XIcon } from '../../../components/icons/animated/x';
import { memo, useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import type { ChecklistItem, Task, TaskStatus } from '../../../api/contract/entities';
import type { FileView, ProjectDetail, TaskDetail } from '../../../api/contract/views';
import { ApiError } from '../../../api/errors';
import { useUndoable } from '../../../app/actions';
import { downloadFile } from '../../../app/files';
import { useLang } from '../../../app/lang';
import { usePersonName } from '../../../app/personName';
import { useAction, useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Age, AgeRefresh } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { SelectField, TextArea, TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { LoadFailed } from '../../../components/LoadFailed';
import { RichText } from '../../../components/RichText';
import { focusLost, Sheet } from '../../../components/Sheet';
import { Switch } from '../../../components/Switch';
import { TabPanel, Tabs } from '../../../components/Tabs';
import { BOARD_COLUMNS, moveTargets } from '../../../lib/board';
import { formatDay, formatNumber } from '../../../lib/dates';
import { actorContext } from '../../../lib/grammar';
import { CommentThread } from '../../comments/CommentThread';
import { canPreview, PreviewSheet } from '../files/PreviewSheet';
import { useFocusLink } from '../../focus/focusLink';
import { historyText } from './history';
import { useDateReason } from './DateReason';
import { useStageBack } from './StageBack';
import { DateNotes, TaskNeeds } from './TaskNeeds';
import { personOption, TaskHelpers } from './TaskHelpers';
import { durationText, TaskTiming } from './TaskTiming';
import { NewVersion, TaskVersions } from './TaskVersions';
import { CircleIcon } from '../../../components/icons/animated/circle';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';
import { TimerIcon } from '../../../components/icons/animated/timer';
import { AttachFileIcon } from '../../../components/icons/animated/attach-file';
import { TASK_PANEL, usePanelLink } from '../panelLink';
import { useQueryClient } from '@tanstack/react-query';

type Patch = Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'startDate' | 'schedule' | 'durationDays' | 'ownerId' | 'helperIds' | 'prerequisiteIds' | 'flagged' | 'needsReview' | 'checklist'>> & { stageId?: string };

/** A label and a value as plain text, for a field the viewer cannot change (spec 2.3: no dead controls). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-footnote text-label-2">{label}</span>
      <span className="min-h-11 py-2 text-body">{children}</span>
    </div>
  );
}

/** What the person typed in "Add an item", with the list it goes into, so the panel can save it when it closes. */
type ChecklistDraft = { text: string; items: ChecklistItem[] };
const newItemId = () => `chk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** edit: add, remove and tick. tick: a helper ticks only. Otherwise the list is plain text. */
function Checklist({ task, edit, tick, onChange, draft }: { task: Task; edit: boolean; tick: boolean; onChange: (items: ChecklistItem[]) => void; draft: MutableRefObject<ChecklistDraft> }) {
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
  useEffect(() => {
    draft.current = { text, items };
  }, [draft, text, items]);
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
            change([...items, { id: newItemId(), text: value, done: false }]);
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

/** One empty list for a task with no files yet, so the memo of TaskFiles holds while the list loads. */
const EMPTY_FILES: FileView[] = Object.freeze([]) as unknown as FileView[];

/**
 * The files of the task, one press each: a picture or a PDF opens the preview, any other file saves (audit 2026-10-03, PRJ-24).
 * Memoized, as History, so a key in the title, the description or the note renders it again only when its files change
 * (performance audit 2026-10-07, RND-4).
 */
const TaskFiles = memo(function TaskFiles({ views }: { views: FileView[] }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const [preview, setPreview] = useState<FileView | null>(null);
  const open = (view: FileView) => {
    if (canPreview(view.latest.mimeType)) setPreview(view);
    else downloadFile(api, view.file.id).catch((error: unknown) => toast.failed(error));
  };
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-headline">{t('taskSheet.files')}</h3>
      {views.length === 0 ? <p className="text-footnote text-label-2">{t('taskSheet.noFiles')}</p> : (
        <ul className="flex flex-wrap gap-2">
          {views.map((view) => (
            <li key={view.file.id}>
              <button
                type="button"
                aria-label={t('taskSheet.openFile', { name: view.file.name })}
                onClick={() => open(view)}
                className="pressable inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-fill px-3 text-footnote text-ink hover:bg-fill-strong"
              >
                <AnimatedIcon icon={AttachFileIcon} size={14} aria-hidden className="shrink-0" />
                <bdi className="truncate">{view.file.name}</bdi>
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && <PreviewSheet views={[preview]} index={0} onIndex={() => undefined} onClose={() => setPreview(null)} />}
    </section>
  );
});

/** Memoized (RND-4): it renders again when the task data or the Undo rule changes. Its ages refresh through AgeRefresh. */
const History = memo(function History({ data, canUndoAgent }: { data: TaskDetail; canUndoAgent: (actingForId: string) => boolean }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
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
                <bdi className="font-semibold">{nameOf(actor)}</bdi>{' '}
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
});

/** detail is null for an office task, which has no project (owner, 2026-10-06): no stage, no prerequisites, no team. */
function TaskBody({ detail, data, onClose, noteFirst }: { detail: ProjectDetail | null; data: TaskDetail; onClose: () => void; noteFirst: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const navigate = useNavigate();
  const toast = useToast();
  const session = useCall('session.get', {});
  const files = useCall('files.list', detail ? { projectId: detail.project.id, taskId: data.task.id } : { taskId: data.task.id });
  const { task, viewerCan } = data;
  // Reopening a task, or moving it into an earlier stage, can move the project back. The server then asks why (owner, 2026-10-02).
  const back = useStageBack();
  // Moving the dates asks why, and the reason goes to the Conversation (owner, 2026-10-02). Cancel puts the date fields back.
  const [timingKey, setTimingKey] = useState(0);
  const dates = useDateReason(() => setTimingKey((key) => key + 1), `dateReason:${task.id}`);
  // A failed or refused save puts the dates and the checklist back to the saved values; the toast still says why (audit 2026-10-03, PRJ-7).
  const [failures, setFailures] = useState(0);
  const update = useAction('tasks.update', {
    onRefused: (error, input) => {
      if (dates.refused(error, input, (next) => update.mutate(next)) || back.refused(error, input, (next) => update.mutate(next))) return true;
      // A failed save with a date reason opens the reason sheet again with the typed reason (audit 2026-10-03, BRW-6). The toast
      // still says why, but with no Retry: the sheet's Save dates is the one place to try again (audit 2026-10-03, V-14).
      if (dates.retry(input, (next) => update.mutate(next))) {
        toast.failed(error);
        return true;
      }
      // The title goes back to the saved one. A description keeps the typed text, marked "Not saved", so no work is lost (audit 2026-10-03, BRW-6).
      if (input.patch.title !== undefined) setTitle(task.title);
      if (input.patch.description !== undefined) setUnsaved(true);
      sent.current = {};
      setFailures((count) => count + 1);
      return false;
    },
  });
  const move = useUndoable('tasks.move', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.moved', { status: t(`taskStatus.${output.result}`) })),
    onRefused: (error, input) => back.refused(error, input, (next) => move.mutate(next)),
  });
  // The Review block goes away after Approve or Send back, and the pressed button goes with it. The focus then goes to the
  // panel, so a keyboard keeps its place and the next Tab stays in the panel (audit 2026-10-03, F-8 repair).
  const root = useRef<HTMLDivElement>(null);
  const reviewBlock = useRef<HTMLElement>(null);
  const keepFocus = () => {
    if (focusLost(reviewBlock.current)) root.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
  };
  // Approve offers Undo, as Send to review does: a mis-press is one tap to put back (audit 2026-10-03, BRW-5).
  const approve = useUndoable('tasks.approve', { message: () => t('taskSheet.approved'), onSuccess: keepFocus });
  const sendBack = useAction('tasks.sendBack', {
    onSuccess: () => {
      setNote('');
      keepFocus();
      toast.show({ message: t('taskSheet.sentBack') });
    },
  });
  const deleted = useRef(false);
  // A new lead gets the usual Undo toast. It also says when the person joined the team, and one Undo takes back both
  // (audit 2026-10-03, F-22).
  const leadJoins = useRef(false);
  const newLead = useUndoable('tasks.update', {
    message: (output) => (output.owner
      ? t(leadJoins.current ? 'taskSheet.newLeadJoined' : 'taskSheet.newLead', { name: nameOf(output.owner), context: actorContext(output.owner) })
      : t('lead.removed')),
  });
  // A person on the team takes a task with no lead in one press, and Undo gives it back (owner, 2026-10-05).
  const take = useUndoable('tasks.take', { message: () => t('lead.taken') });
  const remove = useUndoable('tasks.delete', {
    message: () => t('taskSheet.deleted'),
    onSuccess: () => {
      deleted.current = true;
      onClose();
    },
  });
  const saveTemplate = useAction('taskTemplates.save', { onSuccess: (template) => toast.show({ message: t('taskSheet.templateSaved', { stage: template.stageName }) }) });
  const everyone = useCall('users.list', {});
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [unsaved, setUnsaved] = useState(false);
  const [note, setNote] = useState('');
  // The title and the description that went to the server and did not come back yet, so a close does not send them twice.
  const sent = useRef<{ title?: string; description?: string }>({});
  const checklistDraft = useRef<ChecklistDraft>({ text: '', items: task.checklist });
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setUnsaved(false);
    sent.current = {};
  }, [task.title, task.description]);

  const patch = (changes: Patch) => {
    if (changes.title !== undefined) sent.current.title = changes.title;
    if (changes.description !== undefined) sent.current.description = changes.description;
    update.mutate({ id: task.id, patch: changes });
  };
  const edit = viewerCan.edit;
  // Escape, a tap outside on a phone, Back and another task close the panel before a field loses the focus. So the panel saves
  // what the person typed when it closes, by any way, as the X button always did (audit 2026-10-03, F-15).
  // The save goes only as the person who typed, and only for a task that is still there. A change of person (Preview as) and a
  // task deleted by someone else also close the panel (review 2026-10-03, V-22).
  const queryClient = useQueryClient();
  const typedBy = useRef<string | undefined>(undefined);
  typedBy.current ??= session.data?.user.id;
  const saveTyped = useRef<() => void>(() => undefined);
  saveTyped.current = () => {
    if (!edit || deleted.current) return;
    const person = queryClient.getQueryData<{ user: { id: string } }>(['api', 'session.get', {}])?.user.id;
    const taskError = queryClient.getQueryState(['api', 'tasks.get', { id: task.id }])?.error;
    if (person !== typedBy.current || (taskError instanceof ApiError && taskError.code === 'not_found')) return;
    const changes: Patch = {};
    if (title.trim() && title.trim() !== (sent.current.title ?? task.title)) changes.title = title.trim();
    if (description !== (sent.current.description ?? task.description)) changes.description = description;
    const item = checklistDraft.current.text.trim();
    if (item) changes.checklist = [...checklistDraft.current.items, { id: newItemId(), text: item, done: false }];
    if (Object.keys(changes).length > 0) update.mutate({ id: task.id, patch: changes });
  };
  useEffect(() => () => saveTyped.current(), []);
  // autoFocus works only when the panel mounts. The panel of the same task stays mounted when the person picks "Send back with
  // a note" on its card, so an effect moves the focus each time noteFirst turns on (audit 2026-10-03, F-8 repair).
  useEffect(() => {
    if (noteFirst && viewerCan.review) reviewBlock.current?.querySelector<HTMLElement>('#task-note')?.focus();
  }, [noteFirst, viewerCan.review]);
  const pickable = (everyone.data ?? []).filter((person) => person.kind === 'human');
  // An office task has no team: its people are its maker, its lead and its helpers, and only they read its Conversation.
  const maker = everyone.data?.find((person) => person.id === data.task.createdBy);
  const makerId = maker?.kind === 'agent' && maker.ownerId ? maker.ownerId : data.task.createdBy;
  const officePeople = pickable.filter((person) => person.id === makerId || person.id === data.task.ownerId || data.helpers.some((helper) => helper.id === person.id));
  const people = detail ? detail.members.map((member) => member.user) : officePeople;
  if (data.owner && !people.some((person) => person.id === data.owner?.id)) people.push(data.owner);
  // The leader and the Admin may pick anyone active. A person outside the team joins it when picked (colleague comment 9).
  // An office task has no team, so nobody joins one.
  const teamIds = detail ? new Set([...people.map((person) => person.id), ...(detail.leader ? [detail.leader.id] : [])]) : new Set(pickable.map((person) => person.id));
  // The maker of a task who is not the leader picks only from the team: only the leader and the Admin add a person to it
  // (owner, 2026-10-07).
  const choices = detail && !detail.viewerCan.edit ? pickable.filter((person) => teamIds.has(person.id)) : pickable;
  const me = session.data?.authority.id;
  const canUndoAgent = useCallback(
    (actingForId: string) => (detail ? detail.viewerCan.review : viewerCan.editAll) || actingForId === me,
    [detail, viewerCan.editAll, me],
  );
  // A new object on each render: the ages of the history read the clock on each key, as before the memo (RND-4).
  const refresh = {};
  // The task's own conversation sits one press away, beside its details (owner's request, 2026-10-01). The choice lives in the link.
  const [params] = useSearchParams();
  const panel = usePanelLink(TASK_PANEL);
  const section = params.get('thread') === '1' ? 'conversation' : 'details';
  // The panel is open, so the choice replaces the link and keeps the history step of the panel (audit 2026-10-03, V-36).
  const setSection = (next: 'details' | 'conversation') => panel.open({ thread: next === 'conversation' ? '1' : null });

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
            canPost={detail ? detail.viewerCan.post : viewerCan.contribute}
          />
        </TabPanel>
      ) : (
        <TabPanel value="details" idPrefix="task-section">
          <div className="flex flex-col gap-5">
            {/* An office task says who sees it (owner, 2026-10-06). */}
            {!detail && <p className="text-footnote text-label-2">{t('office.sheetNote')}</p>}
            {!edit && !viewerCan.take && <p className="rounded-2xl bg-fill p-3 text-footnote text-label-2">{t(detail ? 'taskSheet.readOnly' : 'office.readOnly')}</p>}
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
              {/* An office task has no stage. */}
              {detail && (edit ? (
                <SelectField id="task-stage" label={t('taskSheet.stage')} value={task.stageId ?? ''} onChange={(event) => patch({ stageId: event.target.value })}>
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
              hint={detail?.viewerCan.edit ? undefined : t('office.helpersHint')}
            />
            {/* An office task waits for no task. */}
            {detail && <TaskNeeds data={data} canEdit={viewerCan.editAll} onChange={(prerequisiteIds) => patch({ prerequisiteIds })} />}
            {viewerCan.newVersion && <NewVersion key={task.version ?? 1} task={task} />}
            {edit ? (
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
            {edit
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
            {edit ? (
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
            <Checklist key={failures} task={task} edit={edit} tick={viewerCan.contribute && !edit} onChange={(checklist) => patch({ checklist })} draft={checklistDraft} />
            <TaskVersions task={task} />
            <TaskFiles views={files.data ?? EMPTY_FILES} />
            <AgeRefresh.Provider value={refresh}>
              <History data={data} canUndoAgent={canUndoAgent} />
            </AgeRefresh.Provider>
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
      {dates.sheet}
    </div>
  );
}

/** The task panel: a side panel with no dim layer on desktop, a sheet on a phone (spec 5.4). detail is null for an office task. */
export function TaskSheet({ taskId, detail, onClose, noteFirst = false }: { taskId: string; detail: ProjectDetail | null; onClose: () => void; noteFirst?: boolean }) {
  const { t } = useTranslation();
  const task = useCall('tasks.get', { id: taskId });
  const focus = useFocusLink();
  // Only a task that is gone closes the panel. A failed refresh keeps it open with the text a person typed (audit 2026-10-03, PRJ-1).
  const gone = task.error instanceof ApiError && task.error.code === 'not_found';
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
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
      {task.data && <TaskBody detail={detail} data={task.data} onClose={onClose} noteFirst={noteFirst} />}
      {!task.data && task.error && !gone && <LoadFailed error={task.error} onRetry={() => void task.refetch()} />}
    </Sheet>
  );
}

/** The task panel outside its project screen, for example over My Work. An office task has no project (projectId null). */
export function ProjectTaskSheet({ projectId, taskId, onClose }: { projectId: string | null; taskId: string; onClose: () => void }) {
  const detail = useCall('projects.get', { id: projectId ?? '' }, { enabled: projectId !== null });
  if (projectId === null) return <TaskSheet taskId={taskId} detail={null} onClose={onClose} />;
  if (!detail.data) return null;
  return <TaskSheet taskId={taskId} detail={detail.data} onClose={onClose} />;
}
