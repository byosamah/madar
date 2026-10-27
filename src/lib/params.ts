import type { SetURLSearchParams } from 'react-router';

/** A value from the link, when it is one of the allowed values. Anything else gives the fallback. */
export function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Sets one value of the link, or removes it when the value is null. It replaces the link, so Back leaves the screen and does not
 * step through the change.
 */
export function replaceParam(setParams: SetURLSearchParams, key: string, value: string | null): void {
  setParams((current) => {
    const next = new URLSearchParams(current);
    if (value === null) next.delete(key);
    else next.set(key, value);
    return next;
  }, { replace: true });
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

/** A sub-company from the link, when it has the form of a sub-company id (fbk_007). */
export function subCompanyParam(value: string | null): string | undefined {
  return value && /^sub_\d{3,}$/.test(value) ? value : undefined;
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

/** The link of one Tracker entry: the Tracker tab of its project, with the sheet of the entry open (the minutes of a meeting, wave 2). */
export function trackerEntryLink(projectId: string, entryId: string): string {
  return `/projects/${projectId}?tab=tracker&entry=${entryId}`;
}

/**
 * The link of a chat or of a task thread in the Inbox, and one message in it (chat design 2026-10-19, item 17). A notice, a search
 * hit and a reply strip use it.
 */
export function chatLink(chatId: string, messageId?: string): string {
  return messageId ? `/inbox/${chatId}?at=${messageId}` : `/inbox/${chatId}`;
}

/** A message or a comment from the link, when it has the form of an id. A person can type anything into a link. */
export function messageParam(value: string | null): string | undefined {
  return value && /^(msg|cmt)_\d{3,}$/.test(value) ? value : undefined;
}

/** A meeting from the link, when it has the form of a meeting id (fbk_022). Anything else opens no sheet. */
export function meetingParam(value: string | null): string | undefined {
  return value && /^mtg_\d{3,}$/.test(value) ? value : undefined;
}

/** The link of the Meetings view with the sheet of one meeting open over it (fbk_022). */
export function openMeeting(current: URLSearchParams, meetingId: string): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set('meeting', meetingId);
  return next;
}

/** The link of the Meetings view without the sheet. */
export function closeMeeting(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete('meeting');
  return next;
}
