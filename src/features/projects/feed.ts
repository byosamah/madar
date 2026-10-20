import i18n, { type TFunction } from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { listFormat, type Lang } from '../../lib/dates';
import { actorContext, counted } from '../../lib/grammar';
import { localName } from '../../lib/personName';
import { plainText } from '../../lib/text';

const SIMPLE = new Set(['project.created', 'task.created', 'task.approved', 'task.sent_back', 'task.version_opened', 'task.reopened', 'task.dates_shifted', 'file.added', 'member.added']);

/** The verbs that feedText writes a sentence for. Any other verb falls back to "made a change". */
export const FEED_EVENT_VERBS = new Set([...SIMPLE, 'meeting.created', 'meeting.updated', 'meeting.cancelled', 'meeting.minutes_saved', 'tracker.minutes_saved', 'task.status_changed', 'project.stage_changed', 'project.leader_changed', 'project.code_changed', 'file.version_added', 'project.template_synced', 'project.template_applied']);

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
  // A meeting and a site visit have their own words (fbk_022). The title shows in the sentence, as a task title does.
  // The minutes of a meeting (wave 2) read the same on the Tracker line and on the meeting: "wrote the minutes of the site visit ...".
  if (item.verb === 'tracker.minutes_saved') return t(`feed.meeting.minutes_saved_${detail.kind === 'site_visit' ? 'visit' : 'meeting'}`, { label, context });
  if (item.verb.startsWith('meeting.')) {
    return t(`feed.meeting.${item.verb.slice('meeting.'.length)}_${detail.kind === 'site_visit' ? 'visit' : 'meeting'}`, { label, context });
  }
  if (item.verb === 'task.status_changed') return t(`feed.task.${detail.status ?? 'done'}`, { label, context });
  if (item.verb === 'project.stage_changed') return t('feed.project.stage_changed', { stage: detail.stage ?? '', context });
  if (item.verb === 'project.leader_changed') {
    return detail.leader ? t('feed.project.leader_changed', { leader: localName(detail, 'leader', lang), context }) : t('feed.project.leader_cleared', { context });
  }
  if (item.verb === 'project.template_synced') return t(detail.template ? 'feed.project.template_synced' : 'feed.project.template_synced_plain', { template: detail.template ?? '', context });
  if (item.verb === 'project.template_applied') {
    // "added 1 stage and 2 tasks": a kind with none left out. The event keeps the numbers (addedParts).
    const added = [
      ...(Number(detail.stages) > 0 ? [counted(t, 'projectTemplates.stageCount', Number(detail.stages))] : []),
      ...(Number(detail.tasks) > 0 ? [counted(t, 'projectTemplates.taskCount', Number(detail.tasks))] : []),
    ];
    return t(detail.template ? 'feed.project.template_applied' : 'feed.project.template_applied_plain', {
      template: detail.template ?? '', added: added.length > 0 ? listFormat(lang).format(added) : t('projectTemplates.apply.addedNothing'), context,
    });
  }
  if (item.verb === 'project.code_changed') return t('feed.project.code_changed', { code: detail.code ?? '', context });
  if (item.verb === 'file.version_added') return t('feed.file.version_added', { label, version: detail.version ?? '', context });
  if (SIMPLE.has(item.verb)) return t(`feed.${item.verb}`, { label, context });
  return t('feed.other', { context });
}
