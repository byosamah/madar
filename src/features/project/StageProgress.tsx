import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../api/contract/views';
import { ProgressLine } from '../../components/ProgressLine';
import { signOfProject } from '../../components/StatusSign';
import { currentStageIndex } from '../../lib/stageFlow';

/** The stage steps of a project in the color of its state, with "Stage 2 of 5" as the name for a screen reader. */
export function StageProgress({ detail, size, className }: { detail: ProjectDetail; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const { t } = useTranslation();
  const { stages, currentStage, project } = detail;
  const index = currentStageIndex(stages, currentStage);
  return (
    <ProgressLine
      index={index}
      total={stages.length}
      complete={project.status === 'completed'}
      tone={signOfProject(detail)}
      label={t('projects.stageCount', { n: index + 1, total: stages.length })}
      size={size}
      className={className}
    />
  );
}
