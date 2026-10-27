import type { useTranslation } from 'react-i18next';
import { CommentThread } from '../../comments/CommentThread';
import { ZipTitleContext } from '../../files/zipTitle';
import type { TaskPanel } from './useTaskPanel';

export type Section = 'details' | 'conversation';

/** The two views of the task panel, with the comment count on the second one. The desk and the phone offer the same two. */
export function sectionOptions(t: ReturnType<typeof useTranslation>['t'], count: number): { value: Section; label: string }[] {
  return [
    { value: 'details', label: t('taskSheet.details') },
    { value: 'conversation', label: count > 0 ? t('taskSheet.conversationCount', { n: count }) : t('taskSheet.conversation') },
  ];
}

/** The comment thread of the to-do. `docked` is the phone form: the comment box sticks to the bottom and the thread shows no title. */
export function ConversationView({ panel, docked = false }: { panel: TaskPanel; docked?: boolean }) {
  const { data, detail, task, viewerCan, people } = panel;
  return (
    <ZipTitleContext.Provider value={task.title}>
      <CommentThread
        targetType="task" targetId={task.id} projectId={detail?.project.id ?? null} stageId={task.stageId} people={people}
        canPost={viewerCan.comment === true}
        canAttach={viewerCan.upload === true}
        everyone={data.everyone}
        docked={docked}
        hideTitle={docked}
      />
    </ZipTitleContext.Provider>
  );
}
