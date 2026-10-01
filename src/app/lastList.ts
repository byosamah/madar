let last = '/projects';

/** The Projects screen keeps its own link here, with its filter, so "Back" on a project returns to the same list (spec 4.1). */
export function rememberProjectsList(search: string): void {
  last = `/projects${search}`;
}

export function projectsListLink(): string {
  return last;
}
