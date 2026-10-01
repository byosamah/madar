import { useTranslation } from 'react-i18next';
import { StatusSign, signOfProject, type PauseLike } from './StatusSign';

/**
 * The sign of a project that is not active: Paused, Awaiting client, Stale, Completed or Archived.
 * Stale says how long the project has waited ("Stale · paused 34 days").
 */
export function ProjectSign({ project, staleDays }: { project: PauseLike; staleDays: number | null }) {
  const { t } = useTranslation();
  const state = signOfProject({ project, health: null, staleDays });
  const word = state === 'stale' ? t('status.stale', { count: staleDays ?? 0 }) : state === 'awaiting_client' ? t('status.awaiting_client') : t(`status.${project.status}`);
  return <StatusSign state={state}>{word}</StatusSign>;
}
