import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { formatDay, todayISO } from '../../../lib/dates';
import { counted } from '../../../lib/grammar';
import { needsAttention } from '../../../lib/overview';
import { compareTasks, shiftPlan } from '../../../lib/stageFlow';

/**
 * What waits for what, and which dates move if a late task finishes today (owner, 2026-10-02). The rows are the open tasks of one
 * project. The move lines come from "shiftPlan", the same rule the real shift uses. The panel is not drawn when it has no lines.
 */
export function ChainsPanel({ tasks }: { tasks: TaskRow[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const today = todayISO();
  const open = tasks.filter((row) => row.task.status !== 'done').sort((a, b) => compareTasks(a.task, b.task));
  const waits = open.flatMap((row) => row.waitingFor.tasks.map((needed) => ({ key: `${row.task.id}-${needed.id}`, task: row.task.title, needed: needed.title })));
  const moves = needsAttention(open, today).pastDue.flatMap((late) => {
    const dependents = open.filter((row) => (row.task.prerequisiteIds ?? []).includes(late.task.id));
    const titles = new Map(dependents.map((row) => [row.task.id, row.task.title]));
    return shiftPlan(late.task, dependents.map((row) => row.task), today).map((move) => ({ key: `${late.task.id}-${move.id}`, late: late.task.title, dependent: titles.get(move.id) ?? '', move }));
  });
  if (waits.length + moves.length === 0) return null;
  return (
    <section aria-label={t('dashboard.meeting.chains')} className="panel flex flex-col gap-2 p-5">
      <h3 className="text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-2">{t('dashboard.meeting.chains')}</h3>
      <ul className="flex flex-col gap-2 pt-1">
        {waits.map((line) => (
          <li key={`w-${line.key}`} dir="auto" className="text-[17px] text-ink">
            {t('dashboard.meeting.waitsFor', { task: line.task, needed: line.needed })}
          </li>
        ))}
        {moves.map((line) => (
          <li key={`m-${line.key}`} dir="auto" className="text-[17px] text-ink">
            {t('dashboard.meeting.ifFinishesToday', {
              late: line.late, dependent: line.dependent,
              lateness: counted(t, 'taskSheet.durationValue', line.move.lateDays), date: formatDay(line.move.to.dueDate, lang, 'withWeekday'),
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
