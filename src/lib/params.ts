/** A value from the link, when it is one of the allowed values. Anything else gives the fallback. */
export function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** A day from the link, when it is a real calendar day. A person can type anything into a link. */
export function dayParam(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

/** An office team from the link, when it has the form of a team id. */
export function teamParam(value: string | null): string | undefined {
  return value && /^tm_\d{3,}$/.test(value) ? value : undefined;
}

/** The link that opens a task panel in its project. "thread" opens the Conversation of the task. */
export function taskLink(projectId: string, taskId: string, thread = false): string {
  return `/projects/${projectId}?tab=tasks&task=${taskId}${thread ? '&thread=1' : ''}`;
}
