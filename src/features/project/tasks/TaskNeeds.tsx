import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_PREREQUISITES } from '../../../api/contract/limits';
import type { TaskDetail } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { useCall } from '../../../app/runtime';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../../components/icons/animated/plus';
import { XIcon } from '../../../components/icons/animated/x';
import { Button } from '../../../components/Button';
import { SelectField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { formatDay } from '../../../lib/dates';
import { counted } from '../../../lib/grammar';
import { Group, PickRow } from './DetailRows';

/**
 * One line of a task list: the title, and its state in a word. Done tasks read quietly; open ones say so. With `rows` it is a row in a
 * Group of the phone panel, with an X of 44 px for an editor.
 */
function NeedLine({ title, status, onRemove, removeLabel, rows = false }: { title: string; status: string; onRemove?: () => void; removeLabel?: string; rows?: boolean }) {
  const { t } = useTranslation();
  const done = status === 'done';
  return (
    <li className={rows ? `flex min-h-12 items-center gap-3 ps-4 ${onRemove ? 'pe-1' : 'pe-4'}` : 'flex min-h-11 items-center gap-3'}>
      <bdi className={`min-w-0 flex-1 truncate ${done ? 'text-label-2 line-through' : ''}`}>{title}</bdi>
      <span className="shrink-0 text-footnote text-label-2">{t(`taskStatus.${status}`)}</span>
      {onRemove && (
        <IconButton label={removeLabel ?? ''} onClick={onRemove}>
          <AnimatedIcon icon={XIcon} size={16} aria-hidden />
        </IconButton>
      )}
    </li>
  );
}

/**
 * "Needs first": the tasks of this project that must be done before this one can be finished. The leader and the Admin change the list;
 * everyone else reads it. "Unlocks": the tasks that need this one, read only (owner, 2026-10-02). The server checks cycles and the limit.
 * An empty list does not show. The leader gets one "Add a task it needs first" press instead (audit 2026-10-03, PRJ-8).
 */
export function TaskNeeds({ data, canEdit, onChange, layout = 'plain' }: {
  data: TaskDetail; canEdit: boolean; onChange: (prerequisiteIds: string[]) => void;
  /** `rows` is the phone layout (Direction D): two Groups, Needs first and Unlocks, with an Add row that picks the next to-do. */
  layout?: 'plain' | 'rows';
}) {
  const { t } = useTranslation();
  const { task, needsFirst, unlocks } = data;
  const project = useCall('tasks.list', { projectId: task.projectId ?? undefined, activeProjectsOnly: false }, { enabled: canEdit && task.projectId !== null });
  const ids = needsFirst.map((need) => need.id);
  // A task that waits for this one cannot also be needed first: the server would refuse it as a cycle.
  const choices = useMemo(() => {
    const blocked = new Set([task.id, ...needsFirst.map((need) => need.id), ...unlocks.map((unlock) => unlock.id)]);
    return (project.data ?? []).filter((row) => !blocked.has(row.task.id));
  }, [project.data, task.id, needsFirst, unlocks]);
  const options = useMemo(() => choices.map((row) => <option key={row.task.id} value={row.task.id}>{row.task.title}</option>), [choices]);
  const [adding, setAdding] = useState(false);
  const canAdd = canEdit && ids.length < MAX_PREREQUISITES && choices.length > 0;
  if (layout === 'rows') {
    // The group hides for an empty read only list. An editor with no need yet sees the Add row alone.
    return (
      <>
        {(needsFirst.length > 0 || canAdd) && (
          <Group title={t('taskSheet.needsFirst')} hint={needsFirst.length > 0 ? t('taskSheet.needsFirstHint') : undefined}>
            {needsFirst.length > 0 && (
              <ul className="hairline">
                {needsFirst.map((need) => (
                  <NeedLine
                    rows
                    key={need.id}
                    title={need.title}
                    status={need.status}
                    removeLabel={t('taskSheet.removeNeed', { title: need.title })}
                    onRemove={canEdit ? () => onChange(ids.filter((id) => id !== need.id)) : undefined}
                  />
                ))}
              </ul>
            )}
            {canAdd && (
              <PickRow id="task-add-need" label={t('taskSheet.addNeed')} value="" display="" onChange={(value) => { if (value) onChange([...ids, value]); }}>
                <option value="">{t('taskSheet.pickNeed')}</option>
                {options}
              </PickRow>
            )}
          </Group>
        )}
        {unlocks.length > 0 && (
          <Group title={t('taskSheet.unlocks')} hint={t('taskSheet.unlocksHint')}>
            <ul className="hairline">{unlocks.map((unlock) => <NeedLine rows key={unlock.id} title={unlock.title} status={unlock.status} />)}</ul>
          </Group>
        )}
      </>
    );
  }
  const showNeeds = needsFirst.length > 0 || (adding && canEdit);
  if (!showNeeds && unlocks.length === 0 && !canAdd) return null;
  return (
    <>
      {!showNeeds && canAdd && (
        <Button variant="plain" className="-ms-3 self-start" onClick={() => setAdding(true)}>
          <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
          {t('taskSheet.addNeed')}
        </Button>
      )}
      {showNeeds && (
        <section aria-labelledby="task-needs" className="flex flex-col gap-1">
          <h3 id="task-needs" className="text-headline">{t('taskSheet.needsFirst')}</h3>
          {needsFirst.length > 0 && <p className="text-footnote text-label-2">{t('taskSheet.needsFirstHint')}</p>}
          <ul>
            {needsFirst.map((need) => (
              <NeedLine
                key={need.id}
                title={need.title}
                status={need.status}
                removeLabel={t('taskSheet.removeNeed', { title: need.title })}
                onRemove={canEdit ? () => onChange(ids.filter((id) => id !== need.id)) : undefined}
              />
            ))}
          </ul>
          {canAdd && (
            <SelectField
              id="task-add-need"
              label={t('taskSheet.addNeed')}
              autoFocus={adding && needsFirst.length === 0}
              value=""
              onChange={(event) => {
                if (event.target.value) onChange([...ids, event.target.value]);
              }}
            >
              <option value="">{t('taskSheet.pickNeed')}</option>
              {options}
            </SelectField>
          )}
        </section>
      )}
      {unlocks.length > 0 && (
        <section aria-labelledby="task-unlocks" className="flex flex-col gap-1">
          <h3 id="task-unlocks" className="text-headline">{t('taskSheet.unlocks')}</h3>
          <p className="text-footnote text-label-2">{t('taskSheet.unlocksHint')}</p>
          <ul>{unlocks.map((unlock) => <NeedLine key={unlock.id} title={unlock.title} status={unlock.status} />)}</ul>
        </section>
      )}
    </>
  );
}

/** The automatic date moves of this task, newest last. Each says what moved and why, in the interface language. */
export function DateNotes({ data }: { data: TaskDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const notes = data.task.dateNotes ?? [];
  const project = useCall('tasks.list', { projectId: data.task.projectId ?? undefined, activeProjectsOnly: false }, { enabled: notes.length > 0 && data.task.projectId !== null });
  if (notes.length === 0) return null;
  const titleOf = (id: string | undefined) => (project.data ?? []).find((row) => row.task.id === id)?.task.title;
  return (
    <section aria-labelledby="task-date-notes" className="flex flex-col gap-1">
      <h3 id="task-date-notes" className="text-headline">{t('taskSheet.dateChanges')}</h3>
      <ul className="flex flex-col gap-2">
        {notes.map((note, index) => {
          const from = note.from.dueDate ?? note.from.startDate;
          const to = note.to.dueDate ?? note.to.startDate;
          const task = titleOf(note.byTaskId);
          const text = from && to && task && note.lateDays
            ? t('taskSheet.dateMoved', { from: formatDay(from, lang, 'withWeekday'), to: formatDay(to, lang, 'withWeekday'), task, lateness: counted(t, 'taskSheet.durationValue', note.lateDays) })
            : note.reason;
          return <li key={`${note.at}-${index}`} dir="auto" className="text-subheadline">{text}</li>;
        })}
      </ul>
    </section>
  );
}
