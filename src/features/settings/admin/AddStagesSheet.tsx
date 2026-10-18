import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectTemplate } from '../../../api/contract/entities';
import { useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { LoadFailed } from '../../../components/LoadFailed';
import { Sheet } from '../../../components/Sheet';

/**
 * "Add stages from another template" (fbk_008 item 7). The person picks one other saved template, ticks its stages, and may tick
 * "With their tasks". The editor gets the copies (importStages). This sheet saves nothing.
 */
export function AddStagesSheet({ exclude, onAdd, onClose }: {
  /** The template that the editor holds, when it is saved: the editor does not take stages from itself. */
  exclude: string | null;
  onAdd: (source: ProjectTemplate, stageIds: string[], withTasks: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const templates = useCall('projectTemplates.list', {});
  const others = (templates.data ?? []).filter((template) => template.id !== exclude);
  const [sourceId, setSourceId] = useState('');
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [withTasks, setWithTasks] = useState(false);
  const source = others.find((template) => template.id === sourceId) ?? null;
  const toggle = (id: string) => setStageIds((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]));
  const submit = () => {
    if (source && stageIds.length > 0) onAdd(source, stageIds, withTasks);
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('projectTemplates.addStagesFrom')}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!source || stageIds.length === 0} onClick={submit}>{t('projectTemplates.addStagesNow')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-5 pt-1">
        <LoadFailed query={templates} />
        {templates.data !== undefined && others.length === 0 && <p className="text-subheadline text-ink-2">{t('projectTemplates.noOtherTemplate')}</p>}
        {others.length > 0 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="add-stages-template" className="field-label">{t('projectTemplates.fromTemplate')}</label>
            <select
              id="add-stages-template"
              className="field min-h-11"
              value={sourceId}
              onChange={(event) => {
                setSourceId(event.target.value);
                setStageIds([]);
              }}
            >
              <option value="">{t('projectTemplates.chooseTemplate')}</option>
              {others.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </div>
        )}
        {source && (
          <fieldset className="flex flex-col gap-1">
            <legend className="field-label mb-1">{t('projectTemplates.stagesToAdd')}</legend>
            {source.stages.map((stage) => (
              <label key={stage.id} className="flex min-h-11 items-center gap-3 self-start rounded-xl pe-2 hover:bg-fill">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
                  checked={stageIds.includes(stage.id)}
                  onChange={() => toggle(stage.id)}
                />
                <span dir="auto" className="text-subheadline">{stage.name}</span>
              </label>
            ))}
            <label className="mt-2 flex min-h-11 items-center gap-3 self-start rounded-xl border-t border-separator pt-2 pe-2 hover:bg-fill">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
                checked={withTasks}
                onChange={(event) => setWithTasks(event.target.checked)}
              />
              <span className="text-subheadline">{t('projectTemplates.withTasks')}</span>
            </label>
          </fieldset>
        )}
      </div>
    </Sheet>
  );
}
