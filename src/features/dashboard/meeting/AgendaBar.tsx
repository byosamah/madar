import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import type { MeetingSession } from './session';

/** Seconds as minutes and seconds, for example 4:12. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The quiet timer of the project on the screen: "4:12 left", then "1:05 over" in the attention color.
 * No sound, no popup, no flashing. Only this small part draws again each second, not the whole meeting screen.
 */
function Timer({ id, minutes, running, elapsedFor }: { id: string; minutes: number; running: boolean; elapsedFor: (id: string) => number }) {
  const { t } = useTranslation();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [running]);
  const left = minutes * 60 - Math.floor(elapsedFor(id) / 1000);
  return (
    <span role="timer" className={`tabular text-[17px] font-semibold ${left < 0 ? 'text-attn' : 'text-ink-2'}`}>
      {left < 0 ? t('dashboard.meeting.timeOver', { time: clock(-left) }) : t('dashboard.meeting.timeLeft', { time: clock(left) })}
    </span>
  );
}

/** The agenda part of the meeting top bar: the Agenda button with the position, the timer, and Done and Skip. When every project is discussed, it offers the summary. */
export function AgendaBar({ session, onOpenAgenda, onOpenSummary }: { session: MeetingSession; onOpenAgenda: () => void; onOpenSummary: () => void }) {
  const { t } = useTranslation();
  const { order, current, currentId } = session;
  return (
    <>
      <Button aria-haspopup="dialog" onClick={onOpenAgenda}>
        {t('dashboard.meeting.agenda')}{' '}
        <span className="tabular font-medium text-ink-2">{t('dashboard.meeting.agendaAt', { n: current + 1, total: order.length })}</span>
      </Button>
      {session.allDiscussed ? (
        <>
          <p role="status" className="px-2 text-[17px] font-semibold text-ink">{t('dashboard.meeting.allDiscussed')}</p>
          <Button variant="plain" onClick={onOpenSummary}>{t('dashboard.meeting.openSummary')}</Button>
        </>
      ) : currentId && (
        <>
          <Timer id={currentId} minutes={session.minutes} running={session.running} elapsedFor={session.elapsedFor} />
          <Button variant="plain" onClick={session.togglePause}>
            {session.paused ? t('dashboard.meeting.resumeTimer') : t('dashboard.meeting.pauseTimer')}
          </Button>
          <Button onClick={session.done}>{t('dashboard.meeting.done')}</Button>
          <Button onClick={session.skip}>{t('dashboard.meeting.skip')}</Button>
        </>
      )}
    </>
  );
}
