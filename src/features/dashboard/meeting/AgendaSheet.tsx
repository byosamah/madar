import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { ProjectTile } from '../../../components/ProjectTile';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Sheet } from '../../../components/Sheet';
import { StatusSign } from '../../../components/StatusSign';
import { Switch } from '../../../components/Switch';
import { counted } from '../../../lib/grammar';
import type { DashboardData } from '../Tiles';
import { MEETING_MINUTES, type MeetingMinutes, type MeetingSession } from './session';

type Row = DashboardData['schedule'][number];

// The letters are keys, not words, so they stay outside the translated text.
const KEYS = [['N', 'next'], ['B', 'back'], ['A', 'agenda'], ['T', 'timer'], ['Esc', 'leave']] as const;

const HEADING = 'text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-2';

/**
 * The agenda of the meeting: the projects in order with their state, a press to go to one, the summary, the time for each project,
 * the Big screen switch, and "Start a new meeting". A new meeting clears the marks and the timers, so the first press only asks.
 */
export function AgendaSheet({ rows, session, bigScreen, onBigScreen, onPick, onSummary, onClose }: {
  rows: ReadonlyMap<string, Row>;
  session: MeetingSession;
  bigScreen: boolean;
  onBigScreen: (on: boolean) => void;
  /** A press on a project: the meeting shows that project on the project screens. */
  onPick: (id: string) => void;
  onSummary: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('dashboard.meeting.agenda')}
      // "Start a new meeting" is rare, so it sits quietly at the end of the panel. The footer shows only while it asks.
      footer={asking ? (
        <>
          <p className="basis-full text-[17px] text-ink">{t('dashboard.meeting.restartAsk')}</p>
          {/* A double press must not clear the meeting. Cancel takes the focus, and the confirm, with its own name,
              goes to the start side, away from the pointer. */}
          <Button variant="destructive" className="me-auto" onClick={() => { session.restart(); onClose(); }}>{t('dashboard.meeting.restartConfirm')}</Button>
          <Button autoFocus onClick={() => setAsking(false)}>{t('common.cancel')}</Button>
        </>
      ) : undefined}
    >
      <div className="flex flex-col gap-5 pt-2">
        {session.allDiscussed && <p role="status" className="text-[17px] font-semibold text-ink">{t('dashboard.meeting.allDiscussed')}</p>}
        <ol aria-label={t('dashboard.meeting.agendaOrder')} className="hairline">
          {session.order.map((id, index) => {
            const row = rows.get(id);
            if (!row) return null;
            const now = index === session.current;
            const discussed = session.discussed.has(id);
            const states = [
              now ? t('dashboard.meeting.agendaStates.now') : null,
              id === session.nextId ? t('dashboard.meeting.agendaStates.next') : null,
            ].filter((state): state is string => state !== null);
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-current={now ? 'step' : undefined}
                  onClick={() => { onPick(id); onClose(); }}
                  className="pressable flex w-full items-center gap-3 rounded-2xl py-2.5 text-start"
                >
                  <span className="tabular w-6 shrink-0 text-[15px] text-ink-2">{index + 1}</span>
                  <ProjectTile id={row.project.id} mark={row.project.mark} size={36} />
                  {/* A discussed project fades and carries the check, so the eye goes to what is left. */}
                  <bdi className={`min-w-0 flex-1 truncate text-[17px] ${now ? 'font-bold text-ink' : discussed ? 'font-medium text-ink-2' : 'font-semibold text-ink'}`}>{row.project.name}</bdi>
                  {discussed && <StatusSign state="completed">{t('dashboard.meeting.discussed')}</StatusSign>}
                  {states.length > 0 && <span className="shrink-0 text-[15px] text-ink-2">{states.join(' · ')}</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <Button className="self-start" onClick={() => { onClose(); onSummary(); }}>{t('dashboard.meeting.seeSummary')}</Button>
        <div className="flex flex-col gap-2">
          <h3 className={HEADING}>{t('dashboard.meeting.timeEach')}</h3>
          <SegmentedControl
            label={t('dashboard.meeting.timeEach')}
            value={String(session.minutes)}
            onChange={(value) => session.setMinutes(Number(value) as MeetingMinutes)}
            options={MEETING_MINUTES.map((minutes) => ({ value: String(minutes), label: counted(t, 'dashboard.meeting.minutes', minutes) }))}
          />
        </div>
        <Switch id="meeting-big-screen" label={t('dashboard.meeting.bigScreen')} description={t('dashboard.meeting.bigScreenHint')} checked={bigScreen} onChange={onBigScreen} />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-ink-2">
          <span>{t('dashboard.meeting.keys.label')}</span>
          {KEYS.map(([key, word]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <kbd dir="ltr" className="rounded-md bg-fill px-1.5 py-0.5 font-sans text-[14px] font-semibold text-ink">{key}</kbd>
              <span>{t(`dashboard.meeting.keys.${word}`)}</span>
            </span>
          ))}
        </p>
        {!asking && <Button variant="plain" className="self-start" onClick={() => setAsking(true)}>{t('dashboard.meeting.restart')}</Button>}
      </div>
    </Sheet>
  );
}
