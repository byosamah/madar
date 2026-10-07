import { useTranslation } from 'react-i18next';
import type { Stage } from '../../../api/contract/entities';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FileTextIcon } from '../../../components/icons/animated/file-text';
import { Menu } from '../../../components/Menu';
import { useStageBack } from './StageBack';

/**
 * "From a template" beside a stage's quick add (colleague comments 8 and 12). It lists only the templates saved for this stage's name,
 * and hides itself when there are none. A pick makes the task at once, with its checklist unticked.
 */
export function TemplateMenu({ stage }: { stage: Stage }) {
  const { t } = useTranslation();
  const templates = useCall('taskTemplates.list', { stageName: stage.name });
  const toast = useToast();
  // No Undo here, as in the quick add: the new task shows in its list, and its maker deletes it from its panel (owner, 2026-10-07).
  const back = useStageBack();
  const create = useAction('tasks.createFromTemplate', {
    onSuccess: (output) => toast.show({ message: t('tasks.addedFromTemplate', { title: output.task.title }) }),
    onRefused: (error, input) => back.refused(error, input, (next) => create.mutate(next)),
  });
  const label = t('tasks.fromTemplate', { stage: stage.name });
  return (
    <>
      <Menu
        label={label}
        icon={<AnimatedIcon icon={FileTextIcon} size={18} aria-hidden />}
        items={(templates.data ?? []).map((template) => ({ label: template.name, onSelect: () => create.mutate({ templateId: template.id, stageId: stage.id }) }))}
      />
      {back.sheet}
    </>
  );
}
