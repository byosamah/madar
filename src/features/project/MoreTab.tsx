import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronLeftIcon } from '../../components/icons/animated/chevron-left';
import { ChevronRightIcon } from '../../components/icons/animated/chevron-right';
import { spring } from '../../design/motion';
import { ActivityTab } from './overview/ActivityTab';
import { ScheduleTab } from './schedule/ScheduleTab';
import { TeamTab } from './team/TeamTab';
import { MORE_PAGES, tabSearch, type MorePage, type TabProps } from './tabs';

const PAGE_BODY = { activity: ActivityTab, schedule: ScheduleTab, team: TeamTab } as const;

/** The More tab of a phone: one panel with a link row for each page (Activity, Schedule, Team). */
export function MoreTab(_props: TabProps) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  return (
    <div className="panel overflow-hidden">
      <ul className="flex flex-col divide-y divide-hairline">
        {MORE_PAGES.map((page) => (
          <li key={page}>
            <Link
              to={{ search: `?${tabSearch(params, page)}` }}
              className="pressable flex min-h-11 items-center gap-3 px-4 py-3"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-headline">{t(`project.tab.${page}`)}</span>
                <span className="text-footnote text-ink-2">{t(`phoneProject.more.${page}Line`)}</span>
              </span>
              <AnimatedIcon icon={ChevronRightIcon} size={20} className="text-ink-3 rtl:-scale-x-100" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One page of More: a back row to the list, the title, then the body of the tab. It slides in from the end side, by the 16 px of the page
 * gutter at most: a longer slide put part of the page outside the screen for a few frames, and the page scrolled sideways by 8 px.
 */
export function MoreSubPage({ detail, page }: TabProps & { page: MorePage }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const Body = PAGE_BODY[page];
  const rtl = document.documentElement.dir === 'rtl';
  return (
    <motion.div
      initial={{ opacity: 0, x: rtl ? -16 : 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={spring.standard}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <Link
          to={{ search: `?${tabSearch(params, 'more')}` }}
          className="pressable -ms-2 inline-flex min-h-11 w-fit items-center gap-0.5 rounded-full pe-3 ps-1 text-subheadline font-semibold text-link"
        >
          <AnimatedIcon icon={ChevronLeftIcon} size={20} className="rtl:-scale-x-100" aria-hidden />
          {t('phoneProject.more.back')}
        </Link>
        <h2 className="text-section">{t(`project.tab.${page}`)}</h2>
      </div>
      <Body detail={detail} />
    </motion.div>
  );
}
