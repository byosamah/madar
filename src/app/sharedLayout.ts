// The list a project was opened from ("home" or "projects"). The row's tile and name grow into the project header
// only inside the same group, so moving between Home and Projects never sends names flying across the screen.
let source = 'none';

export function setSharedSource(group: string): void {
  source = group;
}

export function sharedSource(): string {
  return source;
}
