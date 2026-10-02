import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../components/icons/animated/check';
import { ChevronDownIcon } from '../../components/icons/animated/chevron-down';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { Popover } from '../../components/Popover';
import { formatDay, localeFor } from '../../lib/dates';
import { openStagesNeededBy, overlappingWith, stageOverlaps } from '../../lib/stageFlow';

/**
 * One stage, read only except for its prerequisites: its dates, its tasks, the stages it needs first and the stages that run at
 * the same time (owner, 2026-10-02). The current stage is never picked here: it follows the tasks.
 */
function StageDetails({ detail, stage }: { detail: ProjectDetail; stage: Stage }) {
  const { t } = useTranslation();
  const lang = useLang();
  const tasks = useCall('tasks.list', { projectId: detail.project.id, activeProjectsOnly: false });
  const setNeeds = useUndoable('stages.setPrerequisites', { message: () => t('project.stageOrderSaved') });
  const inStage = (tasks.data ?? []).filter((row) => row.task.stageId === stage.id);
  const done = inStage.filter((row) => row.task.status === 'done').length;
  const list = new Intl.ListFormat(localeFor(lang), { type: 'conjunction' });
  const nameOf = (id: string) => detail.stages.find((other) => other.id === id)?.name ?? '';
  const needs = stage.prerequisiteIds ?? [];
  const waiting = tasks.data ? openStagesNeededBy(stage.id, detail.stages, tasks.data.map((row) => row.task)) : [];
  const alongside = overlappingWith(stage.id, stageOverlaps(detail.stages));
  const others = detail.stages.filter((other) => other.id !== stage.id);
  const dates = stage.startDate && stage.endDate
    ? t('project.stageDates', { start: formatDay(stage.startDate, lang), end: formatDay(stage.endDate, lang) })
    : t('project.noDates');
  return (
    <div aria-label={t('project.stageList')} role="group" className="flex flex-col gap-1 rounded-2xl bg-fill p-3">
      <p className="tabular text-subheadline text-ink">{dates}</p>
      {tasks.data && <p className="text-subheadline text-ink-2">{t('project.stageTasks', { done, total: inStage.length })}</p>}
      {alongside.length > 0 && <p dir="auto" className="text-subheadline text-ink-2">{t('project.stageOverlap', { names: list.format(alongside.map(nameOf)) })}</p>}
      {waiting.length > 0 && <p dir="auto" className="text-subheadline font-medium text-ink">{t('project.stageWaiting', { names: list.format(waiting.map((other) => other.name)) })}</p>}
      {detail.viewerCan.edit ? (
        <fieldset className="mt-2 flex flex-col">
          <legend className="pb-1 text-footnote font-semibold text-ink-2">{t('project.stageNeeds')}</legend>
          <p className="pb-1 text-footnote text-ink-2">{t('project.stageNeedsHint')}</p>
          {others.length === 0 && <p className="text-footnote text-ink-2">{t('project.stageNoNeeds')}</p>}
          {others.map((other) => (
            <label key={other.id} className="flex min-h-11 items-center gap-3 rounded-xl px-1">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
                checked={needs.includes(other.id)}
                disabled={setNeeds.isPending}
                onChange={(event) => setNeeds.mutate({
                  stageId: stage.id,
                  prerequisiteIds: event.target.checked ? [...needs, other.id] : needs.filter((id) => id !== other.id),
                })}
              />
              <bdi className="min-w-0 flex-1 truncate text-subheadline text-ink">{other.name}</bdi>
            </label>
          ))}
        </fieldset>
      ) : needs.length > 0 && (
        <p dir="auto" className="text-subheadline text-ink-2">{t('project.stageNeeds')}: {list.format(needs.map(nameOf))}</p>
      )}
    </div>
  );
}

/**
 * The current stage as one quiet button. It opens the stages in time order, each with its dates, tasks and prerequisites.
 * The current stage follows the tasks (the earliest stage with an open task), so nobody picks it here (owner, 2026-10-02).
 */
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
          <p className="text-footnote text-ink-2">{t('project.stageAuto')}</p>
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
          <StageDetails key={selected.id} detail={detail} stage={selected} />
        </Popover>
      )}
    </>
  );
}
