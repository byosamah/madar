import { z } from 'zod';
import {
  Client, Comment, ConversationId, Day, Deadline, DeadlineId, Event, EventId, EventTarget, FileId, FileRec, FileVersion, Gender, HealthValue,
  Message, Project,
  ProjectId, Stage, StageId, Stamp, Task, TrackerEntry, UpdateId, UserId,
} from './entities';

export const UserCard = z.object({
  id: UserId,
  name: z.string(),
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

export const FeedItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('update'), id: UpdateId, at: Stamp, author: UserCard, body: z.string(), fileIds: z.array(FileId),
    editedAt: Stamp.nullable(), commentCount: z.number().int().min(0), canEdit: z.boolean(),
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
});

export const ProjectSummary = z.object({
  project: Project,
  client: Client.nullable(),
  health: HealthResult.nullable(),
  healthSetBy: UserCard.nullable(),
  /** The person who paused the project, while it is paused. */
  pausedBy: UserCard.nullable(),
  coverLetter: z.string().nullable(),
  stages: z.array(Stage),
  currentStage: Stage,
  latest: z.array(FeedItem).max(2),
  nextDeadline: NextDeadline.nullable(),
  leader: UserCard.nullable(),
  team: z.array(UserCard),
  openTasks: z.number().int().min(0),
  lastActivityAt: Stamp,
  viewerRole: z.enum(['leader', 'team', 'other']),
  viewerCan: ViewerCan,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectDetail = ProjectSummary.extend({
  members: z.array(z.object({
    user: UserCard, discipline: z.string(), isLeader: z.boolean(), openTasks: z.number().int().min(0),
  })),
  deadlines: z.array(Deadline),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

export const EventView = z.object({ event: Event, actor: UserCard });
export type EventView = z.infer<typeof EventView>;

export const TaskRow = z.object({
  task: Task,
  owner: UserCard,
  project: ProjectRef,
  stage: z.object({ id: StageId, name: z.string() }),
  commentCount: z.number().int().min(0),
  fileCount: z.number().int().min(0),
  overdue: z.boolean(),
  canMove: z.boolean(),
});
export type TaskRow = z.infer<typeof TaskRow>;

export const TaskDetail = TaskRow.extend({
  viewerCan: z.object({ edit: z.boolean(), editAll: z.boolean(), complete: z.boolean(), review: z.boolean(), delete: z.boolean() }),
  history: z.array(EventView),
});
export type TaskDetail = z.infer<typeof TaskDetail>;

/** A file that a comment or a message carries. A null name means the file was deleted. */
export const Attachment = z.object({ id: FileId, name: z.string().nullable() });
export type Attachment = z.infer<typeof Attachment>;

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

export const FileView =z.object({ file: FileRec, latest: FileVersion, uploader: UserCard });
export type FileView = z.infer<typeof FileView>;

/** One tracker entry as a screen reads it, with the people and files named and the rights of the viewer. */
export const TrackerRow = z.object({
  entry: TrackerEntry,
  createdBy: UserCard,
  closedBy: UserCard.nullable(),
  people: z.array(UserCard),
  files: z.array(Attachment),
  canClose: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});
export type TrackerRow = z.infer<typeof TrackerRow>;
