import type { TFunction } from 'i18next';
import type { Event } from '../../../api/contract/entities';
import { localeFor, type Lang } from '../../../lib/dates';

/** One line for a task history entry (spec 5.4), without the actor's name. */
export function historyText(event: Event, t: TFunction, lang: Lang): string {
  switch (event.verb) {
    case 'task.created': return t('taskHistory.created');
    case 'task.deleted': return t('taskHistory.deleted');
    case 'task.reassigned': return t('taskHistory.reassigned');
    case 'task.approved': return t('taskHistory.approved');
    case 'task.sent_back': return t('taskHistory.sent_back');
    case 'undo': return t('taskHistory.undo');
    case 'task.status_changed': {
      const status = (event.after as { status?: string } | null)?.status ?? 'todo';
      return t('taskHistory.status', { status: t(`taskStatus.${status}`) });
    }
    case 'task.updated': {
      const fields = [...new Set(Object.keys((event.after ?? {}) as object).map((field) => t(`taskHistory.fields.${field}`)))];
      return t('taskHistory.updated', { fields: new Intl.ListFormat(localeFor(lang), { type: 'conjunction' }).format(fields) });
    }
    default: return t('feed.other');
  }
}
