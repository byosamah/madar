import { useTranslation } from 'react-i18next';
import { counted } from '../../../lib/grammar';
import { planItems, templateDays } from '../../../lib/projectPlan';
import { draftPlanTemplate, type TemplateDraft } from './templateDraft';

/**
 * A small timeline under the template editor: one row for each stage, one bar for each task (or for a stage with its own days).
 * Grey bars can stretch, dark bars keep their length. The bars use logical sides, so the Arabic timeline runs from the right.
 */
export function TemplateTimeline({ draft }: { draft: TemplateDraft }) {
  const { t } = useTranslation();
  const plan = draftPlanTemplate(draft);
  const length = templateDays(plan);
  const fixed = plan.tasks.filter((task) => !task.flexible).map((task) => task.id);
  const items = new Map(planItems(plan, fixed).map((item) => [item.id, item]));
  const stageOf = new Map(plan.tasks.map((task) => [task.id, task.stageId]));
  return (
    <section aria-labelledby="template-timeline" className="flex flex-col gap-2">
      <h3 id="template-timeline" className="field-label">{t('projectTemplates.timeline')}</h3>
      {length === 0 ? (
        <p className="text-footnote text-ink-2">{t('projectTemplates.timelineEmpty')}</p>
      ) : (
        <>
          <ul aria-hidden className="flex flex-col gap-1.5">
            {draft.stages.map((stage, index) => {
              const bars = [...items.values()].filter((item) => (stageOf.get(item.id) ?? item.id) === stage.id);
              return (
                <li key={stage.id} className="flex items-center gap-2">
                  <bdi className="w-24 shrink-0 truncate text-caption text-ink-2 sm:w-36">{stage.name || String(index + 1)}</bdi>
                  <span className="relative h-4 min-w-0 flex-1 rounded-full bg-fill">
                    {bars.map((bar) => (
                      <span
                        key={bar.id}
                        style={{ insetInlineStart: `${(bar.start / length) * 100}%`, width: `max(4px, ${(bar.days / length) * 100}%)` }}
                        className={`absolute inset-y-0.5 rounded-full ${bar.locked ? 'bg-ink' : 'bg-chart-muted'}`}
                      />
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="flex flex-wrap gap-x-2 text-footnote text-ink-2">
            <span className="font-semibold text-ink">{t('projectTemplates.length', { days: counted(t, 'projectTemplates.dayCount', length) })}</span>
            <span>{t('projectTemplates.timelineLegend')}</span>
          </p>
        </>
      )}
    </section>
  );
}
