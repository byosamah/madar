import type { TFunction } from 'i18next';
import { actorContext } from '../../../lib/grammar';
import type { Event } from '../../../api/contract/entities';
import { localeFor, type Lang } from '../../../lib/dates';

/** One line for a task history entry (spec 5.4), without the actor's name. The actor's gender picks the Arabic verb (lib/grammar). */
export function historyText(event: Event, t: TFunction, lang: Lang, gender?: 'female' | 'male'): string {
  const context = actorContext({ gender });
  switch (event.verb) {
    case 'task.created': return t('taskHistory.created', { context });
    case 'task.deleted': return t('taskHistory.deleted', { context });
    case 'task.reassigned': return t('taskHistory.reassigned', { context });
    case 'task.arranged': return t('taskHistory.arranged', { context });
    case 'task.version_opened': return t('taskHistory.version_opened', { n: (event.after as { version?: number } | null)?.version ?? 2, context });
    case 'task.approved': return t('taskHistory.approved', { context });
    case 'task.sent_back': return t('taskHistory.sent_back', { context });
    case 'task.reopened': return t('taskHistory.reopened', { context });
    case 'task.dates_shifted': return t('taskHistory.dates_shifted', { context });
    case 'undo': return t('taskHistory.undo', { context });
    case 'task.status_changed': {
      const status = (event.after as { status?: string } | null)?.status ?? 'todo';
      return t('taskHistory.status', { status: t(`taskStatus.${status}`), context });
    }
    case 'task.updated': {
      const fields = [...new Set(Object.keys((event.after ?? {}) as object).map((field) => t(`taskHistory.fields.${field}`)))];
      return t('taskHistory.updated', { fields: new Intl.ListFormat(localeFor(lang), { type: 'conjunction' }).format(fields), context });
    }
    default: return t('feed.other', { context });
  }
}
