import { motion } from 'motion/react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { MeetingRow } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { useIsPhone } from '../../app/useIsPhone';
import { useStableHandler } from '../../app/useStableHandler';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ChevronDownIcon } from '../../components/icons/animated/chevron-down';
import { PlusIcon } from '../../components/icons/animated/plus';
import { LoadFailed } from '../../components/LoadFailed';
import { fade } from '../../design/motion';
import { todayISO, type DayStyle } from '../../lib/dates';
import { closeMeeting, meetingParam, openMeeting } from '../../lib/params';
import { WorkHeader } from '../work/WorkHeader';
import { groupMeetings, type MeetingGroup } from './groups';
import { MeetingForm } from './MeetingForm';
import { MeetingCard, MeetingListRow } from './MeetingRow';
import { MeetingSheet } from './MeetingSheet';
import { usePlanRights } from './planRights';
import { meetingsListInput } from './readInputs';
import { useMinuteTick } from './useMinuteTick';

/** The day above the time of a row, by group. The Today group shows the time alone. */
const DAY_STYLE: Record<MeetingGroup, DayStyle | undefined> = { today: undefined, week: 'weekdayDay', later: 'short' };

const SECTION = 'surface overflow-hidden rounded-card pb-2';
const HEADING = 'px-4 pb-1 pt-3 text-headline';

/**
 * The groups and the empty line. It takes plain props and a stable handler, so a link change that only opens or closes the sheet
 * does not render the rows again (performance audit 2026-10-07, RND-2). "today" comes from the parent, so a new day gives new groups.
 */
const MeetingsBody = memo(function MeetingsBody({ rows, today, phone, minute, onOpen }: { rows: MeetingRow[]; today: string; phone: boolean; minute: number; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const { earlier, groups } = useMemo(() => groupMeetings(rows, today), [rows, today]);
  const [showEarlier, setShowEarlier] = useState(false);
  // A phone draws cards, with the clock of the list tick. A desk draws the rows of today.
  const nowMs = minute * 60_000;
  const item = (row: MeetingRow, dayStyle: DayStyle | undefined) => (phone
    ? <MeetingCard key={row.id} row={row} dayStyle={dayStyle} nowMs={nowMs} onOpen={onOpen} />
    : <MeetingListRow key={row.id} row={row} dayStyle={dayStyle} onOpen={onOpen} />);
  return (
    <div className="flex flex-col gap-5">
      {groups.length === 0 && <EmptyState body={t('meetings.empty')} />}
      {groups.map(({ group, rows: inGroup }) => (
        <section key={group} aria-labelledby={`meetings-${group}`} className={SECTION}>
          <h2 id={`meetings-${group}`} className={HEADING}>{t(`meetings.group.${group}`)}</h2>
          <ul className="hairline">
            {inGroup.map((row) => item(row, DAY_STYLE[group]))}
          </ul>
        </section>
      ))}
      {earlier.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={showEarlier}
            onClick={() => setShowEarlier((open) => !open)}
            className={phone
              ? 'pressable surface flex min-h-[52px] w-full items-center justify-between rounded-card px-4 text-subheadline font-semibold text-ink-2'
              : 'pressable flex min-h-11 items-center self-start rounded-full px-3 text-subheadline font-semibold text-ink-2 hover:bg-fill'}
          >
            {t('meetings.earlier', { n: earlier.length })}
            {phone && <AnimatedIcon icon={ChevronDownIcon} size={18} aria-hidden className={`transition-transform motion-reduce:transition-none ${showEarlier ? 'rotate-180' : ''}`} />}
          </button>
          {showEarlier && (phone ? (
            <motion.div className={SECTION} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
              <ul className="hairline pt-2">
                {earlier.map((row) => item(row, 'short'))}
              </ul>
            </motion.div>
          ) : (
            <div className={SECTION}>
              <ul className="hairline pt-2">
                {earlier.map((row) => item(row, 'short'))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * Meetings, the second view of the Tasks tab (fbk_022, owner 2026-10-19): my meetings from 7 days back to 60 days ahead, in the groups
 * Today, This week and Later, with the days before today in one folded row. The one main button plans a meeting. A press on a row
 * opens its sheet over the list (`?meeting=<id>`).
 */
export function MeetingsScreen() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [planning, setPlanning] = useState(false);
  const today = todayISO();
  const phone = useIsPhone();
  // One tick for the whole list: a card moves to Now and Done, and its Join shows, on a screen that stays open.
  const minute = useMinuteTick(phone);
  const list = useCall('meetings.list', meetingsListInput(today));
  // The quiet Google line shows only when every meeting reaches Google (state ok), and only on a phone.
  const google = useCall('google.status', {}, { enabled: phone });
  const open = useStableHandler((id: string) => setParams((current) => openMeeting(current, id)));
  const close = useCallback(() => setParams((current) => closeMeeting(current)), [setParams]);
  const meetingId = meetingParam(params.get('meeting'));
  // "New meeting" shows when the person may plan at least one kind of meeting (role rights version 2).
  const mayPlan = usePlanRights().any;
  return (
    <div className="flex flex-col">
      <WorkHeader
        action={mayPlan ? (
          <Button variant="primary" className="shrink-0" onClick={() => setPlanning(true)}>
            <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
            {t('meetings.new')}
          </Button>
        ) : undefined}
      />
      {list.error && !list.data && <LoadFailed error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && <MeetingsBody rows={list.data} today={today} phone={phone} minute={minute} onOpen={open} />}
      {phone && list.data && google.data?.state === 'ok' && <p className="pt-5 text-footnote text-ink-2">{t('phoneWork.meetings.googleLine')}</p>}
      {meetingId && <MeetingSheet key={meetingId} meetingId={meetingId} onClose={close} />}
      {mayPlan && <MeetingForm open={planning} onOpenChange={setPlanning} />}
    </div>
  );
}
