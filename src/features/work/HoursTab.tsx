import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { usePersistentChoice } from '../../app/choices';
import { useLang } from '../../app/lang';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { addDays, formatDay, formatNumber, formatWeekday, todayISO, weekStartOf } from '../../lib/dates';
import { hoursText, parseHours } from '../../lib/hours';
import { AddRowSheet } from './AddRowSheet';

type WeekRow = CallOutput<'time.week'>['rows'][number];
type Focus = { projectId: string; stageId: string; taskId: string | null };

const WEEKEND = ['hide', 'show'] as const;

function HoursCell({ row, day, value, disabled, label, focus }: {
  row: WeekRow; day: string; value: number; disabled: boolean; label: string; focus: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(hoursText(value));
  const [invalid, setInvalid] = useState(false);
  const save = useAction('time.set');
  useEffect(() => {
    setText(hoursText(value));
    setInvalid(false);
  }, [value]);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  const commit = () => {
    const parsed = parseHours(text);
    if (!parsed.ok) {
      setInvalid(true);
      toast.show({ tone: 'error', message: t('hours.invalid') });
      return;
    }
    setInvalid(false);
    if (parsed.hours !== value) {
      save.mutate({ projectId: row.project.id, stageId: row.stage.id, taskId: row.task?.id ?? null, date: day, hours: parsed.hours });
    }
  };
  return (
    <input
      ref={ref}
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      dir="ltr"
      value={text}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
      }}
      className="tabular min-h-11 w-14 rounded-control bg-fill px-1 text-center text-body text-label aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-red disabled:bg-transparent disabled:text-label-2"
    />
  );
}

/** The weekly timesheet: rows are project and stage pairs, the columns are the days, Sunday to Thursday (spec 6.2). */
export function HoursTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const current = weekStartOf(today);
  const raw = params.get('week');
  const weekStart = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? weekStartOf(raw) : current;
  const week = useCall('time.week', { weekStart });
  const [weekend, setWeekend] = usePersistentChoice('madar.hours.weekend', WEEKEND, 'hide');
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const copy = useAction('time.copyLastWeek', { onSuccess: () => toast.show({ message: t('hours.copied') }) });
  const addRow = useAction('time.addRow');
  const removeRow = useAction('time.removeRow');
  const go = (next: string) => setParams((currentParams) => {
    const nextParams = new URLSearchParams(currentParams);
    nextParams.set('tab', 'hours');
    nextParams.set('week', next);
    return nextParams;
  });

  // "Log time" on a task opens this tab with the task's project, stage and task (plan clarification 3).
  // It adds the row after the week has loaded: a change during the first load would be lost to that load's older result.
  const linkDone = useRef(false);
  useEffect(() => {
    if (!week.data || linkDone.current) return;
    linkDone.current = true;
    const projectId = params.get('project');
    const stageId = params.get('stage');
    if (!projectId || !stageId) return;
    const taskId = params.get('task') || null;
    addRow.mutate({ weekStart: current, projectId, stageId, taskId }, { onSuccess: () => setFocus({ projectId, stageId, taskId }) });
    setParams((currentParams) => {
      const next = new URLSearchParams(currentParams);
      next.delete('project');
      next.delete('stage');
      next.delete('task');
      next.set('tab', 'hours');
      next.set('week', current);
      return next;
    }, { replace: true });
    // The link runs once, when the week first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.data]);

  if (!week.data) return null;
  const view = week.data;
  const weekendHours = view.dayTotals[5] + view.dayTotals[6] > 0;
  const showWeekend = weekend === 'show' || weekendHours;
  const columns = showWeekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
  const labelOf = (row: WeekRow) => [row.project.code, row.stage.name, row.task?.title].filter(Boolean).join(' · ');
  const percent = view.target > 0 ? Math.min(100, (view.weekTotal / view.target) * 100) : 0;
  const isFocus = (row: WeekRow) => focus !== null && row.project.id === focus.projectId && row.stage.id === focus.stageId && (row.task?.id ?? null) === focus.taskId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label={t('hours.previous')} onClick={() => go(addDays(weekStart, -7))}>
          <ChevronLeft size={20} className="rtl:-scale-x-100" aria-hidden />
        </IconButton>
        <p className="tabular text-headline">{t('hours.weekRange', { start: formatDay(view.days[0], lang), end: formatDay(view.days[6], lang) })}</p>
        <IconButton label={t('hours.next')} disabled={weekStart >= current} onClick={() => go(addDays(weekStart, 7))}>
          <ChevronRight size={20} className="rtl:-scale-x-100" aria-hidden />
        </IconButton>
        {weekStart !== current && <Button variant="plain" onClick={() => go(current)}>{t('hours.thisWeek')}</Button>}
        <div className="ms-auto flex min-w-48 flex-col gap-1">
          <p className="tabular text-footnote text-label-2">{t('hours.logged', { logged: formatNumber(view.weekTotal, lang, 1), target: formatNumber(view.target, lang) })}</p>
          <div className="h-2 overflow-hidden rounded-full bg-fill">
            <div style={{ width: `${percent}%` }} className={`h-full rounded-full ${view.weekTotal >= view.target ? 'bg-green' : 'bg-accent-fill'}`} />
          </div>
        </div>
      </div>
      {view.locked && <p role="status" className="rounded-2xl bg-fill p-3 text-footnote">{t('hours.locked')}</p>}
      {view.rows.length === 0 ? <EmptyState title={t('hours.emptyTitle')} body={t('hours.empty')} /> : (
        <div className="surface overflow-x-auto rounded-card">
          <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-subheadline">
            <thead>
              <tr>
                <th scope="col" className="sticky start-0 z-10 bg-card p-3 text-start font-semibold">{t('hours.row')}</th>
                {columns.map((i) => {
                  const day = view.days[i];
                  return (
                    <th key={day} scope="col" className={`p-2 text-center font-medium ${day === today ? 'text-accent' : 'text-label-2'}`}>
                      <span className="block text-caption">{formatWeekday(day, lang)}</span>
                      <span className="tabular">{Number(day.slice(8))}</span>
                    </th>
                  );
                })}
                <th scope="col" className="p-2 text-center font-medium text-label-2">{t('hours.total')}</th>
                <th scope="col"><span className="sr-only">{t('common.remove')}</span></th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => {
                const label = labelOf(row);
                return (
                  <tr key={row.key}>
                    <th scope="row" className="sticky start-0 z-10 max-w-56 bg-card p-3 text-start font-normal">
                      <span className="tabular block text-footnote text-label-2">{row.project.code}</span>
                      <bdi className="block truncate">{[row.stage.name, row.task?.title].filter(Boolean).join(' · ')}</bdi>
                    </th>
                    {columns.map((i) => {
                      const day = view.days[i];
                      return (
                        <td key={day} className="p-1 text-center">
                          <HoursCell
                            row={row}
                            day={day}
                            value={row.hours[i]}
                            disabled={view.locked || day > today}
                            label={t('hours.cell', { row: label, day: formatDay(day, lang, 'long') })}
                            focus={day === today && isFocus(row)}
                          />
                        </td>
                      );
                    })}
                    <td className="tabular p-2 text-center font-semibold">{formatNumber(row.total, lang, 1)}</td>
                    <td className="p-1">
                      {row.pinned && row.total === 0 && !view.locked && (
                        <IconButton label={t('hours.removeRow', { row: label })} onClick={() => removeRow.mutate({ weekStart, rowKey: row.key })}>
                          <X size={16} aria-hidden />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="sticky start-0 z-10 bg-card p-3 text-start">{t('hours.dayTotal')}</th>
                {columns.map((i) => <td key={i} className="tabular p-2 text-center text-label-2">{formatNumber(view.dayTotals[i], lang, 1)}</td>)}
                <td className="tabular p-2 text-center font-bold">{formatNumber(view.weekTotal, lang, 1)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!view.locked && (
          <>
            <Button onClick={() => setAdding(true)}>
              <Plus size={18} aria-hidden />
              {t('hours.addRow')}
            </Button>
            <Button disabled={copy.isPending} onClick={() => copy.mutate({ weekStart })}>{t('hours.copyLast')}</Button>
          </>
        )}
        <Button variant="plain" disabled={weekendHours} onClick={() => setWeekend(showWeekend ? 'hide' : 'show')}>
          {showWeekend ? t('hours.hideWeekend') : t('hours.showWeekend')}
        </Button>
      </div>
      <AddRowSheet open={adding} onOpenChange={setAdding} weekStart={weekStart} />
    </div>
  );
}
