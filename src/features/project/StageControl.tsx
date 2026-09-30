import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';
import { StageRail } from '../../components/StageRail';
import { formatDay } from '../../lib/dates';

function StagePopover({ detail, stage, anchor, onClose }: { detail: ProjectDetail; stage: Stage; anchor: HTMLElement; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const tasks = useCall('tasks.list', { projectId: detail.project.id, activeProjectsOnly: false });
  const inStage = (tasks.data ?? []).filter((row) => row.task.stageId === stage.id);
  const done = inStage.filter((row) => row.task.status === 'done').length;
  const setStage = useUndoable('projects.setStage', { message: () => t('project.stageChanged'), onSuccess: onClose });
  const current = stage.id === detail.currentStage.id;
  const dates = stage.startDate && stage.endDate
    ? t('project.stageDates', { start: formatDay(stage.startDate, lang), end: formatDay(stage.endDate, lang) })
    : t('project.noDates');
  return (
    <Popover anchor={anchor} label={stage.name} onClose={onClose}>
      <div>
        <p dir="auto" className="text-headline">{stage.name}</p>
        {current && <p className="text-footnote font-semibold text-accent">{t('project.current')}</p>}
      </div>
      <p className="tabular text-subheadline">{dates}</p>
      {tasks.data && <p className="text-subheadline text-label-2">{t('project.stageTasks', { done, total: inStage.length })}</p>}
      {detail.viewerCan.edit && !current && (
        <Button variant="primary" disabled={setStage.isPending} onClick={() => setStage.mutate({ id: detail.project.id, stageId: stage.id })}>
          {t('project.makeCurrent')}
        </Button>
      )}
    </Popover>
  );
}

/** A click on a stage opens its dates and task count. The leader can make it the current stage (spec 5.1). */
export function StageControl({ detail }: { detail: ProjectDetail }) {
  const [open, setOpen] = useState<{ stage: Stage; anchor: HTMLElement } | null>(null);
  return (
    <>
      <StageRail stages={detail.stages} currentId={detail.currentStage.id} onSelect={(stage, anchor) => setOpen({ stage, anchor })} />
      {open && <StagePopover detail={detail} stage={open.stage} anchor={open.anchor} onClose={() => setOpen(null)} />}
    </>
  );
}
