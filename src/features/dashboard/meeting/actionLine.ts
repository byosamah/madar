import type { TFunction } from 'i18next';
import { formatDay, type Lang } from '../../../lib/dates';

/**
 * One action as the meeting writes it: "Action: <title> · <person> · <Tue 6 Oct>". The meeting panel, the summary, the copied
 * table and the message to the project chat all use it, so the minutes keep who does the action and by when (audit 2026-10-03, F-18).
 * A task with no due date leaves the date out.
 */
export function actionLine(t: TFunction, lang: Lang, title: string, name: string, dueDate: string | null | undefined): string {
  return dueDate
    ? t('dashboard.meeting.actionLine', { title, name, date: formatDay(dueDate, lang, 'withWeekday') })
    : t('dashboard.meeting.actionLineNoDate', { title, name });
}
