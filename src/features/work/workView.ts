/** The two views of the To-dos view of Tasks (fbk_042). The choice stays on this device; List is the first. */
export const WORK_VIEWS = ['list', 'board'] as const;
export type WorkView = (typeof WORK_VIEWS)[number];
export const WORK_VIEW_KEY = 'madar.work.view';
