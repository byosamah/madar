import i18n, { type TFunction } from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import type { Lang } from '../../lib/dates';
import { actorContext } from '../../lib/grammar';
import { localName } from '../../lib/personName';
import { plainText } from '../../lib/text';

const SIMPLE = new Set(['project.created', 'task.created', 'task.approved', 'task.sent_back', 'task.version_opened', 'task.reopened', 'task.dates_shifted', 'file.added', 'member.added']);

/** The verbs that feedText writes a sentence for. Any other verb falls back to "made a change". */
export const FEED_EVENT_VERBS = new Set([...SIMPLE, 'task.status_changed', 'project.stage_changed', 'project.leader_changed', 'project.code_changed', 'file.version_added']);

/**
 * One line for a feed item, without the author's name: the text of a post, or a sentence for an event (spec 5.2).
 * A person's name in the event shows in the screen language (owner item 12): "lang" is the language of the same i18n as t.
 */
export function feedText(item: FeedItem, t: TFunction, lang: Lang = i18n.language === 'ar' ? 'ar' : 'en'): string {
  if (item.kind === 'update') return plainText(item.body);
  const { detail } = item;
  // A member event names the person in the label, with the Arabic name in detail.labelAr.
  const label = item.verb === 'member.added' ? localName({ label: item.label, labelAr: detail.labelAr }, 'label', lang) : item.label;
  const context = actorContext(item.author);
  if (item.verb === 'task.status_changed') return t(`feed.task.${detail.status ?? 'done'}`, { label, context });
  if (item.verb === 'project.stage_changed') return t('feed.project.stage_changed', { stage: detail.stage ?? '', context });
  if (item.verb === 'project.leader_changed') {
    return detail.leader ? t('feed.project.leader_changed', { leader: localName(detail, 'leader', lang), context }) : t('feed.project.leader_cleared', { context });
  }
  if (item.verb === 'project.code_changed') return t('feed.project.code_changed', { code: detail.code ?? '', context });
  if (item.verb === 'file.version_added') return t('feed.file.version_added', { label, version: detail.version ?? '', context });
  if (SIMPLE.has(item.verb)) return t(`feed.${item.verb}`, { label, context });
  return t('feed.other', { context });
}
