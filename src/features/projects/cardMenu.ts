import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useToast, type ToastInput } from '../../app/toasts';
import type { MenuItem } from '../../components/Menu';

/** Copies a link that opens the project in the app. */
export function copyLink(path: string, show: (toast: ToastInput) => void, t: TFunction): void {
  const url = `${window.location.origin}${window.location.pathname}#${path}`;
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(url))
    .then(() => show({ message: t('projects.linkCopied') }))
    .catch(() => show({ tone: 'error', message: t('errors.failed') }));
}

/** Open, Post update, Copy link, Archive: only what the viewer may do (spec 4.1). */
export function useCardMenu(summary: ProjectSummary): MenuItem[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const archive = useUndoable('projects.setStatus', { message: () => t('projects.archived') });
  const { project, viewerCan } = summary;
  const path = `/projects/${project.id}`;
  return [
    { label: t('projects.open'), onSelect: () => navigate(path) },
    { label: t('projects.postUpdate'), onSelect: () => navigate(`${path}?compose=1`), hidden: !viewerCan.post },
    { label: t('projects.copyLink'), onSelect: () => copyLink(path, toast.show, t) },
    {
      label: t('projects.archive'),
      onSelect: () => archive.mutate({ id: project.id, status: 'archived' }),
      hidden: !viewerCan.archive || project.status === 'archived',
    },
  ];
}
