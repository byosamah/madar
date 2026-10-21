/**
 * The plain limits and marks of the contract, with no zod (performance audit BND-6). The screens of the first load import
 * them from here, so they load no zod schemas. entities.ts and server.ts import them and export them again under the same
 * names, so the server, the handlers and MCP see no change.
 */

/** The three quick reactions of a comment or a chat message. Any other emoji also works (emoji.ts, isReactionEmoji). */
export const REACTIONS = ['👍', '✅', '👀'] as const;

/**
 * The "Notify me" choices of a person for one chat (chat design item 21, owner 2026-10-19): "all" is every message, "named" is
 * only a message that names the person. A plain value, so a screen of the Inbox chunk reads it with no zod.
 */
export const NOTIFY_LEVELS = ['all', 'named'] as const;

/**
 * The profile picture (owner item 10, 2026-10-05). The browser cuts it to a 128 px square and saves it as a data address,
 * so no file store holds it. A data address of a WebP, JPEG or PNG picture.
 */
export const PICTURE_DATA = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/** The most prerequisites one task or one stage has. */
export const MAX_PREREQUISITES = 20;

/** The most helpers one task has. */
export const MAX_HELPERS = 10;

/** The most files one comment or one chat message carries. */
export const MAX_ATTACHMENTS = 10;

/** The most people in one group chat (owner, 2026-10-18). A group starts with 3 people. */
export const GROUP_MAX = 50;

/** The most letters of a group name. */
export const GROUP_NAME_MAX = 60;

/** The absolute ceiling for one file (spec 2, section 8). The active file store of the real build can set a lower limit (plan 2b, point 1). */
export const MAX_FILE_BYTES = 250 * 1024 * 1024;

/** One feedback screenshot is at most 10 MB. */
export const MAX_SHOT_BYTES = 10 * 1024 * 1024;

/**
 * The mark of a sign-in account whose person saved a password (owner, 2026-10-04): a key of the Auth user_metadata. Auth confirms
 * the email as soon as an invitation link opens, so users.invites says active only when this mark is true too. The screens set
 * it with each password save and after a sign-in with a password (src/app/remote/auth.ts). A person can set it on their own
 * account only, and it changes only the Invited label of that person; no right depends on it.
 */
export const PASSWORD_SET_MARK = 'madar_password_set';

/** A paused project turns stale after this many days, when the office settings name no number (colleague comment 16). */
export const DEFAULT_STALE_DAYS = 30;

/** The most quiet lines a group keeps (a person joined, left, was removed, or the group got a new name). The newest stay. */
export const GROUP_LOG_MAX = 100;

/** The kinds of a meeting (fbk_022, owner 2026-10-19). Kind and project are two separate choices. */
export const MEETING_KINDS = ['meeting', 'client', 'team', 'site_visit'] as const;
export type MeetingKindName = (typeof MEETING_KINDS)[number];

/**
 * The limits of a meeting. The length is in minutes. A start up to MEETING_PAST_DAYS days ago is allowed. The minutes are one text of
 * at most minutesMax letters (wave 2).
 */
export const MEETING_LIMITS = {
  titleMax: 120, whereMax: 200, guestsMax: 200, notesMax: 2000, attendeesMax: 30,
  minMinutes: 15, maxMinutes: 720, pastDays: 14, windowDaysMax: 400, listMax: 200, listDefaultDays: 60, minutesMax: 10_000,
} as const;
