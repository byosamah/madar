import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '../../../api/contract/entities';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { formatDay, formatNumber, stampDay, todayISO } from '../../../lib/dates';
import { versionOf } from '../../../lib/taskPeople';
import { Group } from './DetailRows';
import { TaskTiming, type Timing } from './TaskTiming';

/** One round of a task: "Version 2 open since 12 Oct", or "Version 1 finished 28 Sept", with the reason under it. With `rows` it is a row of a Group on the phone. */
function VersionLine({ task, version, rows = false }: { task: Task; version: NonNullable<Task['versions']>[number]; rows?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  // The version in progress ends when the task is done again. An older one ended when the next one opened.
  const finishedAt = version.n === versionOf(task) ? (task.status === 'done' ? task.completedAt : null) : version.finishedAt;
  const n = formatNumber(version.n, lang);
  return (
    <li className={rows ? 'flex min-h-12 flex-col justify-center px-4 py-2' : 'flex min-h-11 flex-col justify-center py-1'}>
      <span className="text-subheadline">
        {finishedAt
          ? t('taskSheet.versionDone', { n, date: formatDay(stampDay(finishedAt), lang) })
          : t('taskSheet.versionOpen', { n, date: formatDay(stampDay(version.openedAt), lang) })}
      </span>
      {version.reason && <bdi className="text-footnote text-label-2">{version.reason}</bdi>}
    </li>
  );
}

/** The rounds of a task, newest first: "Version 2 open since 12 Oct, Client comments" and "Version 1 finished 28 Sept". Nothing shows before a second version. */
export function TaskVersions({ task, layout = 'plain' }: { task: Task; layout?: 'plain' | 'rows' }) {
  const { t } = useTranslation();
  if (versionOf(task) < 2 || !task.versions) return null;
  const versions = [...task.versions].sort((a, b) => b.n - a.n);
  if (layout === 'rows') {
    return (
      <Group title={t('taskSheet.versions')}>
        <ol className="hairline">
          {versions.map((version) => <VersionLine key={version.n} task={task} version={version} rows />)}
        </ol>
      </Group>
    );
  }
  return (
    <section aria-labelledby="task-versions" className="flex flex-col gap-1">
      <h3 id="task-versions" className="text-headline">{t('taskSheet.versions')}</h3>
      <ol className="flex flex-col">
        {versions.map((version) => <VersionLine key={version.n} task={task} version={version} />)}
      </ol>
    </section>
  );
}

/**
 * A finished task gets a new version: the reason, and the new dates. The same task opens again with its checklist unticked.
 * The server holds every rule; this form only collects the two answers (colleague comment 8).
 */
export function NewVersion({ task }: { task: Task }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [timing, setTiming] = useState<Timing>({ startDate: todayISO(), schedule: task.schedule ?? 'static', durationDays: task.durationDays ?? null, dueDate: null });
  const next = versionOf(task) + 1;
  const start = useUndoable('tasks.newVersion', {
    message: (output) => t('taskSheet.versionStarted', { n: formatNumber(output.task.version ?? next, lang) }),
    onSuccess: () => {
      setOpen(false);
      setReason('');
    },
  });
  if (!open) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-2xl bg-fill p-3">
        <p className="min-w-0 flex-1 text-footnote text-label-2">{t('taskSheet.newVersionHint')}</p>
        <Button onClick={() => setOpen(true)}>{t('taskSheet.newVersion')}</Button>
      </section>
    );
  }
  const dynamic = timing.schedule === 'dynamic';
  return (
    <section aria-label={t('taskSheet.newVersion')} className="flex flex-col gap-4 rounded-2xl bg-fill p-3">
      <h3 className="text-headline">{t('taskSheet.newVersionTitle', { n: formatNumber(next, lang) })}</h3>
      <TextField
        id="task-version-reason"
        label={t('taskSheet.versionReason')}
        hint={t('taskSheet.versionReasonHint')}
        dir="auto"
        maxLength={280}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <TaskTiming idPrefix="task-version" value={timing} onPatch={(changes) => setTiming((current) => ({ ...current, ...changes }))} />
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={!reason.trim() || start.isPending}
          onClick={() => start.mutate({
            id: task.id, reason: reason.trim(), startDate: timing.startDate, schedule: timing.schedule,
            ...(dynamic ? { durationDays: timing.durationDays } : { dueDate: timing.dueDate }),
          })}
        >
          {t('taskSheet.startVersion', { n: formatNumber(next, lang) })}
        </Button>
        <Button variant="plain" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
      </div>
    </section>
  );
}
