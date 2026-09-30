import type { TFunction } from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { plainText } from '../../lib/text';

const SIMPLE = new Set(['project.created', 'task.created', 'task.approved', 'task.sent_back', 'file.added', 'member.added']);

/** One line for a feed item, without the author's name: the text of a post, or a sentence for an event (spec 5.2). */
export function feedText(item: FeedItem, t: TFunction): string {
  if (item.kind === 'update') return plainText(item.body);
  const { label, detail } = item;
  if (item.verb === 'task.status_changed') return t(`feed.task.${detail.status ?? 'done'}`, { label });
  if (item.verb === 'project.stage_changed') return t('feed.project.stage_changed', { stage: detail.stage ?? '' });
  if (item.verb === 'project.leader_changed') {
    return detail.leader ? t('feed.project.leader_changed', { leader: detail.leader }) : t('feed.project.leader_cleared');
  }
  if (item.verb === 'file.version_added') return t('feed.file.version_added', { label, version: detail.version ?? '' });
  if (SIMPLE.has(item.verb)) return t(`feed.${item.verb}`, { label });
  return t('feed.other');
}
