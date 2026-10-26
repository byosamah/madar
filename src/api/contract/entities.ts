import { z } from 'zod';
import { INITIALS_PATTERN, RECORD_CODE_PATTERN, visibleTextPattern } from '../../lib/projectCode';
import {
  DEFAULT_STALE_DAYS, GROUP_LOG_MAX, GROUP_MAX, GROUP_NAME_MAX, MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_HELPERS, MAX_PREREQUISITES, MAX_PROJECT_VIEWERS, MEETING_KINDS, MEETING_LIMITS,
  NOTIFY_LEVELS, PICTURE_DATA, REACTIONS,
} from './limits';
import { isReactionEmoji } from './emoji';
import { PUSH_ENDPOINT_MAX, PUSH_LABEL_MAX, isPushEndpoint } from './push';
import { CATALOG_RIGHT_IDS, STORED_RIGHT_IDS } from '../rightsCatalog';

// The plain limits live in limits.ts, with no zod, for the screens of the first load (performance audit BND-6).
export {
  DEFAULT_STALE_DAYS, GROUP_LOG_MAX, GROUP_MAX, GROUP_NAME_MAX, MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_HELPERS, MAX_PREREQUISITES, MAX_PROJECT_VIEWERS, MEETING_KINDS, MEETING_LIMITS,
  NOTIFY_LEVELS, PICTURE_DATA, REACTIONS,
};

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_\\d{3,}$`), `Expected an id like ${prefix}_001.`);

export const UserId = id('usr');
export const ClientId = id('cli');
export const ProjectId = id('prj');
export const StageId = id('stg');
export const DeadlineId = id('ddl');
export const TaskId = id('tsk');
export const UpdateId = id('upd');
export const CommentId = id('cmt');
export const FileId = id('fil');
export const FolderId = id('fld');
export const NotificationId = id('ntf');
export const EventId = id('evt');
export const ConversationId = id('cnv');
export const MessageId = id('msg');
export const StageTemplateId = id('stt');
export const TaskTemplateId = id('ttp');
export const ProjectTemplateId = id('ptp');
export const TrackerId = id('trk');
export const PaymentId = id('pay');
export const TeamId = id('tm');
export const SubCompanyId = id('sub');
export const MeetingId = id('mtg');
export const PushDeviceId = id('pdv');
export const RoleId = id('rol');

export const Day = z.iso.date();
export const Stamp = z.iso.datetime({ offset: true });

export const ProjectStatus = z.enum(['active', 'on_hold', 'completed', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;
export const TaskStatus = z.enum(['todo', 'in_progress', 'in_review', 'done']);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const HealthValue = z.enum(['on_track', 'at_risk', 'late']);
export type HealthValue = z.infer<typeof HealthValue>;
export const Language = z.enum(['en', 'ar']);
export type Language = z.infer<typeof Language>;
export const Theme = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof Theme>;
export const Glass = z.enum(['clear', 'frosted', 'solid']);
export type Glass = z.infer<typeof Glass>;

// "resume_due": a paused project reached its planned restart day (audit 2026-10-03, API-18).
// "feedback_sent" and "feedback_done": a person sent a feature request or a bug report, and it is done (owner, 2026-10-07).
export const TRIGGERS = [
  'task_assigned', 'mention', 'due_tomorrow', 'overdue', 'review_requested',
  'task_approved', 'task_sent_back', 'stage_changed', 'added_to_project', 'resume_due',
  'feedback_sent', 'feedback_done', 'added_to_group', 'meeting_invited', 'meeting_soon', 'helper_joined', 'task_deleted', 'payment_due',
] as const;
export const Trigger = z.enum(TRIGGERS);
export type Trigger = z.infer<typeof Trigger>;
/** The notices that stay in the app: no email and no email switch (owner, 2026-10-07). */
// "added_to_group": a person is added to a group chat (UX audit 2026-10-19, INT-15). It stays in the app too.
// "meeting_invited" (a new, moved or cancelled meeting) and "meeting_soon" (30 minutes before the start): the mail quota is small, and
// calendar apps remind by themselves (fbk_022, owner 2026-10-19). Both stay in the app and in push, never in email.
// "helper_joined" (a team member joins a task as a helper, to its lead) and "task_deleted" (another person deletes a task, to its maker):
// each one gives news and asks for no action, so it stays in the app and in push, never in email (fbk_034, fbk_035, owner 2026-10-20).
// "payment_due" (a payment reaches its due day, to the people who link Daftra invoices): the mail quota is small, so it stays in the app and
// in push too (the Daftra link, owner 2026-10-26).
export const IN_APP_ONLY_TRIGGERS = [
  'feedback_sent', 'feedback_done', 'added_to_group', 'meeting_invited', 'meeting_soon', 'helper_joined', 'task_deleted', 'payment_due',
] as const satisfies readonly Trigger[];
export type EmailTrigger = Exclude<Trigger, (typeof IN_APP_ONLY_TRIGGERS)[number]>;
export function isEmailTrigger(trigger: Trigger): trigger is EmailTrigger {
  return !(IN_APP_ONLY_TRIGGERS as readonly Trigger[]).includes(trigger);
}
export const EMAIL_TRIGGERS: readonly EmailTrigger[] = TRIGGERS.filter(isEmailTrigger);
/** The switches that only a person with admin.manage sees (owner, 2026-10-07). */
export const ADMIN_ONLY_TRIGGERS: ReadonlySet<Trigger> = new Set<Trigger>(['feedback_sent']);

/**
 * A reaction is one emoji (chat presence design E5). A string key, so a stored three-key record and any new key load. The quick three
 * are in REACTIONS (limits.ts); emoji.ts holds the rule and the order.
 */
export const Reaction = z.string().refine(isReactionEmoji, { message: 'A reaction is one emoji.' });
export type Reaction = string;

/** The "Notify me" level of a person for one chat: every message, or only a message that names the person (limits.ts, NOTIFY_LEVELS). */
export const NotifyLevel = z.enum(NOTIFY_LEVELS);
export type NotifyLevel = z.infer<typeof NotifyLevel>;

export const EventTarget = z.enum([
  'project', 'member', 'stage', 'deadline', 'task', 'update', 'comment', 'file', 'client', 'user', 'settings', 'stageTemplate', 'taskTemplate', 'tracker', 'payment', 'feedback', 'team',
  'projectTemplate', 'subCompany', 'meeting',
]);
export type EventTarget = z.infer<typeof EventTarget>;
export const NotificationTarget = z.enum(['project', 'task', 'update', 'chat', 'feedback', 'meeting']);
export type NotificationTarget = z.infer<typeof NotificationTarget>;

/**
 * What reaches the Admin (owner, 2026-10-23). "mine": only the work of the Admin, as for a Member. "mixed": the work of the Admin, and the
 * other project chats in the list, which count only the messages that name the Admin. "all": every message of every project chat counts,
 * and the bell gets a copy of each notice of the office. A missing value means "mixed". Only a person with the Admin role has an effect.
 */
export const AdminReach = z.enum(['mine', 'mixed', 'all']);
export type AdminReach = z.infer<typeof AdminReach>;
/** The three choices in the order the Settings screen shows them. */
export const ADMIN_REACH_CHOICES = AdminReach.options;

/** A weekday as dayOfWeek() counts: 0 is Sunday and 6 is Saturday. */
export const Weekday = z.number().int().min(0).max(6);
/** A time of the day on a 30-minute step: "HH:MM" from 00:00 to 23:30. */
export const Clock = z.string().regex(/^([01]\d|2[0-3]):[03]0$/, 'Use a time like 09:00 or 17:30.');
/** Work days: at least one, no repeat. */
const WorkDays = z.array(Weekday).min(1).max(7).refine((days) => new Set(days).size === days.length, { message: 'A day appears once.' });
/** The first time comes before the second one. A range never runs over midnight. */
const startsFirst = (range: { from: string; to: string }) => range.from < range.to;

/**
 * The work hours of a person (quiet hours, owner 2026-10-22, fbk_048): the work days and one time range in Riyadh time. With "quiet" on,
 * Madar sends the person no push and no email outside the range. The bell keeps everything. Read it with workHoursOf (lib/quietHours.ts).
 */
export const WorkHours = z.object({ quiet: z.boolean(), days: WorkDays, from: Clock, to: Clock }).refine(startsFirst, { message: 'The end comes after the start.', path: ['to'] });
export type WorkHours = z.infer<typeof WorkHours>;

/** The office work hours (owner, 2026-10-22): the default range of a person who chose none, and the lock that nobody can be quiet inside. */
export const OfficeWorkHours = z.object({
  days: WorkDays,
  from: Clock,
  to: Clock,
  lock: z.object({ on: z.boolean(), days: WorkDays, from: Clock, to: Clock }).refine(startsFirst, { message: 'The end comes after the start.', path: ['to'] }),
}).refine(startsFirst, { message: 'The end comes after the start.', path: ['to'] });
export type OfficeWorkHours = z.infer<typeof OfficeWorkHours>;

export const Preferences = z.object({
  language: Language,
  theme: Theme,
  glass: Glass,
  /** A trigger that is not there means on, so a person stored before a new trigger still loads (owner, 2026-10-07). Read it with inAppOn. */
  notifications: z.partialRecord(Trigger, z.boolean()),
  /** The real build: email switches by trigger. A missing trigger takes its default (spec 2, section 10). */
  email: z.partialRecord(Trigger, z.boolean()).optional(),
  /** The real build: the morning summary email. A missing value means on. */
  morningSummary: z.boolean().optional(),
  /** The hatch over the days that two stages share, on every schedule. A missing value means on (owner, 2026-10-05, item 9). */
  hatchOverlap: z.boolean().optional(),
  /** What reaches the Admin. A missing value means "mixed". Read it with adminReachOf (chatState.ts), which also checks the Admin role. */
  adminReach: AdminReach.optional(),
  /**
   * The person set Away by hand (chat presence design A2). A missing value means off. While it is on, each open device of the person
   * shows Away, whatever the use. Only the person sets it (never an agent), and only the devices of the person act on it. Others see
   * only "Away": no screen shows this field to another person.
   */
  awayByHand: z.boolean().optional(),
  /** Quiet hours (owner, 2026-10-22). A missing value means the office default with quiet hours on. Read it with workHoursOf (lib/quietHours.ts). */
  workHours: WorkHours.optional(),
});
export type Preferences = z.infer<typeof Preferences>;

/** A new person starts with the light theme. A person who exists keeps their choice (owner, 2026-10-05, item 11). */
export function defaultPreferences(): Preferences {
  const notifications = Object.fromEntries(TRIGGERS.map((trigger) => [trigger, true])) as Record<Trigger, boolean>;
  return { language: 'en', theme: 'light', glass: 'frosted', notifications };
}

export const Gender = z.enum(['female', 'male']);
export type Gender = z.infer<typeof Gender>;

/** One role for each person. Admin does everything. Management and Accounting also handle payments. Management also manages people. */
export const SystemRole = z.enum(['admin', 'management', 'accounting', 'member']);
export type SystemRole = z.infer<typeof SystemRole>;

/**
 * The office rights (owner, 2026-10-18, fbk_014). Role rights version 2 (owner, 2026-10-21): 119 switches in 13 sections, one id for each
 * switch (rightsCatalog.ts, the plain copy of the catalog JSON in docs). A switch opens one power for a person. The Admin holds every
 * switch. A power with scopes has one id for each scope: `<power>.<scope>`.
 * permissions.ts and rightsCatalog.ts hold the same names as plain constants, because they load with the screens and take no zod.
 */
export const OfficeRight = z.enum(CATALOG_RIGHT_IDS);
export type OfficeRight = z.infer<typeof OfficeRight>;

/**
 * A right as a stored list holds it: the 119 ids, and the 17 old ids of 2026-10-23 (project.editAny, people.manage, payment.manage and
 * so on). Only RoleSettings.rights, CustomRole.rights and the roles.* inputs take it, so old stored data still parses. rightsOf and the
 * roles calls expand an old id to its new ids (expandRights). Every output gives the 119 ids only.
 */
export const StoredRight = z.enum(STORED_RIGHT_IDS);
export type StoredRight = z.infer<typeof StoredRight>;

/** The most rights in one stored list: the 119 ids, with room for old ids. */
export const MAX_STORED_RIGHTS = 120;
/** The most `off` ids in one stored list: the 67 basic switches, with room. */
export const MAX_OFF_RIGHTS = 70;

/**
 * A role that the Admin makes. rights: the switches the role holds beyond BASIC_ON (it may still hold old ids). off: the BASIC_ON
 * switches the role does not hold. A role saved before role rights version 2 has no `off`, and a person with it holds the Member
 * switches and the switches of the role. A role with `off` holds its own full list (rights.ts, rightsOf).
 */
export const CustomRole = z.object({
  id: RoleId,
  name: z.string().trim().min(1).max(40),
  nameAr: z.string().trim().min(1).max(40),
  rights: z.array(StoredRight).max(MAX_STORED_RIGHTS),
  off: z.array(OfficeRight).max(MAX_OFF_RIGHTS).optional(),
});
export type CustomRole = z.infer<typeof CustomRole>;

/**
 * The office roles (owner, 2026-10-18). rights replaces the extra switches of a built-in role (the held switches beyond BASIC_ON). off
 * lists the BASIC_ON switches that a built-in role does not hold. A built-in role that has no entry keeps its default. custom lists the
 * roles the Admin makes. Optional, so an office saved before roles reads the defaults.
 */
const BuiltInRole = z.enum(['management', 'accounting', 'member']);
export const RoleSettings = z.object({
  rights: z.partialRecord(BuiltInRole, z.array(StoredRight).max(MAX_STORED_RIGHTS)).optional(),
  off: z.partialRecord(BuiltInRole, z.array(OfficeRight).max(MAX_OFF_RIGHTS)).optional(),
  custom: z.array(CustomRole).max(20).optional(),
});
export type RoleSettings = z.infer<typeof RoleSettings>;

/**
 * The profile picture (owner item 10, 2026-10-05). The browser cuts it to a 128 px square and saves it as a data address,
 * so no file store holds it. A data address of a WebP, JPEG or PNG picture (PICTURE_DATA, limits.ts), up to 24,000 characters.
 */
export const PICTURE_DATA_MAX = 24_000;
export const PICTURE_LINK_MAX = 2_000;
/** A new picture value: picture data, an https address, or null for no picture. Every other value fails (no other scheme). */
export const UserAvatarInput = z.union([
  z.string().max(PICTURE_DATA_MAX).regex(PICTURE_DATA, 'Expected picture data of a WebP, JPEG or PNG picture.'),
  z.string().max(PICTURE_LINK_MAX).regex(/^https:\/\/[^\s]+$/, 'Expected an https address.'),
]).nullable();
/** A saved picture value. A value saved before the rule above (up to 2,000 characters) still reads; the screens show only safe ones. */
const UserAvatar = z.union([
  z.string().max(PICTURE_DATA_MAX).regex(PICTURE_DATA),
  z.string().max(PICTURE_LINK_MAX),
]).nullable();

export const User = z.object({
  id: UserId,
  /** The English name. */
  name: z.string().trim().min(1).max(80),
  /** The Arabic name (owner item 12, 2026-10-05). Optional, so people saved before it still read. An empty value means none. */
  nameAr: z.string().trim().max(80).optional(),
  email: z.email(),
  avatarUrl: UserAvatar,
  kind: z.enum(['human', 'agent']),
  systemRole: SystemRole,
  discipline: z.string().trim().min(1).max(40),
  active: z.boolean(),
  // For an agent: the person it acts for (spec 17). For a person: null.
  ownerId: UserId.nullable(),
  preferences: Preferences,
  // For Arabic grammar only: a verb after a person's name agrees with it. Unset reads as masculine.
  gender: Gender.optional(),
  /**
   * True for a turned-off person that the Admin removed from the lists (owner, 2026-10-12). The record stays, so the History, the
   * tasks, the comments and the messages keep the name. Optional, so people saved before it still read. Unset means not removed.
   */
  removed: z.boolean().optional(),
  /** The custom role of a person (owner, 2026-10-18). Only a Member holds one: rightsOf (rights.ts) ignores it for the other roles. Unset means none. */
  roleId: RoleId.nullable().optional(),
});
export type User = z.infer<typeof User>;

/** The client initials in a project code: 3 or 4 capital Latin letters. */
export const ClientInitials = z.string().regex(INITIALS_PATTERN, 'Use 3 or 4 capital Latin letters.');

export const Client = z.object({
  id: ClientId,
  /** The English name. A client may have only an Arabic name, so either one may be empty, never both (colleague comment 11). */
  name: z.string().trim().max(120),
  /** Optional, so offices saved before Arabic names existed still load. */
  nameAr: z.string().trim().max(120).optional(),
  contactName: z.string().max(80),
  phone: z.string().max(40),
  email: z.union([z.email(), z.literal('')]),
  /** 3 or 4 capital Latin letters for the project code (owner, 2026-10-05). Optional, so clients saved before still load. */
  initials: ClientInitials.optional(),
});
export type Client = z.infer<typeof Client>;

export const StageName = z.string().trim().min(1).max(60);
export const StageTemplate = z.object({
  id: StageTemplateId,
  name: z.string().trim().min(1).max(60),
  stages: z.array(StageName).min(1).max(20),
  createdBy: UserId,
  createdAt: Stamp,
});
export type StageTemplate = z.infer<typeof StageTemplate>;

export const HealthOverride = z.object({
  value: HealthValue,
  reason: z.string().trim().min(1).max(280),
  setBy: UserId,
  setAt: Stamp,
});
export type HealthOverride = z.infer<typeof HealthOverride>;

/** "internal": the office pauses its own work. "client": the project waits for the client (colleague comment 16). */
export const PauseKind = z.enum(['internal', 'client']);
export type PauseKind = z.infer<typeof PauseKind>;

/**
 * Why and until when a leader paused a project (owner, 2026-10-01). The project status is on_hold while it is set.
 * "kind" and "trackerId" are optional, so a pause saved before them reads as internal with no tracker entry.
 * A client pause logs a Tracker entry that waits for the client. "trackerId" names it, so Resume can close it.
 */
export const ProjectPause = z.object({
  reason: z.string().trim().min(1).max(280), resumeOn: Day.nullable(), by: UserId, at: Stamp,
  kind: PauseKind.optional(), trackerId: TrackerId.optional(),
});
export type ProjectPause = z.infer<typeof ProjectPause>;

/** A link to a place outside Madar: a moodboard, an office folder, a map pin, the client's delivery folder (colleague comment 5, 2026-10-01). */
export const LinkKind = z.enum(['moodboard', 'folder', 'location', 'delivery', 'other']);
export type LinkKind = z.infer<typeof LinkKind>;
const WEB_LINK = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const NETWORK_PATH = /^\\\\[^\\\s]+\\.+$/;
/** Only web links open from Madar, so a link can never run code. An office folder may also be a network path (\\SERVER\folder), which Madar copies. */
export function linkUrlOk(kind: LinkKind, url: string): boolean {
  return WEB_LINK.test(url) || (kind === 'folder' && NETWORK_PATH.test(url));
}
export const isNetworkPath = (url: string): boolean => NETWORK_PATH.test(url);
export const ProjectLink = z.object({ id: z.string(), kind: LinkKind, label: z.string().trim().max(80), url: z.string().trim().min(1).max(500) });
export type ProjectLink = z.infer<typeof ProjectLink>;

/** Why a project went back to an earlier stage, shown until it moves forward again (colleague comment 12, 2026-10-01). */
export const StageBack = z.object({ fromStageId: StageId, toStageId: StageId, reason: z.string().trim().min(1).max(280), by: UserId, at: Stamp });
export type StageBack = z.infer<typeof StageBack>;

/**
 * A project code: the old or the new form, or a code that a person kept after the warning (feedback fbk_003, 2026-10-12): visible
 * text of 1 to 60 characters. The office pattern is a check of projects.create and projects.update, not of the record.
 */
export const ProjectCode = z.string().regex(RECORD_CODE_PATTERN, 'Write the code on one line, with visible characters and 60 characters or fewer.');

/** A point on the map: the pin of a project, in decimal degrees (owner, 2026-10-18, fbk_017). */
export const GeoPoint = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export type GeoPoint = z.infer<typeof GeoPoint>;

/** The id of a role, a stage or a task inside one project template. The editor makes it. It is unique in its template. */
export const TemplatePartId = z.string().regex(/^[a-z][a-z0-9]{0,23}$/, 'Expected a short id like s1 or t12.');

/**
 * A copy of what the template said about each part when the project last took it: made, linked or updated (ADM-01). A template
 * update counts a part as changed only when the template differs from this copy. It counts a project item as edited by the team
 * when the item differs from this copy. The dates are the dates that the template gave the project. The number limits repeat
 * TemplateOffset and DurationDays, which come later in this file.
 */
export const TemplateBase = z.object({
  stages: z.record(TemplatePartId, z.object({
    name: z.string().max(60), startOffset: z.number().int().min(0).max(2000).nullable(), durationDays: z.number().int().min(1).max(365).nullable(),
  })),
  tasks: z.record(TemplatePartId, z.object({
    title: z.string().max(200), description: z.string().max(5000), roleId: TemplatePartId.nullable(),
    startOffset: z.number().int().min(0).max(2000), durationDays: z.number().int().min(1).max(365),
    startDate: Day.nullable(), dueDate: Day.nullable(),
  })),
});
export type TemplateBase = z.infer<typeof TemplateBase>;

/**
 * The template that a project came from (fbk_008 item 4). It keeps the person of each role of the form, and the template parts
 * that the project dropped. A deleted task or a removed stage adds its part id there.
 */
export const TemplateLink = z.object({
  templateId: ProjectTemplateId,
  linkedAt: Stamp,
  /** Null: no update of the template has reached the project yet. */
  syncedAt: Stamp.nullable(),
  /** The person of each role, by the role id of the template. Null: the role has no person. */
  rolePeople: z.record(TemplatePartId, UserId.nullable()),
  /** The template parts that the project dropped. A template has at most 200 tasks and 20 stages. */
  droppedPartIds: z.array(TemplatePartId).max(220),
  /** What the template said when the project last took it. Optional: a link made before ADM-01 has none, and its differences show as team edits. */
  base: TemplateBase.optional(),
});
export type TemplateLink = z.infer<typeof TemplateLink>;

/**
 * Who sees a project (hidden projects, owner 2026-10-22). hidden: the project shows only to its leader, its team, the people in viewerIds
 * and the holders of the switch "See hidden projects". Optional on the project: a missing value is an open project with no chosen people.
 */
export const ProjectAccess = z.object({
  hidden: z.boolean(),
  viewerIds: z.array(UserId).max(MAX_PROJECT_VIEWERS),
});
export type ProjectAccess = z.infer<typeof ProjectAccess>;

/**
 * The kind of a project (fbk_044, owner 2026-10-22). An internal project is the office's own work, like a portfolio: it has no client, code on
 * the screens, place, area, sub-company, contract date, payments or Tracker. It starts hidden. Optional on the project: a missing value is a client project.
 */
export const ProjectKind = z.enum(['client', 'internal']);
export type ProjectKind = z.infer<typeof ProjectKind>;

/** The most folders that one project holds (fbk_066). */
export const MAX_FOLDERS = 100;
/** The longest folder name, in letters (fbk_066). */
export const FOLDER_NAME_MAX = 60;

/**
 * A folder of the Files & Links tab (fbk_066, owner 2026-10-26). It is only for organizing: it sits in one real stage of its project, one level
 * deep, and holds files. The project keeps the list (Project.folders, as it keeps its links), so a folder is seen by exactly the people who see the
 * project and its files, and no table is needed. A folder name may repeat across stages, never inside one stage.
 */
export const ProjectFolder = z.object({
  id: FolderId,
  stageId: StageId,
  name: z.string().trim().min(1).max(FOLDER_NAME_MAX),
  createdBy: UserId,
  createdAt: Stamp,
});
export type ProjectFolder = z.infer<typeof ProjectFolder>;

export const Project = z.object({
  id: ProjectId,
  /** The old form KH-26-014, or the new form YYMMSSINI-CLS-Type (owner, 2026-10-05, lib/projectCode.ts). Two projects of one contract share one code. */
  code: ProjectCode,
  name: z.string().trim().min(1).max(120),
  /** The Arabic name (owner, 2026-10-26, fbk_062). Optional, so projects saved before it still read. An empty value means none. */
  nameAr: z.string().trim().max(120).optional(),
  clientId: ClientId.nullable(),
  status: ProjectStatus,
  leaderId: UserId.nullable(),
  currentStageId: StageId,
  location: z.string().max(120),
  areaM2: z.number().nonnegative().nullable(),
  /** The pin on the map (owner, 2026-10-18, fbk_017). Optional, so offices saved before pins existed still load. */
  geo: GeoPoint.nullable().optional(),
  startDate: Day.nullable(),
  targetEndDate: Day.nullable(),
  coverFileId: FileId.nullable(),
  modelFolderPath: z.string().max(260),
  description: z.string().max(5000),
  healthOverride: HealthOverride.nullable(),
  // Optional, so offices saved before pauses existed still load.
  pause: ProjectPause.nullable().optional(),
  /** The project's picture: one form and a second light, never the same as another project's (owner, 2026-10-01). */
  mark: z.number().int().nonnegative().optional(),
  /** Optional, so offices saved before links existed still load. */
  links: z.array(ProjectLink).max(20).optional(),
  /** The folders of the Files & Links tab (fbk_066). Optional, so older offices still load. A list row leaves them out (summaryOf). */
  folders: z.array(ProjectFolder).max(MAX_FOLDERS).optional(),
  stageBack: StageBack.nullable().optional(),
  /** The day the client's contract starts (colleague comment 7, 2026-10-01). Optional, so older offices still load. */
  contractStartDate: Day.nullable().optional(),
  /** The sub-company of the project (fbk_007). Optional, so offices saved before sub-companies still load. */
  subCompanyId: SubCompanyId.nullable().optional(),
  /** The template the project came from. Optional and null: a project made by hand has none, and older offices still load. */
  templateLink: TemplateLink.nullable().optional(),
  /** Who sees the project (hidden projects, owner 2026-10-22). Optional, so a project saved before it is open to the office. */
  access: ProjectAccess.optional(),
  /** The kind of the project (fbk_044). Set once when the project is made, and never changes. A missing value is a client project. */
  kind: ProjectKind.optional(),
  createdBy: UserId,
  createdAt: Stamp,
  updatedAt: Stamp,
});
export type Project = z.infer<typeof Project>;

export const ProjectMember = z.object({
  projectId: ProjectId,
  userId: UserId,
  discipline: z.string().trim().min(1).max(40),
});
export type ProjectMember = z.infer<typeof ProjectMember>;

export const Stage = z.object({
  id: StageId,
  projectId: ProjectId,
  name: z.string().trim().min(1).max(60),
  order: z.number().int().min(0),
  startDate: Day.nullable(),
  endDate: Day.nullable(),
  /** Stages of the same project that need to be finished first. Optional, so older offices still load. */
  prerequisiteIds: z.array(StageId).max(MAX_PREREQUISITES).optional(),
  /** The template part that this stage came from. Optional: a stage made by hand has none. */
  templatePartId: TemplatePartId.optional(),
});
export type Stage = z.infer<typeof Stage>;

export const Deadline = z.object({
  id: DeadlineId,
  projectId: ProjectId,
  stageId: StageId.nullable(),
  name: z.string().trim().min(1).max(120),
  date: Day,
});
export type Deadline = z.infer<typeof Deadline>;

export const ChecklistItem = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(200),
  done: z.boolean(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

/** Static: a person sets the start and the due date. Dynamic: a person sets the start and a number of working days, and the server sets the due date. */
export const TaskSchedule = z.enum(['static', 'dynamic']);
export type TaskSchedule = z.infer<typeof TaskSchedule>;
export const DurationDays = z.number().int().min(1).max(365);

/** One round of a task. A finished task that is opened again starts the next one (colleague comment 8, 2026-10-01). */
export const TaskVersion = z.object({
  n: z.number().int().min(1),
  reason: z.string().max(280),
  openedAt: Stamp,
  openedBy: UserId,
  finishedAt: Stamp.nullable(),
});
export type TaskVersion = z.infer<typeof TaskVersion>;

/**
 * One automatic move of a task's dates, kept in the task (owner, 2026-10-02). "byTaskId" and "lateDays" let a screen write the
 * sentence in its own language; "reason" is the same sentence in English, for an agent and for a task that lost its prerequisite.
 */
export const DateNote = z.object({
  from: z.object({ startDate: Day.nullable(), dueDate: Day.nullable() }),
  to: z.object({ startDate: Day.nullable(), dueDate: Day.nullable() }),
  reason: z.string().max(400),
  at: Stamp,
  byTaskId: TaskId.optional(),
  lateDays: z.number().int().min(1).optional(),
  /** The due day of the finished task that this move was made for. A later move takes this one off only for the same due day (audit 2026-10-03, V-3). */
  forDueDate: Day.optional(),
});
export type DateNote = z.infer<typeof DateNote>;

export const Task = z.object({
  id: TaskId,
  /** Null: an office task, which belongs to no project (owner, 2026-10-06). Only its maker, its lead, its helpers and the Admin see it. */
  projectId: ProjectId.nullable(),
  /** Null for an office task. A project task always has a stage. */
  stageId: StageId.nullable(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  /** The lead. Null: the task has no lead yet (owner, 2026-10-05). A task with no lead cannot finish. Old records keep a string. */
  ownerId: UserId.nullable(),
  status: TaskStatus,
  dueDate: Day.nullable(),
  // Optional, so an office saved before start dates still loads: missing means no start, static, no duration.
  startDate: Day.nullable().optional(),
  schedule: TaskSchedule.optional(),
  durationDays: DurationDays.nullable().optional(),
  flagged: z.boolean(),
  needsReview: z.boolean(),
  checklist: z.array(ChecklistItem).max(100),
  /** Optional, so an office saved before versions still loads: missing means version 1. */
  version: z.number().int().min(1).optional(),
  versions: z.array(TaskVersion).max(50).optional(),
  /** Optional, so an office saved before helpers still loads. The lead is ownerId and is never in this list. */
  helperIds: z.array(UserId).max(MAX_HELPERS).optional(),
  /** Tasks of the same project that must be done first. Optional, so older offices still load. */
  prerequisiteIds: z.array(TaskId).max(MAX_PREREQUISITES).optional(),
  /** The template part that this task came from. Optional: a task made by hand has none. */
  templatePartId: TemplatePartId.optional(),
  /** The automatic date moves of a dynamic task, oldest first (the last 20). */
  dateNotes: z.array(DateNote).max(20).optional(),
  createdBy: UserId,
  createdAt: Stamp,
  completedAt: Stamp.nullable(),
  /** The Tracker entry this task answers (a reply task). Null after that entry is deleted. */
  trackerEntryId: TrackerId.nullable().optional(),
  /** The meeting this task is the minutes of (fbk_022). Null or missing: not a minutes task. Wave 2 sets it. */
  meetingId: MeetingId.nullable().optional(),
  /**
   * The place of the task in the shared order of a date group on the Tasks screen and Home: a lower number sits higher. Null or
   * missing: no place yet, so the task sits under the placed ones (owner, 2026-10-07, `lib/arrange.ts`).
   */
  rank: z.number().nullable().optional(),
});
export type Task = z.infer<typeof Task>;

/**
 * A task saved for one stage (colleague comments 8 and 12). It belongs to a stage by the stage's name, because every project
 * has its own stage records. The checklist holds item titles only: a task made from it starts with every item unticked.
 */
export const TaskTemplate = z.object({
  id: TaskTemplateId,
  /** The title of a task made from it. */
  name: z.string().trim().min(1).max(200),
  stageName: StageName,
  description: z.string().max(5000),
  checklist: z.array(z.string().trim().min(1).max(200)).max(100),
  needsReview: z.boolean(),
  schedule: TaskSchedule,
  /** Working days. Set when schedule is dynamic, null when it is static. */
  durationDays: DurationDays.nullable(),
  createdBy: UserId,
  createdAt: Stamp,
});
export type TaskTemplate = z.infer<typeof TaskTemplate>;

/** A working day of a template: day 0 is the first working day of the project. */
export const TemplateOffset = z.number().int().min(0).max(2000);
export const TEMPLATE_MAX_ROLES = 20;
export const TEMPLATE_MAX_STAGES = 20;
export const TEMPLATE_MAX_TASKS = 200;

/** A role of a template, for example "Architect", with the person who takes it unless the new project names another one. */
export const TemplateRole = z.object({
  id: TemplatePartId,
  name: z.string().trim().min(1).max(60),
  /** Null: the role has no default person, so its tasks have no lead unless the new project names one. */
  defaultUserId: UserId.nullable(),
});
export type TemplateRole = z.infer<typeof TemplateRole>;

/**
 * A stage of a template. A stage may have its own start and length (both or none), with or without tasks. Its span covers
 * its own numbers and its tasks. A stage with no numbers and no tasks gets no dates.
 */
export const TemplateStage = z.object({
  id: TemplatePartId,
  name: StageName,
  startOffset: TemplateOffset.nullable(),
  durationDays: DurationDays.nullable(),
  /** The stages of this template that must be done first (fbk_008). Optional, so a template saved before waits still loads. */
  prerequisiteIds: z.array(TemplatePartId).max(MAX_PREREQUISITES).optional(),
});
export type TemplateStage = z.infer<typeof TemplateStage>;

/**
 * A task of a template. Its start and length are working days. "flexible" is the first state of its "Can stretch" tick.
 * A task with waits becomes a dynamic task in a new project: it moves when a task it waits for moves.
 */
export const TemplateTask = z.object({
  id: TemplatePartId,
  stageId: TemplatePartId,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  /** Item titles only: a task made from the template starts with every item unticked. */
  checklist: z.array(z.string().trim().min(1).max(200)).max(100),
  needsReview: z.boolean(),
  /** The role whose person leads the task. Null: the task has no lead. */
  roleId: TemplatePartId.nullable(),
  startOffset: TemplateOffset,
  durationDays: DurationDays,
  flexible: z.boolean(),
  /** The tasks of this template that must be done first (fbk_008). Optional, so a template saved before waits still loads. */
  prerequisiteIds: z.array(TemplatePartId).max(MAX_PREREQUISITES).optional(),
});
export type TemplateTask = z.infer<typeof TemplateTask>;

/**
 * A project template (owner, 2026-10-05, item 6a): stages, tasks, roles and dates in working days from the project start.
 * A new project made from it gets its stages, its tasks with dates and leads, and its start and end. Stage templates of
 * before became project templates with stages and no tasks.
 */
export const ProjectTemplate = z.object({
  id: ProjectTemplateId,
  name: z.string().trim().min(1).max(60),
  roles: z.array(TemplateRole).max(TEMPLATE_MAX_ROLES),
  stages: z.array(TemplateStage).min(1).max(TEMPLATE_MAX_STAGES),
  tasks: z.array(TemplateTask).max(TEMPLATE_MAX_TASKS),
  /**
   * The highest part number that the template ever gave (fbk_008 item 4). A removed part keeps its number here, so a new part
   * never gets the id of a removed one. Optional, so a template saved before this field still loads.
   */
  partSeq: z.number().int().nonnegative().optional(),
  createdBy: UserId,
  createdAt: Stamp,
  updatedAt: Stamp,
});
export type ProjectTemplate = z.infer<typeof ProjectTemplate>;

/**
 * One browser or phone of one person that gets push notices (owner, 2026-10-08). It is private: only its person reads it. The
 * endpoint is the address of the push service of the browser (limits.ts, isPushEndpoint). One row for each endpoint.
 */
export const PushEndpoint = z.string().max(PUSH_ENDPOINT_MAX).refine(isPushEndpoint, 'Expected the https address of a browser push service.');
/**
 * The keys of a browser for the message encryption of Web Push (owner, 2026-10-21; RFC 8291): p256dh, its P-256 public key of
 * 65 bytes, and auth, a secret of 16 bytes, in base64url. The server encrypts the line of each push with them, so only that
 * browser reads it. A browser may give them with base64 padding (push.register takes it off); the record keeps them without it.
 */
export const PushKeys = z.object({
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/, 'Expected a P-256 public key of 65 bytes in base64url.'),
  auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Expected a secret of 16 bytes in base64url.'),
});
export type PushKeys = z.infer<typeof PushKeys>;
export const PushDevice = z.object({
  id: PushDeviceId,
  userId: UserId,
  endpoint: PushEndpoint,
  label: z.string().trim().min(1).max(PUSH_LABEL_MAX),
  createdAt: Stamp,
  lastPushAt: Stamp.nullable(),
  /** Missing on a device saved before 2026-10-21: it gets the empty push (the fixed line) until its browser sends the keys. */
  keys: PushKeys.optional(),
  /** Quiet hours (owner, 2026-10-22): the time of a push that the server held back. Set and cleared by the push effects. Optional. */
  heldAt: Stamp.optional(),
});
export type PushDevice = z.infer<typeof PushDevice>;

export const Update = z.object({
  id: UpdateId,
  projectId: ProjectId,
  authorId: UserId,
  body: z.string().trim().min(1).max(5000),
  fileIds: z.array(FileId).max(20),
  /** Set only on a decision made in a team meeting. */
  decision: z.literal(true).optional(),
  createdAt: Stamp,
  editedAt: Stamp.nullable(),
});
export type Update = z.infer<typeof Update>;

export function emptyReactions(): Record<Reaction, string[]> {
  return { '👍': [], '✅': [], '👀': [] };
}

/**
 * The dates a task had before and after a move, on the Conversation message about it (owner, 2026-10-02).
 * A person's move carries their reason in the message body. Madar's own move names the task it waited for and how late that was.
 */
export const DateMove = z.object({
  from: z.object({ startDate: Day.nullable(), dueDate: Day.nullable() }),
  to: z.object({ startDate: Day.nullable(), dueDate: Day.nullable() }),
  byTaskId: TaskId.optional(),
  byTaskTitle: z.string().max(200).optional(),
  lateDays: z.number().int().min(1).optional(),
});
export type DateMove = z.infer<typeof DateMove>;

/**
 * The kind of a comment that Madar writes as a quiet line of the thread (fbk_027, owner 2026-10-19). Only "reopened" is stored: the
 * reason of a task that opens again. A reason of a date move has `dates`, and a Madar shift has `dates.byTaskId`; `lineKindOf`
 * (`lib/commentLine.ts`) reads all three, so a comment saved before reads the new way too.
 */
export const CommentKind = z.enum(['reopened']);
export type CommentKind = z.infer<typeof CommentKind>;

export const Comment = z.object({
  id: CommentId,
  targetType: z.enum(['task', 'update']),
  targetId: z.union([TaskId, UpdateId]),
  authorId: UserId,
  body: z.string().trim().min(1).max(5000),
  reactions: z.record(Reaction, z.array(UserId)),
  // Older saved comments have no list. A missing list means no files.
  fileIds: z.array(FileId).max(MAX_ATTACHMENTS).optional(),
  // Only on the message Madar posts when the dates of a task move. Other comments have none.
  dates: DateMove.optional(),
  // Only on the line that Madar writes when a task opens again. Other comments have none.
  kind: CommentKind.optional(),
  /**
   * The comment of the same task that this comment answers (chat design item 10, owner 2026-10-19). A link, never a copy. Optional,
   * so older comments load.
   */
  replyToId: CommentId.optional(),
  /**
   * The people that @everyone named in this comment (owner, 2026-10-22, fbk_041), so the bubble marks "names you" for each. A person named
   * by name is read from the text, as before. Only a comment with the everyone words has the list. Optional, so older comments load.
   */
  mentions: z.array(UserId).max(200).optional(),
  createdAt: Stamp,
  editedAt: Stamp.nullable(),
});
export type Comment = z.infer<typeof Comment>;

/**
 * One quiet line of a group (UX audit 2026-10-19, chats-10): a person was added, was removed or left, or the group got a new
 * name. It is no message, so it is never unread, makes no push and does not change the preview. "personIds" are the people it
 * names (added, removed). "name" is the new name of a rename.
 */
export const GroupLogEntry = z.object({
  id: z.string().min(1).max(40),
  at: Stamp,
  type: z.enum(['added', 'removed', 'left', 'renamed']),
  actorId: UserId,
  personIds: z.array(UserId).max(GROUP_MAX),
  name: z.string().max(GROUP_NAME_MAX).optional(),
});
export type GroupLogEntry = z.infer<typeof GroupLogEntry>;

/**
 * A chat room. A project chat has no member list: its people are the project team and the Admin. A direct chat has exactly two.
 * A group (owner, 2026-10-18) has 3 to 50 people, a name and a maker. Its people keep the order in which they joined.
 */
export const Conversation = z.object({
  id: ConversationId,
  kind: z.enum(['project', 'direct', 'group']),
  projectId: ProjectId.nullable(),
  memberIds: z.array(UserId).max(GROUP_MAX),
  // A group only. The maker made the group. When the maker leaves, the first person in memberIds becomes the maker.
  name: z.string().trim().min(1).max(GROUP_NAME_MAX).optional(),
  makerId: UserId.optional(),
  // A group only: its quiet lines, oldest first, the newest GROUP_LOG_MAX.
  log: z.array(GroupLogEntry).max(GROUP_LOG_MAX).optional(),
  createdAt: Stamp,
})
  .refine((c) => c.kind !== 'direct' || c.memberIds.length === 2, { message: 'A direct chat holds exactly two people.' })
  .refine((c) => c.kind !== 'group' || (c.name !== undefined && c.makerId !== undefined), { message: 'A group has a name and a maker.' });
export type Conversation = z.infer<typeof Conversation>;

export const MESSAGE_MAX = 4000;

export const Message = z.object({
  id: MessageId,
  conversationId: ConversationId,
  authorId: UserId,
  // The person an agent acted for. For a person's own message it is the author.
  actingForId: UserId,
  body: z.string().trim().min(1).max(MESSAGE_MAX),
  mentions: z.array(UserId),
  // Older saved messages have no list. A missing list means no files.
  fileIds: z.array(FileId).max(MAX_ATTACHMENTS).optional(),
  /**
   * The message of the same chat that this message answers (chat design item 10, owner 2026-10-19). A link, never a copy: an edit
   * shows the new text, and a deleted message shows as "Deleted message". Optional, so older messages load.
   */
  replyToId: MessageId.optional(),
  /**
   * The reactions on this message (item 12), as on a comment. A written record holds the three quick keys (emptyReactions) and the
   * other emoji that have people. A missing record means no reactions. Optional, so older messages load.
   */
  reactions: z.record(Reaction, z.array(UserId)).optional(),
  /**
   * Set when the author deletes the message (item 11). A set value means deleted: no read path gives the message, until an Undo
   * removes the key. Optional, so older messages load.
   */
  deletedAt: Stamp.optional(),
  createdAt: Stamp,
  editedAt: Stamp.nullable(),
});
export type Message = z.infer<typeof Message>;

/** When a person last read a conversation. */
/**
 * One read mark. The conversation is a chat, or a task whose comments the Inbox shows as a thread (audit 2026-10-03, SHL-5).
 * "archivedAt" is set when the person archives the chat (owner, 2026-10-18). It is private to the person. A newer message clears
 * it in the view (isArchived), so a new message needs no write to the mark.
 */
export const ChatRead = z.object({
  conversationId: z.union([ConversationId, TaskId]), userId: UserId, lastReadAt: Stamp, archivedAt: Stamp.nullable().optional(),
  /** The person marked the chat unread (chats.markUnread, fbk_028). The chat counts as unread until a read mark replaces this record. */
  markedUnread: z.boolean().optional(),
  /**
   * The "Notify me" choice of the person for this chat (item 21). Missing means the start value of the chat kind (notifyLevelOf):
   * "named" for a project chat, "all" for a direct chat or a group. Optional, so older read marks load.
   */
  notify: NotifyLevel.optional(),
  /**
   * The last time the person looked at the chat while it was open, in view and in use (chat design C4). Only chats.markRead with
   * seen: true moves it, and only forward. Optional, so older read marks load and no copy of the old read marks is made.
   */
  seenAt: Stamp.optional(),
});
export type ChatRead = z.infer<typeof ChatRead>;

/** The screens call 'balady' Government since 2026-10-12: any government body, not only the Balady portal (owner). The value stays. */
export const TRACKER_TYPES = ['meeting', 'message', 'file', 'balady', 'other'] as const;
export const TrackerType = z.enum(TRACKER_TYPES);
export type TrackerType = z.infer<typeof TrackerType>;
/** "in" is from the client to the office. "out" is from the office to the client. */
export const TrackerDirection = z.enum(['in', 'out', 'both', 'third_party', 'none']);
export type TrackerDirection = z.infer<typeof TrackerDirection>;
/** Who an open loop waits for: "us" (the office owes a reply) or "client" (the office waits for the client). */
export const TrackerWaiting = z.enum(['us', 'client']);
export type TrackerWaiting = z.infer<typeof TrackerWaiting>;

/**
 * The minutes of a meeting (fbk_022, wave 2): one text with files. Any attendee of the meeting writes and changes them. A project meeting
 * that is not a team meeting keeps them on its Tracker line. A meeting with no project, and a team meeting, keep them on the meeting itself.
 * "updatedBy" is the person; for an agent, the person it acts for.
 */
export const MeetingMinutes = z.object({
  text: z.string().max(MEETING_LIMITS.minutesMax),
  fileIds: z.array(FileId).max(MAX_ATTACHMENTS),
  updatedBy: UserId,
  updatedAt: Stamp,
});
export type MeetingMinutes = z.infer<typeof MeetingMinutes>;

/**
 * One exchange with the client: a meeting, a message, a file or a government update, such as the Balady permit portal (owner, 2026-10-01).
 * An entry with "waiting" set and no "closedAt" is an open loop. "auto" says the office made the entry itself.
 */
export const TrackerEntry = z.object({
  id: TrackerId,
  projectId: ProjectId,
  type: TrackerType,
  direction: TrackerDirection,
  title: z.string().trim().min(1).max(200),
  note: z.string().max(2000),
  date: Day,
  waiting: TrackerWaiting.nullable(),
  closedAt: Stamp.nullable(),
  closedBy: UserId.nullable(),
  fileIds: z.array(FileId).max(MAX_ATTACHMENTS),
  peopleIds: z.array(UserId).max(20),
  auto: z.enum(['upload', 'delivered', 'version', 'reply', 'shift', 'meeting']).nullable(),
  createdBy: UserId,
  createdAt: Stamp,
  /**
   * The task of the person who answers a "waiting for our reply" entry. Optional, so an office saved before replies still loads.
   * Null when the entry stopped waiting while its reply task could not finish yet (audit 2026-10-03, V-13).
   */
  replyTaskId: TaskId.nullable().optional(),
  /** The meeting of an auto "meeting" line (fbk_022, wave 2). Optional, so older entries load. */
  meetingId: MeetingId.nullable().optional(),
  /** The minutes of that meeting. Any attendee writes them (meetings.saveMinutes). Null or missing: no minutes yet. */
  minutes: MeetingMinutes.nullable().optional(),
});
export type TrackerEntry = z.infer<typeof TrackerEntry>;

/**
 * One payment the client owes the office for a project (colleague comment 6, owner, 2026-10-01). Amounts are in Saudi riyals.
 * "receivedOn" is null until the money arrives. Only the Admin, Management and Accounting ever read or change payments.
 */
export const Payment = z.object({
  id: PaymentId,
  projectId: ProjectId,
  name: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(1_000_000_000_000),
  dueDate: Day,
  receivedOn: Day.nullable(),
  note: z.string().max(500),
  createdBy: UserId,
  createdAt: Stamp,
  /**
   * The Daftra invoice that the accountant linked to this payment (owner, 2026-10-26). Optional, so an old row still loads. Madar only
   * reads Daftra. While this is set and `receivedOn` is null, the screens show "Invoiced". Only a person with `payment.view` reads a payment.
   */
  daftra: z.object({
    invoiceId: z.string().min(1).max(40),
    invoiceNo: z.string().min(1).max(40),
    /** The invoice total in riyals, with VAT. */
    total: z.number().nonnegative().max(1_000_000_000_000),
    issuedOn: Day,
    linkedBy: UserId,
    linkedAt: Stamp,
  }).optional(),
});
export type Payment = z.infer<typeof Payment>;

/** A feature request or a bug report from the person menu, with up to three screenshots (owner, 2026-10-01). */
export const FeedbackKind = z.enum(['feature', 'bug']);
export type FeedbackKind = z.infer<typeof FeedbackKind>;
export const Feedback = z.object({
  id: z.string(),
  kind: FeedbackKind,
  message: z.string().trim().min(1).max(2000),
  /** The screen the person was on, so a bug report says where it happened. */
  page: z.string().max(300),
  screenshots: z.array(z.object({ blobKey: z.string(), type: z.string().max(60) })).max(3),
  status: z.enum(['new', 'done']),
  createdBy: UserId,
  createdAt: Stamp,
  doneBy: UserId.nullable(),
  doneAt: Stamp.nullable(),
});
export type Feedback = z.infer<typeof Feedback>;

export const FileVersion = z.object({
  letter: z.string().regex(/^[A-Z]+$/),
  blobKey: z.string().min(1),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().min(0).max(MAX_FILE_BYTES),
  uploadedBy: UserId,
  uploadedAt: Stamp,
  /** The real build: the stored key of the small picture of an image. Optional, so older versions load. */
  thumbKey: z.string().min(1).optional(),
});
export type FileVersion = z.infer<typeof FileVersion>;

export const FileRec = z.object({
  id: FileId,
  /** Null: a file of an office task (owner, 2026-10-06). Its taskId names that task. */
  projectId: ProjectId.nullable(),
  stageId: StageId.nullable(),
  taskId: TaskId.nullable(),
  /**
   * A file of a direct chat or a group (owner, 2026-10-19): the chat that holds it. Then projectId, stageId and taskId are null. The
   * people who read the messages of that chat open the file, and nobody else. Optional, so older files load.
   */
  conversationId: ConversationId.optional(),
  /**
   * A file of a meeting with no project (owner, 2026-10-19, wave 2): the meeting whose minutes hold it. Then projectId, stageId and
   * taskId are null. The people who see that meeting open the file, and nobody else. Optional, so older files load.
   */
  meetingId: MeetingId.optional(),
  /**
   * The folder that holds the file (fbk_066, owner 2026-10-26). A folder sits in one stage, so the file has the stageId of that folder. Null or
   * missing: the file sits at the root of its stage. Optional, so older files load.
   */
  folderId: FolderId.nullable().optional(),
  name: z.string().trim().min(1).max(200),
  versions: z.array(FileVersion).min(1),
});
export type FileRec = z.infer<typeof FileRec>;

/** The kind and the start of the message of a report, so the notice line needs no report row (owner, 2026-10-07). */
export const NoticeFeedback = z.object({ kind: FeedbackKind, excerpt: z.string().min(1).max(200) });
export type NoticeFeedback = z.infer<typeof NoticeFeedback>;

export const Notification = z.object({
  id: NotificationId,
  userId: UserId,
  trigger: Trigger,
  actorId: UserId.nullable(),
  targetType: NotificationTarget,
  targetId: z.string().min(1),
  read: z.boolean(),
  createdAt: Stamp,
  dedupeKey: z.string().nullable(),
  /** The story of the change that made the notice, so an Undo of the whole story takes the notice back. Optional, so older notices load. */
  correlationId: z.string().min(1).max(80).optional(),
  /** The due day a reminder names, so its words say the day, never "tomorrow" (audit 2026-10-03, API-11). Optional, so older notices load. */
  dueDate: Day.optional(),
  /** The words of a report notice. Optional, so older notices load. */
  feedback: NoticeFeedback.optional(),
  /**
   * The chat message or the task comment that a mention notice points to, so a press opens the chat at that message (item 17).
   * Optional, so older notices load.
   */
  messageId: z.string().min(1).max(40).optional(),
  /** True on a notice of a reply: the person wrote the message that this one answers (item 10). Optional, so older notices load. */
  reply: z.literal(true).optional(),
  /**
   * True on a mention notice that came from @everyone (owner, 2026-10-22, fbk_041): the person is named by "everyone", not by name. Such a
   * notice sends a push but no email. Optional, so older notices load.
   */
  everyone: z.literal(true).optional(),
  /** What happened to the meeting of a meeting_invited notice: it is new for this person, it moved, or it was cancelled (fbk_022). Optional, so older notices load. */
  meeting: z.object({ change: z.enum(['new', 'moved', 'cancelled']) }).optional(),
  /**
   * The payment of a payment_due notice (the Daftra link, owner 2026-10-26): its id for the link, and its name for the sentence, so the
   * notice needs no payment row. A viewer without payment.view reads the notice as gone and sees none of it. Optional, so older notices load.
   */
  payment: z.object({ id: PaymentId, name: z.string().min(1).max(120) }).optional(),
  /**
   * Present only on a copy for an Admin who picked "Everything" (owner, 2026-10-23): the people that the original notice went to.
   * A copy sends no push and no mail. Optional, so older notices load.
   */
  forUserIds: z.array(UserId).min(1).max(200).optional(),
});
export type Notification = z.infer<typeof Notification>;

export const Event = z.object({
  id: EventId,
  seq: z.number().int().min(1),
  projectId: ProjectId.nullable(),
  actorId: UserId,
  actorKind: z.enum(['human', 'agent']),
  actingForId: UserId,
  correlationId: z.string().min(1).max(80),
  verb: z.string().min(1).max(60),
  targetType: EventTarget,
  targetId: z.string().min(1),
  before: z.unknown(),
  after: z.unknown(),
  createdAt: Stamp,
  undoneBy: EventId.nullable(),
  /**
   * For a change that Madar makes because of another change (a task that opens again, a date that moves): the change that caused it.
   * A story Undo takes it back on the right of its cause only when the cause is in the same story (audit 2026-10-03, V-2).
   * Optional, so older events load.
   */
  causeEventId: EventId.optional(),
  /** The real build: on an undo event, the event it undoes. The loader fills undoneBy from it (plan 4.3). Optional, so older events load. */
  undoes: EventId.optional(),
  /**
   * The office task of a change of an office task, of its comments or of its files (owner, 2026-10-06). Only a person who sees
   * that task reads the event. Absent on every other event.
   */
  officeTaskId: TaskId.optional(),
  /**
   * The meeting of a change of a meeting that has no project (fbk_022, owner 2026-10-19). Only the organizer and the attendees of
   * that meeting read the event, the Admin too only when invited. Absent on every other event.
   */
  officeMeetingId: MeetingId.optional(),
});
export type Event = z.infer<typeof Event>;

/** An office team, such as Design or Site, apart from the team of one project (colleague comment 15). One person may be in several teams. */
export const Team = z.object({
  id: TeamId,
  name: z.string().trim().min(1).max(60),
  /** People only: an agent acts for a person, so it never joins a team. */
  memberIds: z.array(UserId).max(100),
});
export type Team = z.infer<typeof Team>;

/**
 * A sub-company of the office group, such as Vado or Bunah (fbk_007). The Admin adds them, and each project names one. The logo is
 * picture data (PICTURE_DATA), as the profile picture: no file store holds it.
 */
export const SubCompany = z.object({
  id: SubCompanyId,
  name: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(80),
  logo: z.string().max(PICTURE_DATA_MAX).regex(PICTURE_DATA).nullable(),
  createdBy: UserId,
  createdAt: Stamp,
});
export type SubCompany = z.infer<typeof SubCompany>;

/** The kind of a meeting (fbk_022). Kind and project are two separate choices. */
export const MeetingKind = z.enum(MEETING_KINDS);
export type MeetingKind = z.infer<typeof MeetingKind>;
/** A repeat rule (wave 3). The rows of a series share it. "until" is the last day, or null for no end. */
export const MeetingRepeat = z.object({ every: z.enum(['day', 'week', 'two_weeks']), until: Day.nullable() });
export type MeetingRepeat = z.infer<typeof MeetingRepeat>;

/**
 * A meeting, a client meeting, a team meeting or a site visit (fbk_022, owner 2026-10-19). The project is optional. A meeting with
 * no project is private: only its organizer and its attendees read it, the Admin too only when invited (Q4). Stamps are in office
 * time (+03:00). A meeting starts on a multiple of 5 minutes and lasts 15 to 720 minutes. "rev" starts at 1 and grows with each
 * change of the time, the place or the status, so a calendar can tell a new copy. The fields after "rev" are set by later waves
 * (a repeat series, and the settle of a finished meeting), and stay optional so older rows load.
 */
export const Meeting = z.object({
  id: MeetingId,
  kind: MeetingKind,
  title: z.string().regex(visibleTextPattern(MEETING_LIMITS.titleMax), 'Write the title on one line, with visible characters.'),
  projectId: ProjectId.nullable(),
  startsAt: Stamp,
  endsAt: Stamp,
  /** A place, or a link that starts with https:// (the screens show a Join button). */
  where: z.string().max(MEETING_LIMITS.whereMax),
  /** People from outside, as one line of text. They get no notice. */
  guests: z.string().max(MEETING_LIMITS.guestsMax),
  notes: z.string().max(MEETING_LIMITS.notesMax),
  /** The person who made the meeting. For an agent, the person it acts for. */
  organizerId: UserId,
  /** Active people, never the organizer. */
  attendeeIds: z.array(UserId).max(MEETING_LIMITS.attendeesMax),
  /** The wave 1 form (a person for the minutes). Nothing writes or reads it since wave 2: any attendee writes the minutes (owner, 2026-10-19). */
  minutesById: UserId.nullable().optional(),
  status: z.enum(['scheduled', 'cancelled']),
  rev: z.number().int().min(1),
  seriesId: MeetingId.nullable().optional(),
  repeat: MeetingRepeat.nullable().optional(),
  /** The moment Madar marked the meeting as over (meetings.settle). Set once, and never taken back. */
  settledAt: Stamp.nullable().optional(),
  /** Unused since the owner dropped the minutes task (2026-10-19). */
  minutesTaskId: TaskId.nullable().optional(),
  /** The Tracker line that Madar made when the meeting ended (a project meeting that is not a team meeting). */
  trackerEntryId: TrackerId.nullable().optional(),
  /** The minutes of a meeting with no project, or of a team meeting. Other meetings keep them on the Tracker line. */
  minutes: MeetingMinutes.nullable().optional(),
  createdBy: UserId,
  createdAt: Stamp,
});
export type Meeting = z.infer<typeof Meeting>;

export const Settings = z.object({
  defaultStages: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  codePrefix: z.string().regex(/^[A-Z]{1,4}$/),
  workloadLimit: z.number().int().min(1).max(100),
  /** A paused project turns stale after this many days (colleague comment 16). Optional, so older offices read DEFAULT_STALE_DAYS. */
  staleAfterDays: z.number().int().min(7).max(365).optional(),
  /** The office roles and their rights (owner, 2026-10-18). Optional, so an office saved before roles reads the defaults. */
  roles: RoleSettings.optional(),
  /**
   * The office work hours and the lock (owner, 2026-10-22). Optional: a missing value means Sunday to Thursday, 9 AM to 5 PM, with the lock
   * on. Read it with officeWorkHoursOf (lib/quietHours.ts).
   */
  workHours: OfficeWorkHours.optional(),
});
export type Settings = z.infer<typeof Settings>;

