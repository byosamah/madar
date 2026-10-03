import { useTranslation } from 'react-i18next';
import type { TrackerRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { Button } from '../../../components/Button';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { CheckIcon } from '../../../components/icons/animated/check';
import { ageInDays } from '../../../lib/tracker';
import { todayISO } from '../../../lib/dates';
import { ageText } from './marks';

/** One open loop: the title, its age and one button to close it. The Overview shows the client's open loops too. */
export function Loop({ row, onOpen, compact = false }: { row: TrackerRow; onOpen: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  // The toast uses the word of the button and the state: Answered or Received (audit 2026-10-03, BRW-15).
  const close = useUndoable('tracker.close', { message: () => t(row.entry.waiting === 'us' ? 'tracker.answeredToast' : 'tracker.receivedToast') });
  const action = t(row.entry.waiting === 'us' ? 'tracker.answered' : 'tracker.received');
  return (
    <li className="flex min-h-14 items-center gap-3">
      <button type="button" data-entry={row.entry.id} onClick={onOpen} aria-label={t('tracker.openEntry', { title: row.entry.title })} className="pressable min-w-0 flex-1 rounded-lg py-2 text-start hover:bg-fill">
        {/* Two lines and the age under it, so a phone shows the whole question (owner review, 2026-10-01). */}
        <bdi className={`line-clamp-2 ${compact ? 'text-subheadline' : 'text-body'}`}>{row.entry.title}</bdi>
        <span className="tabular block text-footnote text-ink-2">{ageText(t, ageInDays(row.entry.date, todayISO()))}</span>
      </button>
      {row.canClose && (
        <Button
          variant="secondary"
          aria-label={t('tracker.closeLabel', { action, title: row.entry.title })}
          disabled={close.isPending}
          onClick={() => close.mutate({ id: row.entry.id })}
        >
          <AnimatedIcon icon={CheckIcon} size={16} aria-hidden />
          {action}
        </Button>
      )}
    </li>
  );
}

/** The open loops, the oldest first so the one that waited longest is on top. The section is not there when nothing is open. */
export function OpenLoops({ rows, onOpen }: { rows: TrackerRow[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  const oldestFirst = [...rows].sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.id.localeCompare(b.entry.id));
  const groups = (['us', 'client'] as const)
    .map((waiting) => ({ waiting, rows: oldestFirst.filter((row) => row.entry.waiting === waiting) }))
    .filter((group) => group.rows.length > 0);
  return (
    <section aria-labelledby="tracker-open" className="panel flex flex-col gap-3 p-4">
      <h2 id="tracker-open" className="text-section">{t('tracker.open')}</h2>
      {groups.map((group) => {
        const id = `tracker-open-${group.waiting}`;
        return (
          <div key={group.waiting} role="group" aria-labelledby={id}>
            <h3 id={id} className="text-footnote font-semibold text-ink-2">{t(group.waiting === 'us' ? 'tracker.waitingUs' : 'tracker.waitingClient')}</h3>
            <ul className="divide-y divide-hairline">
              {group.rows.map((row) => <Loop key={row.entry.id} row={row} onOpen={() => onOpen(row.entry.id)} />)}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
