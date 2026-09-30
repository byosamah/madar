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
export const TimeId = id('tim');
export const NotificationId = id('ntf');
export const EventId = id('evt');

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
  'task_approved', 'task_sent_back', 'stage_changed', 'added_to_project', 'week_under_target',
] as const;
export const Trigger = z.enum(TRIGGERS);
export type Trigger = z.infer<typeof Trigger>;

export const REACTIONS = ['👍', '✅', '👀'] as const;
export const Reaction = z.enum(REACTIONS);
export type Reaction = z.infer<typeof Reaction>;

export const EventTarget = z.enum([
  'project', 'member', 'stage', 'deadline', 'task', 'update', 'comment', 'file', 'time', 'client', 'user', 'settings',
]);
export type EventTarget = z.infer<typeof EventTarget>;
export const NotificationTarget = z.enum(['project', 'task', 'update', 'week']);
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

export const User = z.object({
  id: UserId,
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  avatarUrl: z.string().max(2000).nullable(),
  kind: z.enum(['human', 'agent']),
  systemRole: z.enum(['admin', 'member']),
  discipline: z.string().trim().min(1).max(40),
  weeklyHourTarget: z.number().min(0).max(80),
  active: z.boolean(),
  // For an agent: the person it acts for (spec 17). For a person: null.
  ownerId: UserId.nullable(),
  preferences: Preferences,
});
export type User = z.infer<typeof User>;

export const Client = z.object({
  id: ClientId,
  name: z.string().trim().min(1).max(120),
  contactName: z.string().max(80),
  phone: z.string().max(40),
  email: z.union([z.email(), z.literal('')]),
});
export type Client = z.infer<typeof Client>;

export const HealthOverride = z.object({
  value: HealthValue,
  reason: z.string().trim().min(1).max(280),
  setBy: UserId,
  setAt: Stamp,
});
export type HealthOverride = z.infer<typeof HealthOverride>;

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

export const Task = z.object({
  id: TaskId,
  projectId: ProjectId,
  stageId: StageId,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  ownerId: UserId,
  status: TaskStatus,
  dueDate: Day.nullable(),
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

export const Comment = z.object({
  id: CommentId,
  targetType: z.enum(['task', 'update']),
  targetId: z.union([TaskId, UpdateId]),
  authorId: UserId,
  body: z.string().trim().min(1).max(5000),
  reactions: z.record(Reaction, z.array(UserId)),
  createdAt: Stamp,
  editedAt: Stamp.nullable(),
});
export type Comment = z.infer<typeof Comment>;

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

export const TimeEntry = z.object({
  id: TimeId,
  userId: UserId,
  projectId: ProjectId,
  stageId: StageId,
  taskId: TaskId.nullable(),
  date: Day,
  hours: z.number().min(0.5).max(24).multipleOf(0.5),
});
export type TimeEntry = z.infer<typeof TimeEntry>;

export const TimeRow = z.object({
  key: z.string().min(1),
  userId: UserId,
  weekStart: Day,
  projectId: ProjectId,
  stageId: StageId,
  taskId: TaskId.nullable(),
});
export type TimeRow = z.infer<typeof TimeRow>;

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

export const WeekUnlock = z.object({ userId: UserId, weekStart: Day });
export type WeekUnlock = z.infer<typeof WeekUnlock>;
