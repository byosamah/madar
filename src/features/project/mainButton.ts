import type { ProjectDetail } from '../../api/contract/views';
import type { ProjectTab } from './tabs';

/** The one navy button of a project tab on a phone: Post update, Log a new line, Add, or the Post button of the update box. */
export type MainButton = 'post' | 'log' | 'add' | 'box';
export type MainCan = Pick<ProjectDetail['viewerCan'], 'postUpdate' | 'logTracker' | 'upload' | 'links'>;

/** True when the button of the tab itself shows: Log a new line on Tracker, Add on Files & Links. */
export function tabButtonShows(tab: 'tracker' | 'files', can: MainCan): boolean {
  return tab === 'tracker' ? can.logTracker === true : can.upload === true || can.links === true;
}

/**
 * Which button is navy on this tab (phone D). A tab that has its own button gives it the navy and turns "Post update" grey, but only
 * when that button shows. On Overview the Post button of the box takes the navy while the box holds text.
 */
export function phoneMainButton(tab: ProjectTab, can: MainCan, hasDraft: boolean): MainButton {
  if (tab === 'tracker' && tabButtonShows('tracker', can)) return 'log';
  if (tab === 'files' && tabButtonShows('files', can)) return 'add';
  if (tab === 'overview' && can.postUpdate === true && hasDraft) return 'box';
  return 'post';
}
