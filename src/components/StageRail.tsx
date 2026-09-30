import { useTranslation } from 'react-i18next';
import type { Stage } from '../api/contract/entities';

/** One block per stage: past stages grey, the current stage in the accent color, future stages light (spec 4.1). */
export function StageRail({
  stages, currentId, onSelect, showName = true,
}: { stages: Stage[]; currentId: string; onSelect?: (stage: Stage, anchor: HTMLElement) => void; showName?: boolean }) {
  const { t } = useTranslation();
  const index = Math.max(0, stages.findIndex((stage) => stage.id === currentId));
  const current = stages[index];
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ol aria-label={t('projects.stageOf', { n: index + 1, total: stages.length, name: current?.name ?? '' })} className="flex flex-1 gap-1">
        {stages.map((stage, i) => {
          const tone = i < index ? 'bg-label-3' : i === index ? 'bg-accent-fill' : 'bg-fill-strong';
          const block = <span aria-hidden className={`block h-1.5 w-full rounded-full ${tone}`} />;
          return (
            <li key={stage.id} className="flex min-w-0 flex-1">
              {onSelect ? (
                <button
                  type="button"
                  aria-label={stage.name}
                  aria-current={i === index ? 'step' : undefined}
                  onClick={(event) => onSelect(stage, event.currentTarget)}
                  className="flex min-h-11 w-full items-center"
                >
                  {block}
                </button>
              ) : block}
            </li>
          );
        })}
      </ol>
      {showName && current && <span className="max-w-[45%] truncate text-footnote text-label-2">{current.name}</span>}
    </div>
  );
}
