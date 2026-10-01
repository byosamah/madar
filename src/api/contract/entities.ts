import { z } from 'zod';

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
export const TrackerId = id('trk');

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

export const TRIGGERS = [
  'task_assigned', 'mention', 'due_tomorrow', 'overdue', 'review_requested',
  'task_approved', 'task_sent_back', 'stage_changed', 'added_to_project',
] as const;
export const Trigger = z.enum(TRIGGERS);
export type Trigger = z.infer<typeof Trigger>;

export const REACTIONS = ['👍', '✅', '👀'] as const;
export const Reaction = z.enum(REACTIONS);
export type Reaction = z.infer<typeof Reaction>;

export const EventTarget = z.enum([
  'project', 'member', 'stage', 'deadline', 'task', 'update', 'comment', 'file', 'client', 'user', 'settings', 'stageTemplate', 'tracker',
]);
export type EventTarget = z.infer<typeof EventTarget>;
export const NotificationTarget = z.enum(['project', 'task', 'update', 'chat']);
export type NotificationTarget = z.infer<typeof NotificationTarget>;

export const Preferences = z.object({
  language: Language,
  theme: Theme,
  glass: Glass,
  notifications: z.record(Trigger, z.boolean()),
});
export type Preferences = z.infer<typeof Preferences>;

export function defaultPreferences(): Preferences {
  const notifications = Object.fromEntries(TRIGGERS.map((trigger) => [trigger, true])) as Record<Trigger, boolean>;
  return { language: 'en', theme: 'system', glass: 'frosted', notifications };
}

export const Gender = z.enum(['female', 'male']);
export type Gender = z.infer<typeof Gender>;

export const User = z.object({
  id: UserId,
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  avatarUrl: z.string().max(2000).nullable(),
  kind: z.enum(['human', 'agent']),
  systemRole: z.enum(['admin', 'member']),
  discipline: z.string().trim().min(1).max(40),
  active: z.boolean(),
  // For an agent: the person it acts for (spec 17). For a person: null.
  ownerId: UserId.nullable(),
  preferences: Preferences,
  // For Arabic grammar only: a verb after a person's name agrees with it. Unset reads as masculine.
  gender: Gender.optional(),
});
export type User = z.infer<typeof User>;

export const Client = z.object({
  id: ClientId,
  /** The English name. A client may have only an Arabic name, so either one may be empty, never both (colleague comment 11). */
  name: z.string().trim().max(120),
  /** Optional, so offices saved before Arabic names existed still load. */
  nameAr: z.string().trim().max(120).optional(),
  contactName: z.string().max(80),
  phone: z.string().max(40),
  email: z.union([z.email(), z.literal('')]),
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

/** Why and until when a leader paused a project (owner, 2026-10-01). The project status is on_hold while it is set. */
export const ProjectPause = z.object({ reason: z.string().trim().min(1).max(280), resumeOn: Day.nullable(), by: UserId, at: Stamp });
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

export const Project = z.object({
  id: ProjectId,
  code: z.string().regex(/^[A-Z]{1,4}-\d{2}-\d{3,}$/),
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

export const Task = z.object({
  id: TaskId,
  projectId: ProjectId,
  stageId: StageId,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  ownerId: UserId,
  status: TaskStatus,
  dueDate: Day.nullable(),
  // Optional, so an office saved before start dates still loads: missing means no start, static, no duration.
  startDate: Day.nullable().optional(),
  schedule: TaskSchedule.optional(),
  durationDays: DurationDays.nullable().optional(),
  flagged: z.boolean(),
  needsReview: z.boolean(),
  checklist: z.array(ChecklistItem).max(100),
  createdBy: UserId,
  createdAt: Stamp,
  completedAt: Stamp.nullable(),
});
export type Task = z.infer<typeof Task>;

export const Update = z.object({
  id: UpdateId,
  projectId: ProjectId,
  authorId: UserId,
  body: z.string().trim().min(1).max(5000),
  fileIds: z.array(FileId).max(20),
  createdAt: Stamp,
  editedAt: Stamp.nullable(),
});
export type Update = z.infer<typeof Update>;

export function emptyReactions(): Record<Reaction, string[]> {
  return { '👍': [], '✅': [], '👀': [] };
}

/** The most files one comment or one chat message carries. */
export const MAX_ATTACHMENTS = 10;

export const Comment = z.object({
  id: CommentId,
  targetType: z.enum(['task', 'update']),
  targetId: z.union([TaskId, UpdateId]),
  authorId: UserId,
  body: z.string().trim().min(1).max(5000),
  reactions: z.record(Reaction, z.array(UserId)),
  // Older saved comments have no list. A missing list means no files.
  fileIds: z.array(FileId).max(MAX_ATTACHMENTS).optional(),
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
export const ChatRead = z.object({ conversationId: ConversationId, userId: UserId, lastReadAt: Stamp });
export type ChatRead = z.infer<typeof ChatRead>;

export const TRACKER_TYPES = ['meeting', 'message', 'file', 'balady'] as const;
export const TrackerType = z.enum(TRACKER_TYPES);
export type TrackerType = z.infer<typeof TrackerType>;
/** "in" is from the client to the office. "out" is from the office to the client. */
export const TrackerDirection = z.enum(['in', 'out']);
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
  auto: z.enum(['upload', 'delivered']).nullable(),
  createdBy: UserId,
  createdAt: Stamp,
});
export type TrackerEntry = z.infer<typeof TrackerEntry>;

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const FileVersion = z.object({
  letter: z.string().regex(/^[A-Z]+$/),
  blobKey: z.string().min(1),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().min(0).max(MAX_FILE_BYTES),
  uploadedBy: UserId,
  uploadedAt: Stamp,
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
});
export type Event = z.infer<typeof Event>;

export const Settings = z.object({
  defaultStages: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  codePrefix: z.string().regex(/^[A-Z]{1,4}$/),
  workloadLimit: z.number().int().min(1).max(100),
});
export type Settings = z.infer<typeof Settings>;

