import { z } from 'zod';
import { NOTIFY_LEVELS } from './limits';
import {
  Client, Comment, ConversationId, Day, Deadline, DeadlineId, Event, EventId, EventTarget, FileId, FileRec, FileVersion, Gender, GeoPoint, HealthValue,
  MeetingId, MeetingKind, MeetingRepeat, Message, Payment, Project, ProjectTemplateId, Team,
  ProjectId, ProjectStatus, Stage, StageId, Stamp, SubCompanyId, Task, TaskId, TaskStatus, TrackerDirection, TrackerEntry, TrackerId, TrackerType, TrackerWaiting, UpdateId, UserId,
} from './entities';
import { ReportPeriodKind } from '../reportPeriod';

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

/**
 * A file that a comment, a post or a message carries. A null name means the file was deleted. "mimeType" is the type of the newest
 * version, so a screen can show a picture as a preview (owner, 2026-10-19). A deleted file has none. Optional, so older answers load.
 */
export const Attachment = z.object({ id: FileId, name: z.string().nullable(), mimeType: z.string().optional() });
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
  /** The sub-company of the project, or null (fbk_007). The list shows its logo on the tile. */
  subCompanyId: SubCompanyId.nullable(),
  /** The pin of the project on the map (owner, 2026-10-18, fbk_017): the same point as project.geo, or null. */
  geo: GeoPoint.nullable(),
  leader: UserCard.nullable(),
  team: z.array(UserCard),
  openTasks: z.number().int().min(0),
  lastActivityAt: Stamp,
  viewerRole: z.enum(['leader', 'team', 'other']),
  viewerCan: ViewerCan,
  /** The template the project came from, or null. A project made by hand has null. */
  templateId: ProjectTemplateId.nullable(),
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
  /** The project chat when the viewer may open it, else null (chat design 2026-10-19, item 18): the Project chat button needs it. */
  chatId: ConversationId.nullable().default(null),
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
    /** Joins the task as a helper with one tap: a person on the project team who neither leads nor helps (fbk_035). Optional, so older answers load. */
    help: z.boolean().optional(),
  }),
  history: z.array(EventView),
});
export type TaskDetail = z.infer<typeof TaskDetail>;

/**
 * kind (fbk_027, owner 2026-10-19): "message" is words of a person. The other kinds are quiet lines of the thread: due_date and
 * start_date (the reason of a date move), reopened (the reason of a task that opens again) and shifted (the move that Madar makes
 * when a task it waited for finished late). A line is never an instruction and never a message that waits for a reply.
 */
export const CommentLineKind = z.enum(['message', 'due_date', 'start_date', 'shifted', 'reopened']);
/**
 * The message or the comment that a reply answers (chat design item 10, owner 2026-10-19). A deleted, missing or unreadable old item
 * gives "deleted: true", an empty first line and the author of the reply, so no text and no name of another place leaves.
 * "firstLine" is the first line of the old item in plain text, at most 100 code points (200 characters).
 */
export const ReplyRef = z.object({ id: z.string(), author: UserCard, firstLine: z.string().max(200), deleted: z.boolean() });
export type ReplyRef = z.infer<typeof ReplyRef>;

export const CommentView = z.object({
  comment: Comment, author: UserCard, canEdit: z.boolean(), files: z.array(Attachment),
  // Optional with a default, so an older answer still parses.
  kind: CommentLineKind.default('message'),
  /** The comment this one answers, or null (item 10). */
  replyTo: ReplyRef.nullable().default(null),
  /** True when this comment names the reader: an @mention of the reader, or a reply to a comment of the reader (item 4). */
  namesMe: z.boolean().default(false),
});
export type CommentView = z.infer<typeof CommentView>;

/** One row of the Inbox list: a project chat, a direct chat, a group or a task thread. A task thread has the task id as its id. */
export const ChatRow = z.object({
  kind: z.enum(['project', 'direct', 'group', 'task']),
  id: z.string(),
  title: z.string(),
  project: ProjectRef.nullable(),
  person: UserCard.nullable(),
  taskId: z.string().nullable(),
  /** A group only: the person who made it. The maker alone removes people. Null for the other kinds. */
  makerId: z.string().nullable(),
  /** A group only: its first three people in the order they joined, for the pictures of the row. Empty for the other kinds. */
  members: z.array(UserCard).max(3),
  preview: z.string(),
  previewAuthor: UserCard.nullable(),
  previewMine: z.boolean(),
  /** The kind of the newest comment of a task thread, so the row shows the short line of a reason ("Faisal changed the due date: ..."). Null for a message and for a chat. */
  previewKind: CommentLineKind.exclude(['message']).nullable().default(null),
  lastAt: Stamp,
  unread: z.number().int().min(0),
  /** A direct chat whose other person left the office. It takes no new messages (audit 2026-10-03, SHL-15). */
  personLeft: z.boolean(),
  /** The person archived the chat and no message came after the archive. The list shows it under "Archived" (owner, 2026-10-18). */
  archived: z.boolean(),
});
export type ChatRow = z.infer<typeof ChatRow>;

/**
 * One row of chats.waiting (fbk_011, owner 2026-10-18): a chat or a task thread that waits for the reply of the person. The body is
 * the first 280 characters of the message in plain text, and "days" counts the whole days since that message.
 */
export const WaitingRow = z.object({
  kind: z.enum(['direct', 'group', 'project', 'task']),
  id: z.string(),
  title: z.string(),
  project: ProjectRef.nullable(),
  from: UserCard,
  body: z.string(),
  at: Stamp,
  days: z.number().int().min(0),
});
export type WaitingRow = z.infer<typeof WaitingRow>;

export const MessageView = z.object({
  message: Message,
  author: UserCard,
  /** The person an agent acted for, when it is not the author. */
  actingFor: UserCard.nullable(),
  mine: z.boolean(),
  files: z.array(Attachment),
  /** The message this one answers, or null (item 10). */
  replyTo: ReplyRef.nullable().default(null),
  /** True when this message names the reader: an @mention of the reader, or a reply to a message of the reader (item 4). */
  namesMe: z.boolean().default(false),
});
export type MessageView = z.infer<typeof MessageView>;

/** One quiet line of a group, with the people named. The screen writes the sentence in its language (UX audit 2026-10-19). */
export const GroupLine = z.object({
  id: z.string(),
  at: Stamp,
  type: z.enum(['added', 'removed', 'left', 'renamed']),
  actor: UserCard,
  people: z.array(UserCard),
  name: z.string().nullable(),
});
export type GroupLine = z.infer<typeof GroupLine>;

export const ChatThread = z.object({
  chat: ChatRow.extend({ id: ConversationId }),
  /** People the composer can mention. */
  people: z.array(UserCard),
  messages: z.array(MessageView),
  /** A group only: its quiet lines (the newest 100), oldest first. The screen puts them between the messages by time. */
  lines: z.array(GroupLine).default([]),
  /** The last read time of the reader for this chat before this read, or null (item 3: the "New" line needs the time before the open). */
  readUpTo: Stamp.nullable().default(null),
  /** The "Notify me" level of the reader for this chat (item 21). */
  notify: z.enum(NOTIFY_LEVELS).default('all'),
  /** True when newer messages exist after this page: a page that opens at one message (item 17) may end before the newest. */
  newer: z.boolean().default(false),
});
export type ChatThread = z.infer<typeof ChatThread>;

/** "canDelete" comes from the same rule as files.delete, so the screen never keeps a rule of its own (audit 2026-10-03, PRJ-16). */
export const FileView =z.object({ file: FileRec, latest: FileVersion, uploader: UserCard, canDelete: z.boolean() });
export type FileView = z.infer<typeof FileView>;

/**
 * The minutes of a meeting as a screen reads them (fbk_022, wave 2): the text, the files that the viewer may see, and who wrote them last.
 * "updatedAt" is the value that a screen sends back as "since" when it saves.
 */
export const MinutesView = z.object({ text: z.string(), files: z.array(Attachment), updatedBy: UserCard, updatedAt: Stamp });
export type MinutesView = z.infer<typeof MinutesView>;

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
  /**
   * An auto "meeting" line only (fbk_022, wave 2): the meeting, the minutes that any attendee wrote, and whether the viewer may write them.
   * Other lines leave the three out. Optional, so older answers load.
   */
  meeting: z.object({ id: MeetingId, title: z.string() }).nullable().optional(),
  minutes: MinutesView.nullable().optional(),
  canEditMinutes: z.boolean().optional(),
});
export type TrackerRow = z.infer<typeof TrackerRow>;

/**
 * One meeting in a list (fbk_022). "mine" is true when the viewer is the organizer or an attendee. A meeting with no project has
 * "project" null: the screens write "Office". The attendees are only counted here, and named in MeetingDetail.
 */
export const MeetingRow = z.object({
  id: MeetingId,
  kind: MeetingKind,
  title: z.string(),
  status: z.enum(['scheduled', 'cancelled']),
  startsAt: Stamp,
  endsAt: Stamp,
  where: z.string(),
  rev: z.number().int().min(1),
  project: ProjectRef.nullable(),
  organizer: UserCard,
  attendeeCount: z.number().int().min(0),
  mine: z.boolean(),
  seriesId: MeetingId.nullable().optional(),
  repeat: MeetingRepeat.nullable().optional(),
});
export type MeetingRow = z.infer<typeof MeetingRow>;

/**
 * One meeting with its people, its notes, its rights for the viewer, and the records that Madar made after it ended (wave 2).
 * "minutesBy" and "minutesTask" stay in the shape, always null, so an old tab parses the answer (owner, 2026-10-19: no person for the
 * minutes and no minutes task). "minutesPlace" says where the minutes live: on the Tracker line, or on the meeting itself.
 */
export const MeetingDetail = MeetingRow.extend({
  guests: z.string(),
  notes: z.string(),
  attendees: z.array(UserCard),
  minutesBy: UserCard.nullable(),
  settledAt: Stamp.nullable(),
  minutesTask: z.object({ id: TaskId, title: z.string(), status: TaskStatus, dueDate: Day.nullable() }).nullable(),
  trackerEntry: z.object({ id: TrackerId, title: z.string() }).nullable(),
  viewerCan: z.object({ edit: z.boolean(), cancel: z.boolean(), minutes: z.boolean().optional(), delete: z.boolean().optional() }),
  minutes: MinutesView.nullable().optional(),
  minutesPlace: z.enum(['tracker', 'meeting']).nullable().optional(),
});
export type MeetingDetail = z.infer<typeof MeetingDetail>;

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

/**
 * The office report of one period (owner, 2026-10-18, fbk_016). Money is in Saudi riyals. Money is null without the payment right,
 * and gaps is null without the Admin right. Each count is for the days of the period, except the states that are "at the end".
 */
const ReportCount = z.number().int().min(0);
const ReportRef = z.object({ id: ProjectId, code: z.string(), name: z.string(), mark: z.number().int().nonnegative() });
const ReportStage = z.object({ id: StageId, name: z.string() });
const ReportSubCompany = z.object({ id: SubCompanyId, name: z.string(), nameAr: z.string() });
const ReportDeadlines = z.object({ met: ReportCount, missed: ReportCount });
export const ReportProject = z.object({
  project: ReportRef,
  /** The sub-company of the project, or null (fbk_007). */
  subCompany: ReportSubCompany.nullable(),
  status: ProjectStatus,
  stageAtStart: ReportStage.nullable(),
  stageAtEnd: ReportStage.nullable(),
  health: HealthValue.nullable(),
  tasks: z.object({ done: ReportCount, made: ReportCount, pastDueAtEnd: ReportCount }),
  deadlines: ReportDeadlines,
  nextDeadline: z.object({ name: z.string(), date: Day }).nullable(),
});
export type ReportProject = z.infer<typeof ReportProject>;
export const ReportPerson = z.object({
  user: UserCard,
  tasksDone: ReportCount,
  open: ReportCount,
  pastDue: ReportCount,
  reviewsDone: ReportCount,
});
export type ReportPerson = z.infer<typeof ReportPerson>;
export const ReportMoney = z.object({ received: z.number().nonnegative(), dueInPeriod: z.number().nonnegative(), pastDueAtEnd: z.number().nonnegative() });
/**
 * The design guide of the office report (owner, 2026-10-18, fbk_016). An agent builds the document from it. The colors and sizes are
 * the light values of tokens.css. The mark is the Madar logo. The rules are short English instructions for the agent.
 */
export const ReportDesign = z.object({
  brand: z.object({
    name: z.literal('Madar'),
    nameAr: z.literal('مدار'),
    mark: z.object({ viewBox: z.literal('0 0 18 18'), path: z.string().max(400) }),
  }),
  page: z.object({ background: z.literal('#FFFFFF'), margin: z.string().max(20) }),
  colors: z.record(z.string().max(40), z.string().max(12)),
  type: z.object({
    family: z.string().max(120),
    fallback: z.string().max(160),
    sizes: z.record(z.string().max(20), z.string().max(12)),
  }),
  rules: z.array(z.string().max(240)).max(12),
});
export type ReportDesign = z.infer<typeof ReportDesign>;
export const ReportTotals = z.object({
  projects: z.object({ active: ReportCount, started: ReportCount, completed: ReportCount, paused: ReportCount }),
  tasks: z.object({ done: ReportCount, made: ReportCount, pastDueAtEnd: ReportCount }),
  deadlines: ReportDeadlines,
  submissions: ReportCount,
  stageMoves: ReportCount,
});
export type ReportTotals = z.infer<typeof ReportTotals>;
export const OfficeReport = z.object({
  period: z.object({ kind: ReportPeriodKind, from: Day, to: Day }),
  generatedAt: Stamp,
  office: z.object({ name: z.string() }),
  totals: ReportTotals,
  projects: z.array(ReportProject).max(200),
  people: z.array(ReportPerson),
  tracker: z.object({ opened: ReportCount, closed: ReportCount, waitingOnClientAtEnd: ReportCount }),
  money: ReportMoney.nullable(),
  /** The data gaps for the Admin, one short line each (English). Empty when the office has none. */
  gaps: z.array(z.string().max(120)).max(5).nullable(),
  /** The design guide for the agent that builds the document (reportDesign.ts). The same for every person who may ask. */
  design: ReportDesign,
});
export type OfficeReport = z.infer<typeof OfficeReport>;
