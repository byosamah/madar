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

/** A person from the link, when it has the form of a person id. */
export function userParam(value: string | null): string | undefined {
  return value && /^usr_\d{3,}$/.test(value) ? value : undefined;
}

/** A client from the link, when it has the form of a client id. */
export function clientParam(value: string | null): string | undefined {
  return value && /^cli_\d{3,}$/.test(value) ? value : undefined;
}

/**
 * The link of a list screen with one task panel open over it (Tasks, Home, the Task list). An office task has no project, so the
 * link names the task alone (owner, 2026-10-06).
 */
export function openTask(current: URLSearchParams, taskId: string, projectId: string | null = null, thread = false): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set('task', taskId);
  if (projectId) next.set('project', projectId);
  else next.delete('project');
  if (thread) next.set('thread', '1');
  else next.delete('thread');
  return next;
}

/**
 * The link that opens a task panel in its project. "thread" opens the Conversation of the task. An office task (no project) opens
 * on the Tasks page (owner, 2026-10-06).
 */
export function taskLink(projectId: string | null, taskId: string, thread = false): string {
  if (projectId === null) return `/work?task=${taskId}${thread ? '&thread=1' : ''}`;
  return `/projects/${projectId}?tab=tasks&task=${taskId}${thread ? '&thread=1' : ''}`;
}
