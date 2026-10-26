import { z } from 'zod';
import { ConversationId, Day, FileId, MeetingId, PaymentId, ProjectId, StageId, TaskId, UserId } from './entities';
import { MAX_SHOT_BYTES, PASSWORD_SET_MARK } from './limits';

// The plain limits live in limits.ts, with no zod, for the screens of the first load (performance audit BND-6).
export { MAX_SHOT_BYTES, PASSWORD_SET_MARK };

/**
 * The 18 calls that only the real build has (plan 4.11; live.ticket from the exit, wave 3; the four google calls of fbk_022; chats.typing of the chat presence design; the four daftra calls of the Daftra link,
 * owner 2026-10-26; usage.get and usage.retryEffect went with the usage feature, owner 2026-10-23). They carry the work that State cannot hold: story IDs, file links,
 * invitations, agents, the ticket of the live socket and the Google Calendar connect. The server runs its own versions; src/api/handlers/serverFakes.ts gives the prototype fake ones. The MCP tool list
 * (track G) reads these contracts, not the server code.
 */
export const SERVER_CALL_NAMES = [
  'story.start', 'files.uploadStart', 'files.link', 'feedback.uploadStart', 'users.invites', 'users.resendInvite', 'agents.list', 'agents.remove',
  'live.ticket', 'google.status', 'google.connectStart', 'google.connect', 'google.disconnect', 'chats.typing',
  'daftra.status', 'daftra.paymentLink', 'daftra.findClients', 'daftra.matchClient',
] as const;
export type ServerCallName = (typeof SERVER_CALL_NAMES)[number];

/** The reasons the server gives in details.reason. The screens have a text for each one (errors.reasons.<reason>). */
export const SERVER_REASONS = ['account_off', 'client_outdated', 'busy', 'story_not_yours', 'key_reused', 'too_many_overviews'] as const;
export type ServerReason = (typeof SERVER_REASONS)[number];

/** A signed upload link lives 10 minutes (plan 5.2). */
export const UPLOAD_LIFE_MS = 10 * 60 * 1000;
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
    /** A meeting with no project (fbk_022, wave 2). The file stays with that meeting: no project, no stage, no task. */
    meetingId: MeetingId.optional(),
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

/**
 * chats.typing (chat presence design B, base B5): the typist's screen tells the server that the person types in a chat, or stops. The
 * server checks that the person may see the chat and is a member, and sends the signal to the other members. It writes nothing, takes
 * no office lock and answers how many people it told. An agent gets forbidden. A chat the person cannot see answers like any hidden chat.
 */
const chatsTyping = {
  input: z.object({ conversationId: ConversationId, typing: z.boolean() }),
  output: z.object({ sent: z.number().int().min(0) }),
  readOnly: true,
};

/**
 * The Daftra link (owner, 2026-10-26; server/daftra/CLAUDE.md). Madar only reads Daftra and never writes to it. Each sub-company has its own
 * Daftra account and key, so a call never names an account: it names a payment, and the server finds the project, its sub-company and the
 * account. Four server calls, all for a person who holds the switch payment.daftraLink; all on the MCP deny list, so an agent never touches
 * Daftra. No answer and no error text ever holds a key, a site or a text of a Daftra answer: only the names, numbers and days below. The
 * account names are sub-company names and are not secret.
 *
 * daftra.status says whether the copy has Daftra accounts and what the last 15-minute read of each found. daftra.paymentLink reads the cache
 * only, so it is fast: the account of the payment, the client match of the project, one invoice to suggest and up to 10 more.
 * daftra.findClients is the one live read of a screen (a search by name, in the account of the payment). daftra.matchClient keeps the match
 * of the client of the payment to a Daftra client in that account and fills the cache for it.
 */
/** One Daftra invoice as the sheet shows it: the number, the total with VAT in riyals, and the day. */
export const DaftraInvoiceView = z.object({
  id: z.string().min(1).max(40),
  no: z.string().min(1).max(40),
  total: z.number().nonnegative(),
  issuedOn: Day,
});
export type DaftraInvoiceView = z.infer<typeof DaftraInvoiceView>;

/** The problem that the last read found: a wrong key, a key role that refuses the entity, or a Daftra that did not answer. */
export const DaftraProblem = z.enum(['bad_key', 'refused', 'unreachable']);

/** Why a project has no Daftra account: it has no sub-company, or its sub-company has no account in this copy. */
export const DaftraNoAccount = z.enum(['no_sub_company', 'no_daftra_account']);

const daftraStatus = {
  input: Empty,
  output: z.object({
    ready: z.boolean(),
    /** Every account of the copy (a sub-company name in capitals, not secret), with its last good read and its last problem. Empty when not ready. */
    accounts: z.array(z.object({ name: z.string().min(2).max(20), lastReadAt: z.string().min(1).nullable(), problem: DaftraProblem.nullable() })).max(50),
  }),
  readOnly: true,
};

const daftraPaymentLink = {
  input: z.object({ paymentId: PaymentId }),
  output: z.object({
    /** The account of the project (its sub-company), or null with the reason in noAccount. */
    account: z.string().min(2).max(20).nullable(),
    noAccount: DaftraNoAccount.nullable(),
    /** The Daftra client that the project client is matched to in that account, by name. Null until a person matches it. */
    matched: z.object({ name: z.string().min(1).max(200) }).nullable(),
    projectHasNoClient: z.boolean(),
    suggested: DaftraInvoiceView.nullable(),
    others: z.array(DaftraInvoiceView).max(10),
  }),
  readOnly: true,
};

const daftraFindClients = {
  input: z.object({ paymentId: PaymentId, query: z.string().trim().min(1).max(100) }),
  output: z.object({ clients: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().min(1).max(200), number: z.string().max(40) })).max(10) }),
  readOnly: true,
};

const daftraMatchClient = {
  input: z.object({ paymentId: PaymentId, daftraClientId: z.string().regex(/^[0-9]{1,20}$/, 'A Daftra client id is a number.') }),
  output: z.object({ matched: z.object({ name: z.string().min(1).max(200) }), invoices: z.number().int().min(0) }),
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
  'live.ticket': liveTicket,
  'chats.typing': chatsTyping,
  'google.status': googleStatus,
  'google.connectStart': googleConnectStart,
  'google.connect': googleConnect,
  'google.disconnect': googleDisconnect,
  'daftra.status': daftraStatus,
  'daftra.paymentLink': daftraPaymentLink,
  'daftra.findClients': daftraFindClients,
  'daftra.matchClient': daftraMatchClient,
} satisfies Record<ServerCallName, { input: z.ZodType; output: z.ZodType; readOnly: boolean }>;
export type ServerContracts = typeof serverContracts;
