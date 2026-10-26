import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '../../api/contract/views';
import { useFileLink } from '../../app/files';
import { useLang } from '../../app/lang';
import { PRIVATE } from '../../app/privateMark';
import { MarkForm } from '../../components/ProjectTile';
import { spring } from '../../design/motion';
import { formatDay } from '../../lib/dates';
import { dueText, wordForDays } from '../../lib/due';
import { markGlow, markOf } from '../../lib/projectMark';
import { isProjectShape } from '../../lib/projectShape';
import { useProjectName } from '../../app/projectName';

/** The latest render at 16:9, or the project's picture large when there is no cover (owner, 2026-10-01). */
export function ProjectCover({ summary, className = 'aspect-video', layoutId }: { summary: ProjectSummary; className?: string; layoutId?: string }) {
  const { t } = useTranslation();
  const projectName = useProjectName();
  const cover = useFileLink(summary.project.coverFileId, summary.coverLetter ?? undefined, 'thumb');
  const label = t('projects.cover', { name: projectName(summary.project) });
  const inner = cover.url
    ? <img src={cover.url} alt={label} onError={cover.onError} className={`${PRIVATE} w-full object-cover ${className}`} />
    : (
      <div role="img" aria-label={label} data-project-mark={markOf(summary.project)} style={{ background: markGlow(summary.project.id, markOf(summary.project)) }} className={`relative w-full ${className}`}>
        <MarkForm mark={markOf(summary.project)} shape={summary.project.shape} className={`absolute inset-0 m-auto w-auto ${isProjectShape(summary.project.shape) ? 'h-[47%]' : 'h-[34%]'}`} />
      </div>
    );
  if (!layoutId) return inner;
  // With a layoutId, the card and the project header share the cover, so the card grows into the screen and shrinks back (spec 10.6).
  return (
    <motion.div layoutId={layoutId} data-layout-id={layoutId} transition={spring.expand} className="overflow-hidden">
      {inner}
    </motion.div>
  );
}

/**
 * "Permit set · 12 Oct", or "Permit set · In 3 days". A deadline in the past says so in the attention color (redesign spec 5.4).
 * With no named deadline, "Stage ends · 12 Oct" gives the end of the current stage, the date that the Late tag reads (fbk_004).
 */
export function NextDeadlineLabel({ deadline, stageEnd, continuous }: { deadline: ProjectSummary['nextDeadline']; stageEnd?: ProjectSummary['stageEnd']; continuous?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  // A continuous project (fbk_069) never ends: with no named deadline it says "Continuous", also when a stage has an end date.
  if (!deadline && continuous) return <span className="text-footnote text-ink-2">{t('projects.continuous')}</span>;
  const shown = deadline ?? (stageEnd ? { name: t('projects.stageEnds'), date: stageEnd.date, daysLeft: stageEnd.daysLeft } : null);
  if (!shown) return <span className="text-footnote text-ink-2">{t('projects.noDeadline')}</span>;
  const word = wordForDays(shown.daysLeft);
  const when = word.key === 'dueOn' ? formatDay(shown.date, lang) : dueText(word, t, lang, shown.date);
  // The stage word is the one fact that says what the date is, so this line wraps on a narrow row and never cuts it: the phone
  // check cut "نهاية المرحلة" to "نهاي..." on a Late row (2026-10-12).
  if (!deadline) {
    return (
      <p className={`min-w-0 max-w-full text-footnote ${word.tone === 'attn' ? 'text-attn' : 'text-ink-2'}`}>
        <bdi className={`font-medium ${word.tone === 'attn' ? '' : 'text-ink'}`}>{shown.name}</bdi>
        <span className="tabular"> · {when}</span>
      </p>
    );
  }
  // On a narrow row the name gives way and the date stays whole: the date is what the line is for (audit 2026-10-03, V-32).
  // inline-flex keeps the end alignment of a wide row; whitespace-pre keeps the space before the dot.
  return (
    <p className={`inline-flex min-w-0 max-w-full items-baseline text-footnote ${word.tone === 'attn' ? 'text-attn' : 'text-ink-2'}`}>
      <bdi className={`min-w-0 truncate font-medium ${word.tone === 'attn' ? '' : 'text-ink'}`}>{shown.name}</bdi>
      <span className="tabular shrink-0 whitespace-pre"> · {when}</span>
    </p>
  );
}
