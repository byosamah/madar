/**
 * The sort choices of the Projects list and the place where this browser keeps the choice. A file of its own, so the press on the
 * Projects tab (src/app/pressReads.ts) reads the stored sort without loading the screen.
 */
export const PROJECT_SORTS = ['updated', 'deadline', 'name'] as const;
export const PROJECT_SORT_KEY = 'madar.projects.sort';
