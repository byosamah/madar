import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../api/errors';
import type { ProjectDetail, TaskDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { useCan } from '../../../app/useRight';
import { focusLost } from '../../../components/Sheet';
import { BOARD_COLUMNS, moveTargets } from '../../../lib/board';
import { actorContext } from '../../../lib/grammar';
import { helpersOf } from '../../../lib/taskPeople';
import { TASK_PANEL, usePanelLink } from '../panelLink';
import { useDateReason } from './DateReason';
import { mayChangeOf } from './nextStep';
import { useStageBack } from './StageBack';
import { personOption } from './TaskHelpers';
import { EMPTY_FILES, newItemId, type ChecklistDraft, type Patch } from './TaskParts';
import { useLeadChoices } from './useLeadChoices';
import { useCompleteTask, useMoveTask } from './useTaskMoves';

export type TaskPanelProps = { detail: ProjectDetail | null; data: TaskDetail; onClose: () => void; noteFirst: boolean };

/**
 * The state and the actions of the task panel. The desk body and the phone body both read this one hook, so no rule exists twice.
 * detail is null for an office task, which has no project (owner, 2026-10-06): no stage, no prerequisites, no team.
 */
export function useTaskPanel({ detail, data, onClose, noteFirst }: TaskPanelProps) {
  const { t } = useTranslation();
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
  const move = useMoveTask(back);
  // The one finish button of the phone panel: the same call as the tick of a list row and the Done button of Focus mode. The server
  // result decides the toast, so the toast is true even when the word of the button was a guess.
  const complete = useCompleteTask();
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
  // A person on the team takes a task with no lead in one press, and Undo gives it back (owner, 2026-10-05).
  const take = useUndoable('tasks.take', { message: () => t('lead.taken') });
  // A person on the team joins a task as a helper in one press, or leaves it, and Undo takes it back (fbk_035, owner 2026-10-20).
  const join = useUndoable('tasks.help', { message: () => t('taskHelp.joined', { context: actorContext(session.data?.authority) }) });
  const leave = useUndoable('tasks.help', { message: () => t('taskHelp.left', { context: actorContext(session.data?.authority) }) });
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
  // Each field takes a new saved value on its own, so the answer of a title save never puts back the description that the person
  // types now, and the reverse. A field that holds typing that is not saved keeps it, also when another person changes the task
  // (review 2026-10-25). Typing is a value that is neither the last saved value of the field nor the value that went to the server.
  const savedText = useRef({ title: task.title, description: task.description });
  useEffect(() => {
    const typing = title !== savedText.current.title && title.trim() !== sent.current.title;
    savedText.current.title = task.title;
    delete sent.current.title;
    if (!typing) setTitle(task.title);
    // The effect follows the saved title only; the typed title is the value of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.title]);
  useEffect(() => {
    const typing = description !== savedText.current.description && description !== sent.current.description;
    savedText.current.description = task.description;
    delete sent.current.description;
    if (typing) return;
    setDescription(task.description);
    setUnsaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.description]);

  const patch = (changes: Patch) => {
    if (changes.title !== undefined) sent.current.title = changes.title;
    if (changes.description !== undefined) sent.current.description = changes.description;
    update.mutate({ id: task.id, patch: changes });
  };
  // Role rights version 2: one flag for each kind of change. The details, the dates and the work are three switches.
  const canDetails = viewerCan.editDetails === true;
  const canDates = viewerCan.editDates === true;
  const mayChange = mayChangeOf(viewerCan);
  // Escape, a tap outside on a phone, Back and another task close the panel before a field loses the focus. So the panel saves
  // what the person typed when it closes, by any way, as the X button always did (audit 2026-10-03, F-15).
  // The save goes only as the person who typed, and only for a task that is still there. A change of person (Preview as) and a
  // task deleted by someone else also close the panel (review 2026-10-03, V-22).
  const queryClient = useQueryClient();
  const typedBy = useRef<string | undefined>(undefined);
  typedBy.current ??= session.data?.user.id;
  const saveTyped = useRef<() => void>(() => undefined);
  saveTyped.current = () => {
    if (!canDetails || deleted.current) return;
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
  // The panel counts the lead as on the team, also when the lead left it (naming a person outside the team adds them to it, which asks
  // project.team).
  const { teamIds, pickable: choices, changeLead } = useLeadChoices({ taskId: task.id, humans: pickable, detail, leadOnTeam: data.owner });
  // While the task waits for review, its lead gets the pull-back choices and no Done (audit 2026-10-03, F-19).
  const statusOptions = BOARD_COLUMNS
    .filter((status) => status === task.status || moveTargets(task.status, false, task.needsReview, task.ownerId !== null).includes(status))
    .map((status) => ({ value: status, label: t(`taskStatus.${status}`) }));
  // "No lead" comes first (owner, 2026-10-05). A task in review or done keeps its lead, so it offers no "No lead".
  const ownerOptions = {
    showNoLead: task.ownerId === null || task.status === 'todo' || task.status === 'in_progress',
    people: viewerCan.editAll
      ? (data.owner && !choices.some((person) => person.id === task.ownerId) ? [...choices, data.owner] : choices)
        .map((person) => ({ value: person.id, label: personOption(person, teamIds.has(person.id), t) }))
      : [],
  };
  const me = session.data?.authority.id;
  // A helper may leave the task with one press at the end of the panel (fbk_035).
  const helping = me !== undefined && helpersOf(task).includes(me);
  // Undo of the change of another person's AI assistant: ai.undoOthers in this project (the maker of an office to-do).
  const may = useCan();
  const undoOthers = detail ? may('ai.undoOthers', { projectRole: detail.viewerRole }) : viewerCan.editAll;
  const canUndoAgent = useCallback(
    (actingForId: string) => undoOthers || actingForId === me,
    [undoOthers, me],
  );
  // The task's own conversation sits one press away, beside its details (owner's request, 2026-10-01). The choice lives in the link.
  const [params] = useSearchParams();
  const link = usePanelLink(TASK_PANEL);
  const section: 'details' | 'conversation' = params.get('thread') === '1' ? 'conversation' : 'details';
  // The panel is open, so the choice replaces the link and keeps the history step of the panel (audit 2026-10-03, V-36).
  const setSection = (next: 'details' | 'conversation') => link.open({ thread: next === 'conversation' ? '1' : null });

  return {
    data, detail, task, viewerCan, noteFirst,
    canDetails, canDates, mayChange,
    root, reviewBlock,
    title, setTitle, description, setDescription, unsaved, note, setNote,
    patch,
    move, approve, sendBack, take, join, leave, remove, saveTemplate, complete,
    changeLead, statusOptions, ownerOptions,
    people, choices, teamIds, makerId, helping, canUndoAgent,
    files: files.data ?? EMPTY_FILES,
    section, setSection,
    timingKey, failures, dates, back,
    checklistDraft,
  };
}

export type TaskPanel = ReturnType<typeof useTaskPanel>;
