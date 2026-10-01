import type { TFunction } from 'i18next';
import type { TaskStatus } from '../api/contract/entities';
import { diffDays, formatDay, type Lang } from './dates';
import { counted } from './grammar';

export type DueWord = { key: 'pastDue' | 'dueToday' | 'dueIn' | 'dueOn'; n: number; tone: 'attn' | 'quiet' };

/**
 * Gentle words for a due date (redesign spec 5.4): "3 days past due" in the attention color, never a red "Overdue".
 * A done task needs no word. A task in review is never past due (spec 4.2), so it shows its date.
 */
export function dueWord(dueDate: string | null, today: string, status: TaskStatus): DueWord | null {
  if (!dueDate || status === 'done') return null;
  const days = diffDays(today, dueDate);
  if (status === 'in_review') return { key: 'dueOn', n: days, tone: 'quiet' };
  return wordForDays(days);
}

/** The same words from a count of days left; negative means past due. */
export function wordForDays(days: number): DueWord {
  if (days < 0) return { key: 'pastDue', n: -days, tone: 'attn' };
  if (days === 0) return { key: 'dueToday', n: 0, tone: 'quiet' };
  if (days <= 6) return { key: 'dueIn', n: days, tone: 'quiet' };
  return { key: 'dueOn', n: days, tone: 'quiet' };
}

export function dueText(word: DueWord, t: TFunction, lang: Lang, dueDate: string): string {
  if (word.key === 'pastDue') return counted(t, 'due.pastDue', word.n);
  if (word.key === 'dueToday') return t('due.today');
  if (word.key === 'dueIn') return counted(t, 'due.in', word.n);
  return t('due.on', { date: formatDay(dueDate, lang) });
}

/** A task that has not started yet shows "Starts Sun 4 Oct" in place of its due word. A done task shows neither. */
export function startsLater(startDate: string | null | undefined, today: string, status: TaskStatus): startDate is string {
  return !!startDate && startDate > today && status !== 'done';
}

export function startsText(startDate: string, t: TFunction, lang: Lang): string {
  return t('tasks.startsOn', { date: formatDay(startDate, lang, 'withWeekday') });
}
