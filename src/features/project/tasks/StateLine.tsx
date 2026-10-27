import { useTranslation } from 'react-i18next';
import type { TaskDetail } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { BadgeAlertIcon } from '../../../components/icons/animated/badge-alert';
import { PauseIcon } from '../../../components/icons/animated/pause';
import { todayISO } from '../../../lib/dates';
import { whenOf } from '../../../lib/due';
import { versionOf } from '../../../lib/taskPeople';
import { isWaiting, waitingNames } from '../../../lib/waiting';
import { DueSign, VersionBadge } from './TaskSigns';

/**
 * One line of quiet facts under the title: the status word; "Starts Sun 4 Oct" when the start is later, else the due word; Flagged; the
 * version badge from version 2; and "Waiting for X". It shows only what is true. The late sign shows only for a past due date, never for a
 * to-do in review.
 */
export function StateLine({ data }: { data: TaskDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { task } = data;
  const day = todayISO();
  const when = whenOf(task, day, t, lang);
  const waiting = task.status !== 'done' && isWaiting(data);
  const version = versionOf(task);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-ink-2">
      <span>{t(`taskStatus.${task.status}`)}</span>
      {when && <DueSign when={when} />}
      {task.flagged && <span className="inline-flex items-center gap-1 text-attn"><AnimatedIcon icon={BadgeAlertIcon} size={12} aria-hidden />{t('tasks.flagged')}</span>}
      {version > 1 && <VersionBadge version={version} />}
      {waiting && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <AnimatedIcon icon={PauseIcon} size={12} className="shrink-0" aria-hidden />
          <span dir="auto" className="min-w-0">{t('tasks.waitingFor', { names: waitingNames(data, lang) })}</span>
        </span>
      )}
    </div>
  );
}
