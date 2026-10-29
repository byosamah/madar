/**
 * The sort choices of the Projects list and the place where this browser keeps the choice. A file of its own, so the press on the
 * Projects tab (src/app/pressReads.ts) reads the stored sort without loading the screen.
 */
export const PROJECT_SORTS = ['updated', 'deadline', 'name'] as const;
export const PROJECT_SORT_KEY = 'madar.projects.sort';

/**
 * The group that the Projects list shows first when it holds client and internal projects (fbk_075, owner 2026-10-29). The browser keeps
 * the choice, like the sort.
 */
export const PROJECT_FIRSTS = ['projects', 'internal'] as const;
export const PROJECT_FIRST_KEY = 'madar.projects.first';
