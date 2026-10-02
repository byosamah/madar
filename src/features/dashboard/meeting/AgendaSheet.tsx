import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { ProjectTile } from '../../../components/ProjectTile';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Sheet } from '../../../components/Sheet';
import { counted } from '../../../lib/grammar';
import type { DashboardData } from '../Tiles';
import { MEETING_MINUTES, type MeetingMinutes, type MeetingSession } from './session';

type Row = DashboardData['schedule'][number];

// The letters are keys, not words, so they stay outside the translated text.
const KEYS = [['N', 'next'], ['B', 'back'], ['A', 'agenda'], ['T', 'timer'], ['Esc', 'leave']] as const;

const HEADING = 'text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-2';

/**
 * The agenda of the meeting: the projects in order with their state, a press to go to one, the time for each project,
 * and "Start a new meeting".
 */
export function AgendaSheet({ rows, session, onClose }: { rows: ReadonlyMap<string, Row>; session: MeetingSession; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('dashboard.meeting.agenda')}
      footer={<Button onClick={() => { session.restart(); onClose(); }}>{t('dashboard.meeting.restart')}</Button>}
    >
      <div className="flex flex-col gap-5 pt-2">
        {session.allDiscussed && <p role="status" className="text-[17px] font-semibold text-ink">{t('dashboard.meeting.allDiscussed')}</p>}
        <ol aria-label={t('dashboard.meeting.agendaOrder')} className="hairline">
          {session.order.map((id, index) => {
            const row = rows.get(id);
            if (!row) return null;
            const now = index === session.current;
            const states = [
              session.discussed.has(id) ? t('dashboard.meeting.discussed') : null,
              now ? t('dashboard.meeting.agendaStates.now') : null,
              id === session.nextId ? t('dashboard.meeting.agendaStates.next') : null,
            ].filter((state): state is string => state !== null);
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-current={now ? 'step' : undefined}
                  onClick={() => { session.goTo(index); onClose(); }}
                  className="pressable flex w-full items-center gap-3 rounded-2xl py-2.5 text-start"
                >
                  <span className="tabular w-6 shrink-0 text-[15px] text-ink-2">{index + 1}</span>
                  <ProjectTile id={row.project.id} mark={row.project.mark} size={36} />
                  <bdi className={`min-w-0 flex-1 truncate text-[17px] ${now ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>{row.project.name}</bdi>
                  {states.length > 0 && <span className="shrink-0 text-[15px] text-ink-2">{states.join(' · ')}</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-ink-2">
          <span>{t('dashboard.meeting.keys.label')}</span>
          {KEYS.map(([key, word]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <kbd dir="ltr" className="rounded-md bg-fill px-1.5 py-0.5 font-sans text-[14px] font-semibold text-ink">{key}</kbd>
              <span>{t(`dashboard.meeting.keys.${word}`)}</span>
            </span>
          ))}
        </p>
        <div className="flex flex-col gap-2">
          <h3 className={HEADING}>{t('dashboard.meeting.timeEach')}</h3>
          <SegmentedControl
            label={t('dashboard.meeting.timeEach')}
            value={String(session.minutes)}
            onChange={(value) => session.setMinutes(Number(value) as MeetingMinutes)}
            options={MEETING_MINUTES.map((minutes) => ({ value: String(minutes), label: counted(t, 'dashboard.meeting.minutes', minutes) }))}
          />
        </div>
      </div>
    </Sheet>
  );
}
