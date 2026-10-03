import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../app/toasts';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PauseIcon } from '../../../components/icons/animated/pause';
import { PlayIcon } from '../../../components/icons/animated/play';
import { Button } from '../../../components/Button';
import type { MeetingSession } from './session';

/** Seconds as minutes and seconds, for example 4:12. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The quiet timer of the project on the screen: "4:12 left", then "1:05 over" in the attention color.
 * It is also the pause control: one press stops the count, the next press continues it.
 * No sound, no popup, no flashing. Only this small part draws again each second, not the whole meeting screen.
 */
function Timer({ id, minutes, running, paused, elapsedFor, onToggle }: { id: string; minutes: number; running: boolean; paused: boolean; elapsedFor: (id: string) => number; onToggle: () => void }) {
  const { t } = useTranslation();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [running]);
  const left = minutes * 60 - Math.floor(elapsedFor(id) / 1000);
  const time = left < 0 ? t('dashboard.meeting.timeOver', { time: clock(-left) }) : t('dashboard.meeting.timeLeft', { time: clock(left) });
  const label = paused ? t('dashboard.meeting.resumeTimer') : t('dashboard.meeting.pauseTimer');
  return (
    <Button aria-label={label} title={label} variant="plain" className={`tabular !px-3 text-[17px] ${left < 0 ? '!text-attn' : '!text-ink-2'}`} onClick={onToggle}>
      <AnimatedIcon icon={paused ? PlayIcon : PauseIcon} size={18} aria-hidden className="size-[18px] shrink-0" />
      <span role="timer" className={left < 0 ? 'text-attn' : undefined}>{paused ? t('dashboard.meeting.timerPaused', { time }) : time}</span>
    </Button>
  );
}

/** The Agenda button of the meeting top bar. On the project screens it shows the position, for example "Agenda 3 of 9". */
export function AgendaButton({ session, showPosition, onOpenAgenda }: { session: MeetingSession; showPosition: boolean; onOpenAgenda: () => void }) {
  const { t } = useTranslation();
  return (
    <Button aria-haspopup="dialog" onClick={onOpenAgenda}>
      {t('dashboard.meeting.agenda')}
      {showPosition && <> <span className="tabular font-medium text-ink-2">{t('dashboard.meeting.agendaAt', { n: session.current + 1, total: session.order.length })}</span></>}
    </Button>
  );
}

/** The timer, Done and Skip of the project on the screen. When every project is discussed, it shows that and offers the summary. */
export function AgendaBar({ session, name, onOpenSummary }: { session: MeetingSession; name: string; onOpenSummary: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { currentId } = session;
  // One wrong press of Done must have a way back, so the toast offers Undo (audit 2026-10-03, DSH-10).
  const done = () => {
    if (!currentId) return;
    const wasDiscussed = session.discussed.has(currentId);
    session.done();
    toast.show({ message: t('dashboard.meeting.discussedToast', { name }), action: { label: t('common.undo'), run: () => session.undoDone(currentId, wasDiscussed), isUndo: true } });
  };
  // Skip moved the project quietly to the end, so a wrong press looked like a lost project. The toast says where it went
  // and Undo puts it back in its place (audit 2026-10-03, F-21).
  const skip = () => {
    if (!currentId) return;
    const index = session.meetingIds.indexOf(currentId);
    const wasSkipped = session.skipped.has(currentId);
    session.skip();
    toast.show({ message: t('dashboard.meeting.skippedToast', { name }), action: { label: t('common.undo'), run: () => session.undoSkip(currentId, index, wasSkipped), isUndo: true } });
  };
  return (
    <>
      {session.allDiscussed ? (
        <>
          <p role="status" className="px-2 text-[17px] font-semibold text-ink">{t('dashboard.meeting.allDiscussed')}</p>
          <Button variant="plain" onClick={onOpenSummary}>{t('dashboard.meeting.openSummary')}</Button>
        </>
      ) : currentId && (
        <>
          <Timer id={currentId} minutes={session.minutes} running={session.running} paused={session.paused} elapsedFor={session.elapsedFor} onToggle={session.togglePause} />
          <Button variant="primary" onClick={done}>{t('dashboard.meeting.done')}</Button>
          <Button onClick={skip}>{t('dashboard.meeting.skip')}</Button>
        </>
      )}
    </>
  );
}
