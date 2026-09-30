import { z } from 'zod';
import {
  Client, Day, Deadline, DeadlineId, EventId, EventTarget, FileId, HealthValue, Project, Stage, Stamp, UpdateId, UserId,
} from './entities';

export const UserCard = z.object({
  id: UserId,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  kind: z.enum(['human', 'agent']),
  discipline: z.string(),
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
    editedAt: Stamp.nullable(), commentCount: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('event'), id: EventId, at: Stamp, author: UserCard, verb: z.string(), targetType: EventTarget,
    targetId: z.string(), label: z.string(), detail: z.record(z.string(), z.string()),
  }),
]);
export type FeedItem = z.infer<typeof FeedItem>;

export const NextDeadline = z.object({ id: DeadlineId, name: z.string(), date: Day, daysLeft: z.number().int() });

export const ProjectSummary = z.object({
  project: Project,
  client: Client.nullable(),
  health: HealthResult.nullable(),
  stages: z.array(Stage),
  currentStage: Stage,
  latest: z.array(FeedItem).max(2),
  nextDeadline: NextDeadline.nullable(),
  leader: UserCard.nullable(),
  team: z.array(UserCard),
  openTasks: z.number().int().min(0),
  lastActivityAt: Stamp,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ViewerCan = z.object({
  edit: z.boolean(), changeLeader: z.boolean(), archive: z.boolean(), delete: z.boolean(), healthOverride: z.boolean(),
  createTaskForAnyone: z.boolean(), createTaskForSelf: z.boolean(), post: z.boolean(), review: z.boolean(), logTime: z.boolean(),
});

export const ProjectDetail = ProjectSummary.extend({
  members: z.array(z.object({ user: UserCard, discipline: z.string(), isLeader: z.boolean(), openTasks: z.number().int().min(0) })),
  deadlines: z.array(Deadline),
  viewerRole: z.enum(['leader', 'team', 'other']),
  viewerCan: ViewerCan,
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;
