import { useTranslation } from 'react-i18next';
import { TabPanel, Tabs } from '../../../components/Tabs';
import { CommentThread } from '../../comments/CommentThread';
import { NextStep } from './NextStepSlot';
import { PhoneDetails } from './PhoneDetails';
import { TitleBlock } from './PhoneTop';
import { StateLine } from './StateLine';
import type { TaskPanel } from './useTaskPanel';

/**
 * The task panel on a phone (Direction D), from the top: the large title, one line of quiet facts, the one next step, the switch between
 * Details and Conversation, and then the view. The top row (project link, Focus, Close) lives in the Sheet. Both views keep the next step
 * slot. In the Conversation view its button turns secondary, because the Send button of the comment box is the one main button there.
 * The view is a column that fills the sheet, so the comment box sticks to the bottom even when there are few comments.
 */
export function PhoneBody({ panel }: { panel: TaskPanel }) {
  const { t } = useTranslation();
  const { data, detail, task, viewerCan, people, section, setSection, root, back, dates } = panel;
  return (
    <div ref={root} className="flex min-h-full flex-col gap-4 pt-1">
      <TitleBlock panel={panel} />
      <StateLine data={data} />
      {/* An office task says who sees it (owner, 2026-10-06). */}
      {!detail && <p className="text-footnote text-ink-2">{t('office.sheetNote')}</p>}
      <NextStep panel={panel} demote={section === 'conversation'} />
      <Tabs
        variant="pill"
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
        // The same markup as TabPanel, with a column that fills the sheet for the docked box.
        <div id="task-section-panel" role="tabpanel" aria-labelledby="task-section-conversation" className="flex flex-1 flex-col">
          <CommentThread
            targetType="task" targetId={task.id} projectId={detail?.project.id ?? null} stageId={task.stageId} people={people}
            canPost={viewerCan.comment === true}
            canAttach={viewerCan.upload === true}
            everyone={data.everyone}
            docked
            hideTitle
          />
        </div>
      ) : (
        <TabPanel value="details" idPrefix="task-section">
          <PhoneDetails panel={panel} />
        </TabPanel>
      )}
      {back.sheet}
      {dates.sheet}
    </div>
  );
}
