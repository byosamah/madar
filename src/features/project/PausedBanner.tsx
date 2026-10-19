import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { Button } from '../../components/Button';
import { DateDraftField } from '../../components/DateDraftField';
import { addDays, formatDay, stampDay, todayISO } from '../../lib/dates';
import { actorContext } from '../../lib/grammar';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PauseIcon } from '../../components/icons/animated/pause';

/**
 * A paused project says so at the top: who paused it, when, why, and its restart reminder (owner, 2026-10-01). The date is a
 * reminder: Madar never restarts a project by itself (fbk_025, owner 2026-10-19). When the day has passed, the banner asks for the
 * next step: Resume the project, or set a new date. The new date is one quiet field that changes only the date.
 */
export function PausedBanner({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const lang = useLang();
  const resume = useUndoable('projects.resume', { message: () => t('project.resumedToast') });
  const setRestart = useUndoable('projects.setRestart', { message: () => t('project.restartMovedToast') });
  const { project, pausedBy } = detail;
  if (project.status !== 'on_hold' || !project.pause) return null;
  const { pause } = project;
  const passed = pause.resumeOn !== null && pause.resumeOn < todayISO();
  return (
    <section aria-labelledby="paused-title" className="panel flex flex-wrap items-start gap-4 p-4 sm:items-center">
      <AnimatedIcon icon={PauseIcon} size={24} className="mt-0.5 shrink-0 text-attn sm:mt-0" aria-hidden />
      <div className="min-w-0 flex-1 basis-60">
        <h2 id="paused-title" className="text-headline text-ink">{pause.kind === 'client' ? t('status.awaiting_client') : t('project.pausedTitle')}</h2>
        <p dir="auto" className="text-subheadline text-ink">{pause.reason}</p>
        <p className="text-footnote text-ink-2">
          {pausedBy && t('project.pausedBy', { name: nameOf(pausedBy), context: actorContext(pausedBy), date: formatDay(stampDay(pause.at), lang, 'long') })}
          {/* A restart date that passed says so in the Attention color, not in the present tense (audit 2026-10-03, PRJ-14). */}
          {pause.resumeOn && (passed
            ? <> <span className="text-attn">{t('project.restartWas', { date: formatDay(pause.resumeOn, lang, 'long') })}</span></>
            : <> {t('project.restarts', { date: formatDay(pause.resumeOn, lang, 'long') })}</>)}
          {detail.staleDays !== null && <> {t('status.stale', { count: detail.staleDays })}</>}
        </p>
        {passed && detail.viewerCan.archive && (
          <DateDraftField
            id="restart-new" className="-ms-3.5" label={t('project.setNewDate')} hideLabel emptyText={t('project.setNewDate')} value=""
            min={addDays(todayISO(), 1)} disabled={setRestart.isPending}
            onCommit={(day) => {
              if (day) setRestart.mutate({ id: project.id, resumeOn: day });
            }}
          />
        )}
      </div>
      {detail.viewerCan.archive && (
        <Button className="shrink-0" disabled={resume.isPending} onClick={() => resume.mutate({ id: project.id })}>{t('project.resume')}</Button>
      )}
    </section>
  );
}
