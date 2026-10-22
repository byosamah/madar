let last = '/projects';

/** The Projects screen keeps its own link here, with its filter, so "Back" on a project returns to the same list (spec 4.1). */
export function rememberProjectsList(search: string): void {
  last = `/projects${search}`;
}

export function projectsListLink(): string {
  return last;
}

let workView = '/work';
const workListeners = new Set<() => void>();

/** The Work tab opens the Work view that the person used last in this visit (a reload resets it to /work). */
export function rememberWorkView(pathname: '/work' | '/meetings' | '/projects'): void {
  if (workView === pathname) return;
  workView = pathname;
  for (const listener of [...workListeners]) listener();
}

export function workTabLink(): string {
  return workView;
}

/** The tab bar draws again when the Work view changes. */
export function subscribeWorkView(listener: () => void): () => void {
  workListeners.add(listener);
  return () => { workListeners.delete(listener); };
}
