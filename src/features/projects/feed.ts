import type { TFunction } from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { actorContext } from '../../lib/grammar';
import { plainText } from '../../lib/text';

const SIMPLE = new Set(['project.created', 'task.created', 'task.approved', 'task.sent_back', 'task.version_opened', 'task.reopened', 'task.dates_shifted', 'file.added', 'member.added']);

/** The verbs that feedText writes a sentence for. Any other verb falls back to "made a change". */
export const FEED_EVENT_VERBS = new Set([...SIMPLE, 'task.status_changed', 'project.stage_changed', 'project.leader_changed', 'file.version_added']);

/** One line for a feed item, without the author's name: the text of a post, or a sentence for an event (spec 5.2). */
export function feedText(item: FeedItem, t: TFunction): string {
  if (item.kind === 'update') return plainText(item.body);
  const { label, detail } = item;
  const context = actorContext(item.author);
  if (item.verb === 'task.status_changed') return t(`feed.task.${detail.status ?? 'done'}`, { label, context });
  if (item.verb === 'project.stage_changed') return t('feed.project.stage_changed', { stage: detail.stage ?? '', context });
  if (item.verb === 'project.leader_changed') {
    return detail.leader ? t('feed.project.leader_changed', { leader: detail.leader, context }) : t('feed.project.leader_cleared', { context });
  }
  if (item.verb === 'file.version_added') return t('feed.file.version_added', { label, version: detail.version ?? '', context });
  if (SIMPLE.has(item.verb)) return t(`feed.${item.verb}`, { label, context });
  return t('feed.other', { context });
}
