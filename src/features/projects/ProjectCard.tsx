import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '../../api/contract/views';
import { useFileUrl } from '../../app/files';
import { useLang } from '../../app/lang';
import { tintOf } from '../../components/Avatar';
import { spring } from '../../design/motion';
import { formatDay } from '../../lib/dates';
import { dueText, wordForDays } from '../../lib/due';

/** The latest render at 16:9, or a tinted panel with the project code when there is no cover (spec 4.1). */
export function ProjectCover({ summary, className = 'aspect-video', layoutId }: { summary: ProjectSummary; className?: string; layoutId?: string }) {
  const { t } = useTranslation();
  const url = useFileUrl(summary.project.coverFileId, summary.coverLetter ?? undefined);
  const label = t('projects.cover', { name: summary.project.name });
  const inner = url
    ? <img src={url} alt={label} className={`w-full object-cover ${className}`} />
    : (
      <div role="img" aria-label={label} style={{ background: tintOf(summary.project.id) }} className={`grid w-full place-items-center ${className}`}>
        <span className="tabular text-title-2 font-bold text-white">{summary.project.code}</span>
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

/** "Permit set · 12 Oct", or "Permit set · In 3 days". A deadline in the past says so in the attention color (redesign spec 5.4). */
export function NextDeadlineLabel({ deadline }: { deadline: ProjectSummary['nextDeadline'] }) {
  const { t } = useTranslation();
  const lang = useLang();
  if (!deadline) return <span className="text-footnote text-ink-2">{t('projects.noDeadline')}</span>;
  const word = wordForDays(deadline.daysLeft);
  const when = word.key === 'dueOn' ? formatDay(deadline.date, lang) : dueText(word, t, lang, deadline.date);
  return (
    <p className={`min-w-0 truncate text-footnote ${word.tone === 'attn' ? 'text-attn' : 'text-ink-2'}`}>
      <bdi className={`font-medium ${word.tone === 'attn' ? '' : 'text-ink'}`}>{deadline.name}</bdi>
      <span className="tabular"> · {when}</span>
    </p>
  );
}
