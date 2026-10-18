import { z } from 'zod';
import {
  Client, Comment, ConversationId, Day, Deadline, DeadlineId, Event, EventId, EventTarget, FileId, FileRec, FileVersion, Gender, HealthValue,
  Message, Payment, Project, Team,
  ProjectId, Stage, StageId, Stamp, Task, TaskId, TaskStatus, TrackerDirection, TrackerEntry, TrackerType, TrackerWaiting, UpdateId, UserId,
} from './entities';

export const UserCard = z.object({
  id: UserId,
  /** The English name. */
  name: z.string(),
  /** The Arabic name, when the person has one (owner item 12, 2026-10-05). The screens show the name of their language. */
  nameAr: z.string().optional(),
  /** An https picture only. Picture data stays out of the card, so long lists stay small: the screens read it from users.list. */
  avatarUrl: z.string().nullable(),
  kind: z.enum(['human', 'agent']),
  discipline: z.string(),
  gender: Gender.optional(),
});
export type UserCard = z.infer<typeof UserCard>;

export const HealthResult = z.object({
  value: HealthValue,
  computed: HealthValue,
  overridden: z.boolean(),
  reason: z.string().nullable(),
  setBy: UserId.nullable(),
});

/** A file that a comment, a post or a message carries. A null name means the file was deleted. */
export const Attachment = z.object({ id: FileId, name: z.string().nullable() });
export type Attachment = z.infer<typeof Attachment>;

export const FeedItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('update'), id: UpdateId, at: Stamp, author: UserCard, body: z.string(), fileIds: z.array(FileId),
    // The files with their names, as comments carry them, so a post can open its files (audit 2026-10-03, PRJ-6).
    attachments: z.array(Attachment),
    editedAt: Stamp.nullable(), commentCount: z.number().int().min(0), canEdit: z.boolean(), decision: z.literal(true).optional(),
  }),
  z.object({
    kind: z.literal('event'), id: EventId, at: Stamp, author: UserCard, verb: z.string(), targetType: EventTarget,
    targetId: z.string(), label: z.string(), detail: z.record(z.string(), z.string()), canUndo: z.boolean(),
  }),
]);
export type FeedItem = z.infer<typeof FeedItem>;

/** A project named in another view, with its picture mark. */
export const ProjectRef = z.object({ id: ProjectId, code: z.string(), name: z.string(), mark: z.number().int().nonnegative() });
export type ProjectRef = z.infer<typeof ProjectRef>;

export const NextDeadline = z.object({ id: DeadlineId, name: z.string(), date: Day, daysLeft: z.number().int() });

export const DeadlineRow = z.object({
  deadline: Deadline,
  project: ProjectRef,
  daysLeft: z.number().int(),
});
export type DeadlineRow = z.infer<typeof DeadlineRow>;

export const ViewerCan = z.object({
  edit: z.boolean(), changeLeader: z.boolean(), archive: z.boolean(), delete: z.boolean(), healthOverride: z.boolean(),
  createTaskForAnyone: z.boolean(), createTaskForSelf: z.boolean(), post: z.boolean(), review: z.boolean(),
  /** The viewer may read and change the payments of every project. */
  payments: z.boolean(),
  /** The viewer may correct the project code: the Admin only (owner, 2026-10-05). Optional, so older answers still parse. */
  editCode: z.boolean().optional(),
});

export const ProjectSummary = z.object({
  project: Project,
  client: Client.nullable(),
  health: HealthResult.nullable(),
  healthSetBy: UserCard.nullable(),
  /** The person who paused the project, while it is paused. */
  pausedBy: UserCard.nullable(),
  /** The days a paused project has waited, once that is longer than the office's limit (colleague comment 16). Else null. */
  staleDays: z.number().int().nullable(),
  coverLetter: z.string().nullable(),
  stages: z.array(Stage),
  currentStage: Stage,
  latest: z.array(FeedItem).max(2),
  nextDeadline: NextDeadline.nullable(),
  /**
   * When the current stage of an active project ends: the date that the Late tag reads. A list shows it while the project has no
   * named deadline (feedback fbk_004, 2026-10-11). Null with no end date or with a project that is not active. Optional, so older
   * answers still parse.
   */
  stageEnd: z.object({ date: Day, daysLeft: z.number().int() }).nullable().optional(),
  leader: UserCard.nullable(),
  team: z.array(UserCard),
  openTasks: z.number().int().min(0),
  lastActivityAt: Stamp,
  viewerRole: z.enum(['leader', 'team', 'other']),
  viewerCan: ViewerCan,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

/** An office team as a screen reads it: the people who are active, as cards. */
export const TeamRow = Team.extend({ members: z.array(UserCard) });
export type TeamRow = z.infer<typeof TeamRow>;

export const ProjectDetail = ProjectSummary.extend({
  members: z.array(z.object({
    user: UserCard, discipline: z.string(), isLeader: z.boolean(), openTasks: z.number().int().min(0),
    /** False for a person who is no longer active. The API refuses that person for a task or a reply, so pick lists leave them out (audit 2026-10-03, V-4a). */
    active: z.boolean(),
  })),
  deadlines: z.array(Deadline),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

export const EventView = z.object({ event: Event, actor: UserCard });
export type EventView = z.infer<typeof EventView>;

/** An event with the words the Activity feed uses for it: the name of the thing it changed, and the detail of the change. */
export const EventLineView = EventView.extend({ label: z.string(), detail: z.record(z.string(), z.string()) });
export type EventLineView = z.infer<typeof EventLineView>;

export const TaskRow = z.object({
  task: Task,
  /** The lead, or null for a task with no lead. */
  owner: UserCard.nullable(),
  /** The helpers beside the lead, in the order they were added. */
  helpers: z.array(UserCard),
  /** Null for an office task, which belongs to no project (owner, 2026-10-06). */
  project: ProjectRef.nullable(),
  /** Null for an office task. */
  stage: z.object({ id: StageId, name: z.string() }).nullable(),
  commentCount: z.number().int().min(0),
  fileCount: z.number().int().min(0),
  overdue: z.boolean(),
  canMove: z.boolean(),
  /**
   * The viewer may change the lead and the helpers of this task: the same rule as `viewerCan.editAll` of the task panel. The avatar
   * of the row opens its small pop-up only then (feedback fbk_006, 2026-10-11). Optional, so older answers still parse.
   */
  canEditPeople: z.boolean().optional(),
  /** What an open task waits for: the tasks it needs and the stages its stage needs, while they are not done. Empty for a done task. */
  waitingFor: z.object({
    tasks: z.array(z.object({ id: TaskId, title: z.string() })),
    stages: z.array(z.object({ id: StageId, name: z.string() })),
  }),
});
export type TaskRow = z.infer<typeof TaskRow>;

/** A task named inside another task's panel. */
export const TaskLink = z.object({ id: TaskId, title: z.string(), status: TaskStatus });
export type TaskLink = z.infer<typeof TaskLink>;

export const TaskDetail = TaskRow.extend({
  /** "Needs first": the tasks that must be done before this one, with their state. */
  needsFirst: z.array(TaskLink),
  /** "Unlocks": the tasks that need this one first. Read only. */
  unlocks: z.array(TaskLink),
  viewerCan: z.object({
    edit: z.boolean(), editAll: z.boolean(), complete: z.boolean(), review: z.boolean(), delete: z.boolean(),
    /** Turns the review need on or off: the leader and the Admin, or the maker of an office task (owner, 2026-10-07). */
    setNeedsReview: z.boolean(),
    /** Ticks checklist items: the lead, a helper, the leader and the Admin. */
    contribute: z.boolean(),
    /** Opens a new version: the lead, the leader and the Admin, on a done task. */
    newVersion: z.boolean(),
    /** Saves the task as a template: the leader and the Admin, never the maker alone. */
    saveTemplate: z.boolean(),
    /** Takes the lead of an open task with no lead: a person on the project team (owner, 2026-10-05). */
    take: z.boolean(),
  }),
  history: z.array(EventView),
});
export type TaskDetail = z.infer<typeof TaskDetail>;

export const CommentView = z.object({ comment: Comment, author: UserCard, canEdit: z.boolean(), files: z.array(Attachment) });
export type CommentView = z.infer<typeof CommentView>;

/** One row of the Inbox list: a project chat, a direct chat or a task thread. A task thread has the task id as its id. */
export const ChatRow = z.object({
  kind: z.enum(['project', 'direct', 'task']),
  id: z.string(),
  title: z.string(),
  project: ProjectRef.nullable(),
  person: UserCard.nullable(),
  taskId: z.string().nullable(),
  preview: z.string(),
  previewAuthor: UserCard.nullable(),
  previewMine: z.boolean(),
  lastAt: Stamp,
  unread: z.number().int().min(0),
  /** A direct chat whose other person left the office. It takes no new messages (audit 2026-10-03, SHL-15). */
  personLeft: z.boolean(),
  /** The person archived the chat and no message came after the archive. The list shows it under "Archived" (owner, 2026-10-18). */
  archived: z.boolean(),
});
export type ChatRow = z.infer<typeof ChatRow>;

export const MessageView = z.object({
  message: Message,
  author: UserCard,
  /** The person an agent acted for, when it is not the author. */
  actingFor: UserCard.nullable(),
  mine: z.boolean(),
  files: z.array(Attachment),
});
export type MessageView = z.infer<typeof MessageView>;

export const ChatThread = z.object({
  chat: ChatRow.extend({ id: ConversationId }),
  /** People the composer can mention. */
  people: z.array(UserCard),
  messages: z.array(MessageView),
});
export type ChatThread = z.infer<typeof ChatThread>;

/** "canDelete" comes from the same rule as files.delete, so the screen never keeps a rule of its own (audit 2026-10-03, PRJ-16). */
export const FileView =z.object({ file: FileRec, latest: FileVersion, uploader: UserCard, canDelete: z.boolean() });
export type FileView = z.infer<typeof FileView>;

/** One tracker entry as a screen reads it, with the people and files named and the rights of the viewer. */
export const TrackerRow = z.object({
  entry: TrackerEntry,
  createdBy: UserCard,
  closedBy: UserCard.nullable(),
  people: z.array(UserCard),
  files: z.array(Attachment),
  /** The reply task of the entry, or null when it has none (or the task was deleted). The title lets the sheet name it (audit 2026-10-03, F-11). */
  replyTask: z.object({ id: TaskId, title: z.string(), status: TaskStatus, dueDate: Day.nullable(), owner: UserCard.nullable() }).nullable(),
  canClose: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});
export type TrackerRow = z.infer<typeof TrackerRow>;

/** The kinds of line in the Tracker export. "closed" reads "Answered" or "Received" by the "waiting" value of the entry. */
export const TRACKER_EXPORT_EVENTS = ['logged', 'edited', 'closed', 'reopened', 'deleted', 'reply_task', 'reply_logged'] as const;

/** One line of the Tracker export: one event on one entry, with the exact office time. The screen builds the CSV and its headers. */
export const TrackerExportRow = z.object({
  date: Day,
  /** HH:MM:SS in office time (Asia/Riyadh). */
  time: z.string(),
  event: z.enum(TRACKER_EXPORT_EVENTS),
  waiting: TrackerWaiting.nullable(),
  /** The person. For an agent it is the person the agent acts for, and "byAgent" is true. */
  by: z.string(),
  /** The Arabic name of the same person, when there is one (owner item 12, 2026-10-05). */
  byAr: z.string().optional(),
  byAgent: z.boolean(),
  type: TrackerType,
  direction: TrackerDirection,
  title: z.string(),
  note: z.string(),
  files: z.array(z.string()),
  auto: TrackerEntry.shape.auto,
});
export type TrackerExportRow = z.infer<typeof TrackerExportRow>;

/** One payment milestone as a screen reads it. "dueInDays" is negative after the due date. */
export const PaymentRow = z.object({
  payment: Payment,
  status: z.enum(['received', 'awaiting', 'overdue']),
  dueInDays: z.number().int(),
  createdBy: UserCard,
});
export type PaymentRow = z.infer<typeof PaymentRow>;
