import { usePersistentChoice } from '../../app/choices';

/** The two views of a project list (fbk_080, owner 2026-11-05). Rows is the first. One choice serves Home and Projects. It stays on this device. */
export const PROJECT_VIEWS = ['rows', 'boxes'] as const;
export type ProjectView = (typeof PROJECT_VIEWS)[number];
export const PROJECT_VIEW_KEY = 'madar.projects.view';

/** The choice of the person: the view and the setter. The setter keeps its identity, so a memoized list does not render again for it. */
export function useProjectView(): [ProjectView, (next: ProjectView) => void] {
  return usePersistentChoice(PROJECT_VIEW_KEY, PROJECT_VIEWS, 'rows');
}
