import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { ProjectDetail, TaskDetail } from '../../../api/contract/views';
import { ApiError } from '../../../api/errors';
import { usePrefetchCall } from '../../../app/prefetch';
import { useIsPhone } from '../../../app/useIsPhone';
import { useCall } from '../../../app/runtime';
import { LoadFailed } from '../../../components/LoadFailed';
import { Sheet } from '../../../components/Sheet';
import { useFocusLink } from '../../focus/focusLink';
import { TimerIcon } from '../../../components/icons/animated/timer';
import { prefetchReads, type Read } from '../reads';
import { DeskBody } from './DeskBody';
import { PhoneBody } from './PhoneBody';
import { PhoneHeader } from './PhoneTop';
import { useTaskPanel } from './useTaskPanel';

/** detail is null for an office task, which has no project (owner, 2026-10-06): no stage, no prerequisites, no team. */
function TaskBody({ detail, data, onClose, noteFirst }: { detail: ProjectDetail | null; data: TaskDetail; onClose: () => void; noteFirst: boolean }) {
  const phone = useIsPhone();
  const panel = useTaskPanel({ detail, data, onClose, noteFirst });
  // A phone gets its own body (Direction D). Both bodies read the same hook, so no rule exists twice.
  return phone ? <PhoneBody panel={panel} /> : <DeskBody panel={panel} />;
}

/**
 * The reads of a task panel, with the exact keys of their useCall: the task (TaskSheet), its files (TaskBody), and its comments
 * when the link opens the Conversation (CommentThread). projectId is null for an office task. A screen that opens the panel
 * starts them together, so the full panel comes after one round trip, not three (performance audit 2026-10-07, FET-1).
 */
export function taskPanelReads(taskId: string, projectId: string | null, thread: boolean): Read[] {
  return [
    { name: 'tasks.get', input: { id: taskId } },
    { name: 'files.list', input: projectId ? { projectId, taskId } : { taskId } },
    ...(thread ? [{ name: 'comments.list', input: { targetType: 'task', targetId: taskId } } as const] : []),
  ];
}

/** Starts the reads of the panel in an effect (FET-1). Only the start time changes: every part still waits for its own answer. */
function usePanelPrefetch(taskId: string, projectId: string | null) {
  const prefetch = usePrefetchCall();
  const [params] = useSearchParams();
  const thread = params.get('thread') === '1';
  useEffect(() => {
    prefetchReads(prefetch, taskPanelReads(taskId, projectId, thread));
  }, [prefetch, taskId, projectId, thread]);
}

/** The task panel: a side panel with no dim layer on desktop, a sheet on a phone (spec 5.4). detail is null for an office task. */
export function TaskSheet({ taskId, detail, onClose, noteFirst = false }: { taskId: string; detail: ProjectDetail | null; onClose: () => void; noteFirst?: boolean }) {
  const { t } = useTranslation();
  const task = useCall('tasks.get', { id: taskId });
  // The files and the comments start with the task, not after it (FET-1).
  usePanelPrefetch(taskId, detail?.project.id ?? null);
  const focus = useFocusLink();
  const phone = useIsPhone();
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
      tall
      phoneHeader={phone && task.data ? <PhoneHeader data={task.data} /> : undefined}
      headerAction={(
        <button type="button" onClick={() => focus.open(taskId)} className="pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-fill px-4 text-subheadline font-semibold text-ink hover:bg-fill-strong">
          <AnimatedIcon icon={TimerIcon} size={16} aria-hidden />
          {t('focus.open')}
        </button>
      )}
    >
      {task.data && <TaskBody detail={detail} data={task.data} onClose={onClose} noteFirst={noteFirst} />}
      {!gone && <LoadFailed query={task} />}
    </Sheet>
  );
}

/** The task panel outside its project screen, for example over My Work. An office task has no project (projectId null). `noteFirst` opens it ready for the note of Send back (the Board of Tasks). */
export function ProjectTaskSheet({ projectId, taskId, onClose, noteFirst = false }: { projectId: string | null; taskId: string; onClose: () => void; noteFirst?: boolean }) {
  const detail = useCall('projects.get', { id: projectId ?? '' }, { enabled: projectId !== null });
  // The task, its files and its comments start with the project, so the panel does not wait three round trips (FET-1).
  usePanelPrefetch(taskId, projectId);
  if (projectId === null) return <TaskSheet taskId={taskId} detail={null} onClose={onClose} noteFirst={noteFirst} />;
  if (!detail.data) return null;
  return <TaskSheet taskId={taskId} detail={detail.data} onClose={onClose} noteFirst={noteFirst} />;
}
