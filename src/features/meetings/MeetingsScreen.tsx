import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { MeetingRow } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { useStableHandler } from '../../app/useStableHandler';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { LoadFailed } from '../../components/LoadFailed';
import { ScreenControls } from '../../components/ScreenControls';
import { ScreenTitle } from '../../components/ScreenTitle';
import { todayISO, type DayStyle } from '../../lib/dates';
import { closeMeeting, meetingParam, openMeeting } from '../../lib/params';
import { WorkSwitch } from '../work/WorkSwitch';
import { groupMeetings, type MeetingGroup } from './groups';
import { MeetingForm } from './MeetingForm';
import { MeetingListRow } from './MeetingRow';
import { MeetingSheet } from './MeetingSheet';
import { usePlanRights } from './planRights';
import { meetingsListInput } from './readInputs';

/** The day above the time of a row, by group. The Today group shows the time alone. */
const DAY_STYLE: Record<MeetingGroup, DayStyle | undefined> = { today: undefined, week: 'weekdayDay', later: 'short' };

const SECTION = 'surface overflow-hidden rounded-card pb-2';
const HEADING = 'px-4 pb-1 pt-3 text-headline';

/**
 * The groups and the empty line. It takes plain props and a stable handler, so a link change that only opens or closes the sheet
 * does not render the rows again (performance audit 2026-10-07, RND-2). "today" comes from the parent, so a new day gives new groups.
 */
const MeetingsBody = memo(function MeetingsBody({ rows, today, onOpen }: { rows: MeetingRow[]; today: string; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const { earlier, groups } = useMemo(() => groupMeetings(rows, today), [rows, today]);
  const [showEarlier, setShowEarlier] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      {groups.length === 0 && <EmptyState body={t('meetings.empty')} />}
      {groups.map(({ group, rows: inGroup }) => (
        <section key={group} aria-labelledby={`meetings-${group}`} className={SECTION}>
          <h2 id={`meetings-${group}`} className={HEADING}>{t(`meetings.group.${group}`)}</h2>
          <ul className="hairline">
            {inGroup.map((row) => <MeetingListRow key={row.id} row={row} dayStyle={DAY_STYLE[group]} onOpen={onOpen} />)}
          </ul>
        </section>
      ))}
      {earlier.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={showEarlier}
            onClick={() => setShowEarlier((open) => !open)}
            className="pressable flex min-h-11 items-center self-start rounded-full px-3 text-subheadline font-semibold text-ink-2 hover:bg-fill"
          >
            {t('meetings.earlier', { n: earlier.length })}
          </button>
          {showEarlier && (
            <div className={SECTION}>
              <ul className="hairline pt-2">
                {earlier.map((row) => <MeetingListRow key={row.id} row={row} dayStyle="short" onOpen={onOpen} />)}
              </ul>
            </div>
          )}
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
  const list = useCall('meetings.list', meetingsListInput(today));
  const open = useStableHandler((id: string) => setParams((current) => openMeeting(current, id)));
  const close = useCallback(() => setParams((current) => closeMeeting(current)), [setParams]);
  const meetingId = meetingParam(params.get('meeting'));
  // "New meeting" shows when the person may plan at least one kind of meeting (role rights version 2).
  const mayPlan = usePlanRights().any;
  return (
    <div className="flex flex-col">
      <ScreenTitle
        title={t('screens.myWork')}
        action={mayPlan ? (
          <Button variant="primary" className="shrink-0" onClick={() => setPlanning(true)}>
            <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
            {t('meetings.new')}
          </Button>
        ) : undefined}
      />
      <ScreenControls>
        <WorkSwitch />
      </ScreenControls>
      {list.error && !list.data && <LoadFailed error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && <MeetingsBody rows={list.data} today={today} onOpen={open} />}
      {meetingId && <MeetingSheet key={meetingId} meetingId={meetingId} onClose={close} />}
      {mayPlan && <MeetingForm open={planning} onOpenChange={setPlanning} />}
    </div>
  );
}
