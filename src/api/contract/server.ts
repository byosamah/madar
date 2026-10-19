import { z } from 'zod';
import { ConversationId, FileId, ProjectId, StageId, TaskId, UserId } from './entities';
import { MAX_SHOT_BYTES, PASSWORD_SET_MARK } from './limits';

// The plain limits live in limits.ts, with no zod, for the screens of the first load (performance audit BND-6).
export { MAX_SHOT_BYTES, PASSWORD_SET_MARK };

/**
 * The 15 calls that only the real build has (plan 4.11; usage.retryEffect from task M1, plan 4.12; live.ticket from the exit,
 * wave 3; the four google calls of fbk_022). They carry the work that State cannot hold: story IDs, file links, invitations, agents,
 * usage, the ticket of the live socket and the Google Calendar connect. The server runs its own versions; src/api/handlers/serverFakes.ts gives the prototype fake ones. The MCP tool list
 * (track G) reads these contracts, not the server code.
 */
export const SERVER_CALL_NAMES = [
  'story.start', 'files.uploadStart', 'files.link', 'feedback.uploadStart', 'users.invites', 'users.resendInvite', 'agents.list', 'agents.remove', 'usage.get',
  'usage.retryEffect', 'live.ticket', 'google.status', 'google.connectStart', 'google.connect', 'google.disconnect',
] as const;
export type ServerCallName = (typeof SERVER_CALL_NAMES)[number];

/** The reasons the server gives in details.reason. The screens have a text for each one (errors.reasons.<reason>). */
export const SERVER_REASONS = ['account_off', 'client_outdated', 'busy', 'story_not_yours', 'key_reused', 'too_many_overviews'] as const;
export type ServerReason = (typeof SERVER_REASONS)[number];

/** A signed upload link lives 10 minutes (plan 5.2). */
export const UPLOAD_LIFE_MS = 10 * 60 * 1000;
/**
 * The free plan limits of the usage meters (plan 5.8). Files use the 1 GB of Supabase Storage. On R2 the server gives 10 GB
 * (FILE_STORE_LIMITS, server/core/ports.ts), and the Usage screen tells the two apart by it (plan 2b, point 1).
 */
export const FREE_PLAN_LIMITS = {
  calls: 500_000,
  databaseBytes: 500 * 1024 * 1024,
  filesBytes: 1024 * 1024 * 1024,
  backupCopyBytes: 10 * 1024 * 1024 * 1024,
  emailsPerDay: 100,
  emailsPerMonth: 3_000,
  egressBytes: 5 * 1024 * 1024 * 1024,
} as const;

/**
 * A signed upload: the browser sends the file with this method, URL and headers. The headers always hold Content-Type;
 * a file store can add its own (Supabase Storage or R2, plan 2b, point 1).
 */
export const SignedPut = z.object({
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).refine((headers) => typeof headers['Content-Type'] === 'string', 'The upload needs a Content-Type header.'),
  expiresAt: z.string().min(1),
});
export type SignedPut = z.infer<typeof SignedPut>;

const MimeType = z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i, 'The file type is not valid.');
const ImageType = z.string().max(100).regex(/^image\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i, 'A screenshot must be a picture.');
const UploadId = z.string().min(1).max(80);
const Empty = z.object({});
const Meter = z.object({ used: z.number().min(0), limit: z.number().positive() });

const storyStart = {
  input: Empty,
  output: z.object({ storyId: z.string().min(1).max(80) }),
  readOnly: false,
};

const filesUploadStart = {
  input: z.object({
    /** None: a file of the office task taskId (owner, 2026-10-06), or of the direct chat or group conversationId (owner, 2026-10-19). */
    projectId: ProjectId.optional(),
    /** A direct chat or a group. The file stays in that chat: no project, no stage, no task. */
    conversationId: ConversationId.optional(),
    name: z.string().trim().min(1).max(200),
    /** The size is checked against the limit of the active file store, with the reason file_too_large and the limit in details. */
    size: z.number().int().min(0),
    mimeType: MimeType,
    stageId: StageId.nullable().optional(),
    taskId: TaskId.nullable().optional(),
    /** The small picture of an image (960 px WebP, or JPEG where the browser cannot write WebP), made in the browser. */
    thumb: z.object({ size: z.number().int().min(1).max(MAX_SHOT_BYTES), mimeType: ImageType }).optional(),
  }),
  output: z.object({ uploadId: UploadId, put: SignedPut, thumbPut: SignedPut.optional() }),
  readOnly: false,
};

const filesLink = {
  input: z.object({
    id: FileId,
    letter: z.string().regex(/^[A-Z]+$/).optional(),
    variant: z.enum(['full', 'thumb']),
    disposition: z.enum(['inline', 'attachment']),
  }),
  output: z.object({ url: z.string().min(1), expiresAt: z.string().min(1), name: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().min(0) }),
  readOnly: true,
};

const feedbackUploadStart = {
  input: z.object({
    screenshots: z.array(z.object({ size: z.number().int().min(1).max(MAX_SHOT_BYTES, 'Each screenshot must be 10 MB or smaller.'), mimeType: ImageType }))
      .min(1).max(3, 'Add up to three screenshots.'),
  }),
  output: z.object({ uploads: z.array(z.object({ uploadId: UploadId, put: SignedPut })) }),
  readOnly: false,
};

const usersInvites = {
  input: Empty,
  output: z.array(z.object({ userId: UserId, state: z.enum(['invited', 'active']), sentAt: z.string().nullable() })),
  readOnly: true,
};

const usersResendInvite = {
  input: z.object({ id: UserId }),
  output: z.object({ sentAt: z.string().min(1) }),
  readOnly: false,
};

const agentsList = {
  input: Empty,
  output: z.array(z.object({
    agentId: UserId,
    clientIds: z.array(z.string().min(1)),
    name: z.string().min(1),
    redirectHost: z.string().nullable(),
    approvedAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    active: z.boolean(),
  })),
  readOnly: true,
};

const agentsRemove = {
  input: z.object({ agentId: UserId }),
  output: z.object({ removed: z.literal(true) }),
  readOnly: false,
};

const usageGet = {
  input: Empty,
  output: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    calls: Meter,
    database: Meter,
    files: Meter,
    backupCopy: Meter,
    /** Emails today (Resend counts the UTC day) and this month. */
    emails: Meter,
    emailsMonth: Meter,
    egress: Meter,
    failedEffects: z.array(z.object({ id: z.string().optional(), kind: z.string().min(1), error: z.string().nullable(), attempts: z.number().int().min(0), createdAt: z.string() })),
    jobsLastRun: z.string().nullable(),
  }),
  readOnly: true,
};

/**
 * The Retry of one failed effect in Admin, Usage (plan 4.12, 5.8; task M1). The server sets its attempts back to zero and runs it
 * again after the commit, so a row that reached the 5 attempts of the job gets a new chance. The id is the outbox row id of
 * failedEffects; the line of the change signals has none.
 */
const usageRetryEffect = {
  input: z.object({ id: z.string().regex(/^\d{1,19}$/, 'Not the id of a failed effect.') }),
  output: z.object({ retried: z.literal(true) }),
  readOnly: false,
};

/**
 * live.ticket (exit wave 3): a ticket of 60 seconds and one use for the live socket of the person (GET /api/live?ticket=). A browser
 * socket cannot send the Authorization header, so it opens with this ticket. The office object makes it and keeps it in memory.
 */
const liveTicket = {
  input: Empty,
  output: z.object({ ticket: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: z.string().min(1) }),
  readOnly: true,
};

/**
 * The Google Calendar connect (fbk_022, owner 2026-10-19): four calls, only for a person and only for that person. The records they
 * touch (server/google/store.ts) are no State collection, so the calls write no event, no History row and no change signal. An agent
 * gets forbidden. None of them gives a token, a code, a sealed text, a calendar id or an error text: only the state of the connection.
 * google.connectStart reads and writes nothing: it makes the Google address with a signed state. google.connect takes the code and
 * the state that Google sent back through the callback route (server/google/callback.ts).
 */
const GoogleState = z.enum(['none', 'ok', 'not_synced', 'broken']);

const googleStatus = {
  input: Empty,
  output: z.object({ ready: z.boolean(), state: GoogleState, connectedAt: z.string().min(1).nullable() }),
  readOnly: true,
};

const googleConnectStart = {
  input: Empty,
  output: z.object({ url: z.string().min(1) }),
  readOnly: true,
};

const googleConnect = {
  input: z.object({ code: z.string().min(1).max(512).regex(/^\S+$/, 'The code has no space.'), state: z.string().min(1).max(1024) }),
  output: z.object({ state: z.literal('ok'), meetings: z.number().int().min(0) }),
  readOnly: false,
};

const googleDisconnect = {
  input: Empty,
  output: z.object({ state: z.literal('none') }),
  readOnly: false,
};

export const serverContracts = {
  'story.start': storyStart,
  'files.uploadStart': filesUploadStart,
  'files.link': filesLink,
  'feedback.uploadStart': feedbackUploadStart,
  'users.invites': usersInvites,
  'users.resendInvite': usersResendInvite,
  'agents.list': agentsList,
  'agents.remove': agentsRemove,
  'usage.get': usageGet,
  'usage.retryEffect': usageRetryEffect,
  'live.ticket': liveTicket,
  'google.status': googleStatus,
  'google.connectStart': googleConnectStart,
  'google.connect': googleConnect,
  'google.disconnect': googleDisconnect,
} satisfies Record<ServerCallName, { input: z.ZodType; output: z.ZodType; readOnly: boolean }>;
export type ServerContracts = typeof serverContracts;
