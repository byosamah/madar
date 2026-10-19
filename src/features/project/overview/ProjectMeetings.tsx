import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../../app/lang';
import { useCall } from '../../../app/runtime';
import { Button } from '../../../components/Button';
import { clockFormat, formatDay, now, stampDay, todayISO } from '../../../lib/dates';
import { meetingLink, phaseOf } from '../../../lib/meetings';
import { isLive } from '../../../lib/overview';
import { MeetingForm } from '../../meetings/MeetingForm';
import { projectMeetingsInput } from '../../meetings/readInputs';
import type { TabProps } from '../tabs';

/** The most meetings the panel shows. */
const ROWS = 2;

/**
 * The Meetings panel of the project Overview (fbk_022, owner 2026-10-19): the next two meetings of the project and one text button,
 * "Plan a meeting". It shows for a project that has a meeting, and for a person who may plan one: the team, the leader and the Admin
 * (`viewerCan.post`, the right of `meeting.create`) on a project that is open. A cancelled meeting and one that is over do not count.
 */
export function ProjectMeetings({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const [planning, setPlanning] = useState(false);
  const { project } = detail;
  const list = useCall('meetings.list', projectMeetingsInput(project.id, todayISO()));
  if (!list.data) return null;
  const at = now();
  const next = list.data.filter((row) => {
    const phase = phaseOf(row, at);
    return phase === 'upcoming' || phase === 'now';
  }).slice(0, ROWS);
  const mayPlan = detail.viewerCan.post && isLive(project.status);
  if (next.length === 0 && !mayPlan) return null;
  return (
    <section aria-labelledby="overview-meetings" className="panel flex flex-col gap-2 p-5">
      <h2 id="overview-meetings" className="text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2">{t('meetings.project.title')}</h2>
      {next.length === 0 ? <p className="text-subheadline text-ink-2">{t('meetings.project.none')}</p> : (
        <ul className="-mx-2 flex flex-col">
          {next.map((row) => (
            <li key={row.id}>
              <Link to={meetingLink(row.id)} className="pressable flex min-h-11 w-full flex-col justify-center rounded-xl px-2 py-1.5 transition-colors hover:bg-fill/50">
                <bdi className="block truncate text-subheadline font-medium text-ink">{row.title}</bdi>
                <span className="tabular block truncate text-footnote text-ink-2">
                  {formatDay(stampDay(row.startsAt), lang, 'withWeekday')} · {clockFormat(lang).format(new Date(row.startsAt))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {mayPlan && <Button variant="plain" className="self-start px-0" onClick={() => setPlanning(true)}>{t('meetings.project.plan')}</Button>}
      {mayPlan && <MeetingForm open={planning} onOpenChange={setPlanning} project={{ id: project.id, name: project.name }} />}
    </section>
  );
}
