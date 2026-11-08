import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { CallOutput } from '../../api/calls';
import type { TaskRow } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useCall } from '../../app/runtime';
import { useRight } from '../../app/useRight';
import { Button } from '../../components/Button';
import { TextArea } from '../../components/Fields';
import { CHECKIN_LIMITS } from '../../api/contract/limits';
import { weekKindOf, weekLines } from '../../lib/week';
import { weekMineInput } from './readInputs';

/**
 * The weekly question on Home (fbk_088, owner 2026-11-08). Sunday to Wednesday it asks "What do you plan this week?", Thursday to Saturday
 * "What did you do this week?". It is a card, never a pop-up: nothing opens by itself and no sheet covers the work of the person.
 *
 * The card starts with the to-dos of the person (due this week on Sunday, finished since Sunday on Thursday), each one kept until the person clears
 * it, and one box "Anything else". One Save button that is not the main button of Home. After Save the card is one quiet line, "Plan sent.", with
 * "Edit" and a link to the week of the team. The lines come from the Home list `tasks.list { filter: 'mine' }`, so the card asks the server for
 * nothing but the own answers (`checkins.mine`, started by Home in its first request).
 */
export function WeekCard({ today, mine }: { today: string; mine: TaskRow[] }) {
  const canAnswer = useRight('checkin.answer');
  const answers = useCall('checkins.mine', weekMineInput(today));
  if (!canAnswer || !answers.data) return null;
  const kind = weekKindOf(today);
  const answer = answers.data[kind];
  return <Question key={answer?.id ?? 'new'} kind={kind} today={today} mine={mine} answer={answer} />;
}

type Answer = CallOutput<'checkins.mine'>['plan'];

function Question({ kind, today, mine, answer }: { kind: 'plan' | 'review'; today: string; mine: TaskRow[]; answer: Answer }) {
  const { t } = useTranslation();
  const canRead = useRight('checkin.read');
  const [editing, setEditing] = useState(false);
  if (answer && !editing) {
    return (
      <section aria-label={t(`week.${kind}.title`)} className="panel flex flex-wrap items-center gap-x-1 gap-y-0 px-5 py-1">
        <p className="min-w-0 pe-2 text-subheadline text-ink-2">{t(`week.${kind}.sent`)}</p>
        <Button variant="plain" className="px-3" onClick={() => setEditing(true)}>{t('common.edit')}</Button>
        {canRead && <Link to="/week" className="flex min-h-11 items-center px-3 text-subheadline font-semibold text-link">{t('week.teamLink')}</Link>}
      </section>
    );
  }
  return <Form kind={kind} today={today} mine={mine} answer={answer} onClose={answer ? () => setEditing(false) : undefined} />;
}

/** One line of the form: a to-do of the person, kept or cleared. */
type Line = { taskId: string; title: string };

function Form({ kind, today, mine, answer, onClose }: { kind: 'plan' | 'review'; today: string; mine: TaskRow[]; answer: Answer; onClose?: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const [text, setText] = useState(answer?.text ?? '');
  // A line that the person cleared (a new answer keeps every line) or ticked (an answer being edited keeps its saved lines).
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const save = useUndoable('checkins.save', { message: (output) => t(`week.${output.kind}.saved`), onSuccess: () => onClose?.() });
  const saved = new Map((answer?.items ?? []).map((item) => [item.taskId, item.title]));
  const candidates: Line[] = weekLines(kind, today, mine).map((row) => ({ taskId: row.task.id, title: row.task.title }));
  // A saved line whose to-do is no longer a candidate (it moved or was finished) stays on the form with the title it had.
  const lines: Line[] = [...candidates, ...[...saved].filter(([taskId]) => !candidates.some((line) => line.taskId === taskId)).map(([taskId, title]) => ({ taskId, title }))]
    .slice(0, CHECKIN_LIMITS.itemsMax);
  const kept = (taskId: string) => choice[taskId] ?? (answer ? saved.has(taskId) : true);
  const keptIds = lines.filter((line) => kept(line.taskId)).map((line) => line.taskId);
  const empty = keptIds.length === 0 && text.trim() === '';
  return (
    <section aria-labelledby={titleId} className="panel flex flex-col gap-4 px-5 py-4">
      <h2 id={titleId} className="text-section text-ink">{t(`week.${kind}.title`)}</h2>
      {lines.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{t(`week.${kind}.lines`)}</legend>
          <ul className="flex max-h-56 flex-col overflow-y-auto">
            {lines.map((line) => (
              <li key={line.taskId}>
                <label className="flex min-h-11 items-center gap-3 py-1 text-subheadline text-ink">
                  <input
                    type="checkbox"
                    checked={kept(line.taskId)}
                    onChange={(event) => setChoice((current) => ({ ...current, [line.taskId]: event.target.checked }))}
                    className="size-5 shrink-0 accent-[var(--sig-from)]"
                  />
                  <bdi className="min-w-0 flex-1">{line.title}</bdi>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <TextArea id={`${titleId}-text`} label={t('week.text')} dir="auto" rows={2} maxLength={CHECKIN_LIMITS.textMax} value={text} onChange={(event) => setText(event.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={empty || save.isPending} onClick={() => save.mutate({ kind, items: keptIds, text })}>{t('common.save')}</Button>
        {onClose && <Button variant="plain" onClick={onClose}>{t('common.cancel')}</Button>}
      </div>
    </section>
  );
}
