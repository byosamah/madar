import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useLang } from '../../app/lang';
import { Button } from '../../components/Button';
import { formatDay, stampDay } from '../../lib/dates';
import { actorContext } from '../../lib/grammar';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PauseIcon } from '../../components/icons/animated/pause';

/** A paused project says so at the top: who paused it, when, why, and when it restarts (owner, 2026-10-01). */
export function PausedBanner({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const resume = useUndoable('projects.resume', { message: () => t('project.resumedToast') });
  const { project, pausedBy } = detail;
  if (project.status !== 'on_hold' || !project.pause) return null;
  const { pause } = project;
  return (
    <section aria-labelledby="paused-title" className="panel flex flex-wrap items-start gap-4 p-4 sm:items-center">
      <AnimatedIcon icon={PauseIcon} size={24} className="mt-0.5 shrink-0 text-attn sm:mt-0" aria-hidden />
      <div className="min-w-0 flex-1 basis-60">
        <h2 id="paused-title" className="text-headline text-ink">{t('project.pausedTitle')}</h2>
        <p dir="auto" className="text-subheadline text-ink">{pause.reason}</p>
        <p className="text-footnote text-ink-2">
          {pausedBy && t('project.pausedBy', { name: pausedBy.name, context: actorContext(pausedBy), date: formatDay(stampDay(pause.at), lang, 'long') })}
          {pause.resumeOn && <> {t('project.restarts', { date: formatDay(pause.resumeOn, lang, 'long') })}</>}
        </p>
      </div>
      {detail.viewerCan.archive && (
        <Button className="shrink-0" disabled={resume.isPending} onClick={() => resume.mutate({ id: project.id })}>{t('project.resume')}</Button>
      )}
    </section>
  );
}
