import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { Sheet } from '../../../components/Sheet';
import { StatusSign } from '../../../components/StatusSign';
import { todayISO } from '../../../lib/dates';
import { dueText, dueWord } from '../../../lib/due';
import { counted } from '../../../lib/grammar';
import { needsAttention } from '../../../lib/overview';
import { compareTasks } from '../../../lib/stageFlow';

type Person = { owner: NonNullable<TaskRow['owner']>; open: TaskRow[]; late: number };

/**
 * The leads of the open tasks of one project. The busiest person is first, then the one with more late tasks, then by name.
 * A task with no lead belongs to nobody, so it counts for no person here (owner, 2026-10-05).
 */
function peopleOf(rows: TaskRow[], today: string): Person[] {
  const late = new Set(needsAttention(rows, today).pastDue.map((row) => row.task.id));
  const byId = new Map<string, Person>();
  for (const row of rows) {
    if (row.task.status === 'done' || !row.owner) continue;
    const person = byId.get(row.owner.id) ?? { owner: row.owner, open: [], late: 0 };
    person.open.push(row);
    if (late.has(row.task.id)) person.late += 1;
    byId.set(row.owner.id, person);
  }
  return [...byId.values()]
    .map((person) => ({ ...person, open: person.open.sort((a, b) => compareTasks(a.task, b.task)) }))
    .sort((a, b) => b.open.length - a.open.length || b.late - a.late || a.owner.name.localeCompare(b.owner.name));
}

function PersonSheet({ person, onOpenTask, onClose }: { person: Person; onOpenTask: (taskId: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const today = todayISO();
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={person.owner.name}>
      <ul className="hairline pt-2">
        {person.open.map((row) => {
          const word = dueWord(row.task.dueDate, today, row.task.status);
          const when = word && row.task.dueDate ? dueText(word, t, lang, row.task.dueDate) : null;
          return (
            <li key={row.task.id}>
              {/* The sheet closes first, so two panels never stack. Then the task panel opens over the meeting. */}
              <button type="button" onClick={() => { onClose(); onOpenTask(row.task.id); }} className="pressable flex w-full items-center gap-3 rounded-2xl py-2.5 text-start">
                <bdi className="min-w-0 flex-1 truncate text-[19px] font-semibold text-ink">{row.task.title}</bdi>
                {when && (word?.tone === 'attn' ? <StatusSign state="late">{when}</StatusSign> : <span className="tabular shrink-0 text-[15px] text-ink-2">{when}</span>)}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/**
 * One line under the project header: each lead of an open task, with the open and late counts. A press lists the tasks
 * of that person. Without an open task the line is not drawn at all.
 */
export function PeopleStrip({ tasks, onOpenTask }: { tasks: TaskRow[]; onOpenTask: (taskId: string) => void }) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const people = peopleOf(tasks, todayISO());
  if (people.length === 0) return null;
  const shown = people.find((person) => person.owner.id === openId);
  return (
    <section aria-label={t('dashboard.meeting.people')} className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <h3 className="sr-only">{t('dashboard.meeting.people')}</h3>
      <ul className="flex flex-wrap gap-2">
        {people.map((person) => (
          <li key={person.owner.id}>
            <button type="button" onClick={() => setOpenId(person.owner.id)} className="pressable flex items-center gap-2 rounded-full bg-fill py-1.5 pe-4 ps-1.5 text-start">
              <span aria-hidden className="shrink-0"><Avatar user={person.owner} size={28} /></span>
              <span className="text-[15px] text-ink-2">
                <bdi className="text-[17px] font-semibold text-ink">{person.owner.name}</bdi>{' '}
                <span className="tabular">
                  {counted(t, 'dashboard.meeting.personOpen', person.open.length)}
                  {person.late > 0 && <> · <span className="text-attn">{counted(t, 'dashboard.meeting.personLate', person.late)}</span></>}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shown && <PersonSheet person={shown} onOpenTask={onOpenTask} onClose={() => setOpenId(null)} />}
    </section>
  );
}
