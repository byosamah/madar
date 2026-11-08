import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { Checkin } from '../../api/contract/entities';
import type { UserCard } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { usePersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { LoadFailed } from '../../components/LoadFailed';
import { ScreenTitle } from '../../components/ScreenTitle';
import { addDays, formatDay, listFormat } from '../../lib/dates';
import { dayParam } from '../../lib/params';

/**
 * The week of the team (fbk_088, owner 2026-11-08: everyone reads every answer). One row for each person who answered, with the plan and what
 * was done side by side, and two short lines for the people who have not answered yet. Two quiet links step to the week before and the week after
 * (`?week=` holds the Sunday). The page needs the switch "Read the weekly answers"; the route asks it.
 */
export function WeekScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const nameOf = usePersonName();
  const [params] = useSearchParams();
  const week = dayParam(params.get('week'));
  const view = useCall('checkins.week', week ? { week } : {});
  const data = view.data;
  // A name keeps its own direction inside the sentence (FSI and PDI), so an English name stays whole in Arabic.
  const names = (people: UserCard[]) => listFormat(lang).format(people.map((person) => `\u2068${nameOf(person)}\u2069`));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ScreenTitle title={t('week.page.title')}>
        {data && t('week.page.range', { from: formatDay(data.week, lang, 'short'), to: formatDay(addDays(data.week, 4), lang, 'short') })}
      </ScreenTitle>
      {view.error && !data ? <LoadFailed error={view.error} onRetry={() => void view.refetch()} /> : null}
      {data && (
        <>
          <nav className="flex flex-wrap items-center justify-between gap-x-4">
            <Link to={`/week?week=${data.previous}`} className="flex min-h-11 items-center text-subheadline font-semibold text-link">{t('week.page.previous')}</Link>
            {data.next && <Link to={`/week?week=${data.next}`} className="flex min-h-11 items-center text-subheadline font-semibold text-link">{t('week.page.next')}</Link>}
          </nav>
          {data.rows.length === 0 && <p className="panel px-5 py-4 text-subheadline text-ink-2">{t('week.page.empty')}</p>}
          <ul className="flex flex-col gap-3">
            {data.rows.map((row) => (
              <li key={row.user.id} className="panel flex flex-col gap-3 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar user={row.user} size={32} />
                  <bdi className="min-w-0 truncate text-body font-semibold text-ink">{nameOf(row.user)}</bdi>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Answer title={t('week.page.plan')} answer={row.plan} />
                  <Answer title={t('week.page.review')} answer={row.review} />
                </div>
              </li>
            ))}
          </ul>
          {(data.missing.plan.length > 0 || data.missing.review.length > 0) && (
            <div className="flex flex-col gap-1 px-1 text-subheadline text-ink-2">
              {data.missing.plan.length > 0 && <p>{t('week.page.missingPlan', { names: names(data.missing.plan) })}</p>}
              {data.missing.review.length > 0 && <p>{t('week.page.missingReview', { names: names(data.missing.review) })}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One answer: its lines (the titles of the kept to-dos) and its words, or a quiet "No answer yet". */
function Answer({ title, answer }: { title: string; answer: Checkin | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h2 className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</h2>
      {answer === null ? (
        <p className="text-subheadline text-ink-2">{t('week.page.none')}</p>
      ) : (
        <>
          {answer.items.length > 0 && (
            <ul className="flex list-disc flex-col gap-0.5 ps-5 text-subheadline text-ink">
              {answer.items.map((item) => <li key={item.taskId}><bdi>{item.title}</bdi></li>)}
            </ul>
          )}
          {answer.text !== '' && <p dir="auto" className="whitespace-pre-wrap text-subheadline text-ink [overflow-wrap:anywhere]">{answer.text}</p>}
        </>
      )}
    </div>
  );
}
