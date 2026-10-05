import { z } from 'zod';
import { INITIALS_PATTERN, PROJECT_CODE_PATTERN } from '../../lib/projectCode';

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
export const NotificationId = id('ntf');
export const EventId = id('evt');
export const ConversationId = id('cnv');
export const MessageId = id('msg');
export const StageTemplateId = id('stt');
export const TaskTemplateId = id('ttp');
export const TrackerId = id('trk');
export const PaymentId = id('pay');
export const TeamId = id('tm');

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
export const TRIGGERS = [
  'task_assigned', 'mention', 'due_tomorrow', 'overdue', 'review_requested',
  'task_approved', 'task_sent_back', 'stage_changed', 'added_to_project', 'resume_due',
] as const;
export const Trigger = z.enum(TRIGGERS);
export type Trigger = z.infer<typeof Trigger>;

export const REACTIONS = ['👍', '✅', '👀'] as const;
export const Reaction = z.enum(REACTIONS);
export type Reaction = z.infer<typeof Reaction>;

export const EventTarget = z.enum([
  'project', 'member', 'stage', 'deadline', 'task', 'update', 'comment', 'file', 'client', 'user', 'settings', 'stageTemplate', 'taskTemplate', 'tracker', 'payment', 'feedback', 'team',
]);
export type EventTarget = z.infer<typeof EventTarget>;
export const NotificationTarget = z.enum(['project', 'task', 'update', 'chat']);
export type NotificationTarget = z.infer<typeof NotificationTarget>;

export const Preferences = z.object({
  language: Language,
  theme: Theme,
  glass: Glass,
  notifications: z.record(Trigger, z.boolean()),
  /** The real build: email switches by trigger. A missing trigger takes its default (spec 2, section 10). */
  email: z.partialRecord(Trigger, z.boolean()).optional(),
  /** The real build: the morning summary email. A missing value means on. */
  morningSummary: z.boolean().optional(),
  /** The hatch over the days that two stages share, on every schedule. A missing value means on (owner, 2026-10-05, item 9). */
  hatchOverlap: z.boolean().optional(),
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

export const User = z.object({
  id: UserId,
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  avatarUrl: z.string().max(2000).nullable(),
  kind: z.enum(['human', 'agent']),
  systemRole: SystemRole,
  discipline: z.string().trim().min(1).max(40),
  active: z.boolean(),
  // For an agent: the person it acts for (spec 17). For a person: null.
  ownerId: UserId.nullable(),
  preferences: Preferences,
  // For Arabic grammar only: a verb after a person's name agrees with it. Unset reads as masculine.
  gender: Gender.optional(),
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

/** A project code of the old or the new form. */
export const ProjectCode = z.string().regex(PROJECT_CODE_PATTERN, 'Use a code like 260902AZT-RES-Villa.');

export const Project = z.object({
  id: ProjectId,
  /** The old form KH-26-014, or the new form YYMMSSINI-CLS-Type (owner, 2026-10-05, lib/projectCode.ts). Two projects of one contract share one code. */
  code: ProjectCode,
  name: z.string().trim().min(1).max(120),
  clientId: ClientId.nullable(),
  status: ProjectStatus,
  leaderId: UserId.nullable(),
  currentStageId: StageId,
  location: z.string().max(120),
  areaM2: z.number().nonnegative().nullable(),
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
  stageBack: StageBack.nullable().optional(),
  /** The day the client's contract starts (colleague comment 7, 2026-10-01). Optional, so older offices still load. */
  contractStartDate: Day.nullable().optional(),
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

/** The most prerequisites one task or one stage has. */
export const MAX_PREREQUISITES = 20;

export const Stage = z.object({
  id: StageId,
  projectId: ProjectId,
  name: z.string().trim().min(1).max(60),
  order: z.number().int().min(0),
  startDate: Day.nullable(),
  endDate: Day.nullable(),
  /** Stages of the same project that need to be finished first. Optional, so older offices still load. */
  prerequisiteIds: z.array(StageId).max(MAX_PREREQUISITES).optional(),
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

/** The most helpers one task has. */
export const MAX_HELPERS = 10;

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
  projectId: ProjectId,
  stageId: StageId,
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
  /** The automatic date moves of a dynamic task, oldest first (the last 20). */
  dateNotes: z.array(DateNote).max(20).optional(),
  createdBy: UserId,
  createdAt: Stamp,
  completedAt: Stamp.nullable(),
  /** The Tracker entry this task answers (a reply task). Null after that entry is deleted. */
  trackerEntryId: TrackerId.nullable().optional(),
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

/** The most files one comment or one chat message carries. */
export const MAX_ATTACHMENTS = 10;

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
  createdAt: Stamp,
  editedAt: Stamp.nullable(),
});
export type Comment = z.infer<typeof Comment>;

/** A chat room. A project chat has no member list: its people are the project team and the Admin. A direct chat has exactly two. */
export const Conversation = z.object({
  id: ConversationId,
  kind: z.enum(['project', 'direct']),
  projectId: ProjectId.nullable(),
  memberIds: z.array(UserId).max(2),
  createdAt: Stamp,
});
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
  createdAt: Stamp,
  editedAt: Stamp.nullable(),
});
export type Message = z.infer<typeof Message>;

/** When a person last read a conversation. */
/** One read mark. The conversation is a chat, or a task whose comments the Inbox shows as a thread (audit 2026-10-03, SHL-5). */
export const ChatRead = z.object({ conversationId: z.union([ConversationId, TaskId]), userId: UserId, lastReadAt: Stamp });
export type ChatRead = z.infer<typeof ChatRead>;

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
 * One exchange with the client: a meeting, a message, a file or a Balady permit-portal update (owner, 2026-10-01).
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
  auto: z.enum(['upload', 'delivered', 'version', 'reply', 'shift']).nullable(),
  createdBy: UserId,
  createdAt: Stamp,
  /**
   * The task of the person who answers a "waiting for our reply" entry. Optional, so an office saved before replies still loads.
   * Null when the entry stopped waiting while its reply task could not finish yet (audit 2026-10-03, V-13).
   */
  replyTaskId: TaskId.nullable().optional(),
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

/** The absolute ceiling for one file (spec 2, section 8). The active file store of the real build can set a lower limit (plan 2b, point 1). */
export const MAX_FILE_BYTES = 250 * 1024 * 1024;

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
  projectId: ProjectId,
  stageId: StageId.nullable(),
  taskId: TaskId.nullable(),
  name: z.string().trim().min(1).max(200),
  versions: z.array(FileVersion).min(1),
});
export type FileRec = z.infer<typeof FileRec>;

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

export const DEFAULT_STALE_DAYS = 30;

export const Settings = z.object({
  defaultStages: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  codePrefix: z.string().regex(/^[A-Z]{1,4}$/),
  workloadLimit: z.number().int().min(1).max(100),
  /** A paused project turns stale after this many days (colleague comment 16). Optional, so older offices read DEFAULT_STALE_DAYS. */
  staleAfterDays: z.number().int().min(7).max(365).optional(),
});
export type Settings = z.infer<typeof Settings>;

