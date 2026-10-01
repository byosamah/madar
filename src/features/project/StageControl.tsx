import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../components/icons/animated/check';
import { ChevronDownIcon } from '../../components/icons/animated/chevron-down';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { TextArea } from '../../components/Fields';
import { Popover } from '../../components/Popover';
import { formatDay } from '../../lib/dates';

function StageDetails({ detail, stage, back, onClose }: { detail: ProjectDetail; stage: Stage; back: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const tasks = useCall('tasks.list', { projectId: detail.project.id, activeProjectsOnly: false });
  const inStage = (tasks.data ?? []).filter((row) => row.task.stageId === stage.id);
  const done = inStage.filter((row) => row.task.status === 'done').length;
  const setStage = useUndoable('projects.setStage', { message: () => t('project.stageChanged'), onSuccess: onClose });
  const current = stage.id === detail.currentStage.id;
  // Going back asks why, so the team sees the reason on the Overview (colleague comment 12).
  const [reason, setReason] = useState('');
  const [logIt, setLogIt] = useState(false);
  const backForm = useRef<HTMLDivElement>(null);
  // The form opens below the stage list, so bring all of it, the button too, into view.
  useEffect(() => {
    if (back) backForm.current?.scrollIntoView?.({ block: 'nearest' });
  }, [back]);
  const dates = stage.startDate && stage.endDate
    ? t('project.stageDates', { start: formatDay(stage.startDate, lang), end: formatDay(stage.endDate, lang) })
    : t('project.noDates');
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-fill p-3">
      <p className="tabular text-subheadline text-ink">{dates}</p>
      {tasks.data && <p className="text-subheadline text-ink-2">{t('project.stageTasks', { done, total: inStage.length })}</p>}
      {detail.viewerCan.edit && !current && !back && (
        <Button variant="primary" className="mt-2" disabled={setStage.isPending} onClick={() => setStage.mutate({ id: detail.project.id, stageId: stage.id })}>
          {t('project.makeCurrent')}
        </Button>
      )}
      {detail.viewerCan.edit && back && (
        <div ref={backForm} className="mt-2 flex flex-col gap-2">
          <TextArea id="stage-back-reason" className="[&_textarea]:min-h-0" label={t('project.moveBackWhy')} value={reason} dir="auto" maxLength={280} rows={2} onChange={(event) => setReason(event.target.value)} />
          <label className="flex min-h-11 items-center gap-3 rounded-xl px-1">
            <input type="checkbox" className="size-5 shrink-0 accent-[var(--c-accent-fill)]" checked={logIt} onChange={(event) => setLogIt(event.target.checked)} />
            <span className="text-subheadline text-ink">{t('project.moveBackLog')}</span>
          </label>
          <Button
            variant="primary"
            disabled={!reason.trim() || setStage.isPending}
            onClick={() => setStage.mutate({ id: detail.project.id, stageId: stage.id, reason: reason.trim(), logInTracker: logIt })}
          >
            {t('project.moveBack', { stage: stage.name })}
          </Button>
        </div>
      )}
    </div>
  );
}

/** The current stage as one quiet button. It opens the list of stages; the leader can make another stage current (redesign spec 3.4). */
export function StageControl({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(detail.currentStage.id);
  const currentIndex = detail.stages.findIndex((stage) => stage.id === detail.currentStage.id);
  const selected = detail.stages.find((stage) => stage.id === picked) ?? detail.currentStage;
  const toggle = () => {
    setPicked(detail.currentStage.id);
    setOpen((value) => !value);
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className="pressable -ms-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-subheadline font-semibold text-ink hover:bg-fill"
      >
        <bdi>{detail.currentStage.name}</bdi>
        <AnimatedIcon icon={ChevronDownIcon} size={16} className="text-ink-2" aria-hidden />
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current} label={t('project.stages')} onClose={() => setOpen(false)}>
          <p className="text-headline text-ink">{t('project.stages')}</p>
          <ol className="-mx-1 flex flex-col">
            {detail.stages.map((stage, index) => {
              const isCurrent = stage.id === detail.currentStage.id;
              const past = index < currentIndex;
              return (
                <li key={stage.id}>
                  <button
                    type="button"
                    aria-pressed={stage.id === selected.id}
                    onClick={() => setPicked(stage.id)}
                    className={`pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-start text-subheadline ${stage.id === selected.id ? 'bg-fill font-semibold text-ink' : 'text-ink hover:bg-fill'}`}
                  >
                    <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold ${isCurrent ? 'bg-ink text-panel' : past ? 'bg-fill-strong text-ink' : 'border border-hairline text-ink-2'}`}>
                      {past ? <AnimatedIcon icon={CheckIcon} size={13} /> : index + 1}
                    </span>
                    <bdi className="min-w-0 flex-1 truncate">{stage.name}</bdi>
                    {isCurrent && <span className="text-caption font-semibold text-ink-2">{t('project.current')}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <StageDetails key={selected.id} detail={detail} stage={selected} back={detail.stages.indexOf(selected) < currentIndex} onClose={() => { setOpen(false); ref.current?.focus(); }} />
        </Popover>
      )}
    </>
  );
}
