import { z } from 'zod';
import { ConversationId, FolderId, MeetingId, ProjectId, StageId, TaskId, FeedbackKind } from '../../src/api/contract/entities';
import { isAppPath } from '../../src/api/handlers/feedback';
import { ApiError, invalid } from '../../src/api/errors';
import { putFailure, tooLarge, uploadFailed } from '../../src/api/remote/upload';
import { MAX_BODY_BYTES } from '../../src/api/remote/wire';
import type { Deps } from '../core/ports';
import type { RunCall } from '../core/runCall';
import type { OfficeSnapshot, Principal, RunResult } from '../core/types';
import { runErrorOf } from '../http/errors';

/**
 * Uploads by content for agents (owner, 2026-10-26: "the agent sends the file content in the call"). Two tools have no call of their own:
 *
 *   files.uploadContent            one file into a project, a to-do, a chat or a meeting
 *   feedback.sendWithScreenshots   a request or bug report with up to three screenshots
 *
 * Each runs the calls of the screens inside it, with the rights of the person, as the browser does (src/api/remote/upload.ts): the start
 * call (files.uploadStart or feedback.uploadStart) checks the rights and the size and signs the link; the server puts the bytes to the
 * signed link; then the save call (files.upload or feedback.send) runs its preflight, which copies the object to its final key and checks the
 * size and the type of the FINAL object. So every right, every refusal, the safe-type rule and the file limit stay the rules of the screens.
 *
 * - The agent never gets a storage key or a signed link: the link stays in this function, and the answer holds the record only.
 * - No fetch of an outside address: the agent sends the bytes itself, as base64 text. At most 10 MB decoded (MAX_UPLOAD_BYTES).
 * - The whole call counts as one tool call against the minute limit (the limit counts the request, app.ts).
 * - A failure after the PUT leaves one staging object. The uploads job step removes it after 2 hours 10 minutes (server/files/CLAUDE.md).
 */

export const FILES_UPLOAD_CONTENT = 'files.uploadContent';
export const FEEDBACK_SEND_WITH_SCREENSHOTS = 'feedback.sendWithScreenshots';
export const UPLOAD_TOOLS: ReadonlySet<string> = new Set([FILES_UPLOAD_CONTENT, FEEDBACK_SEND_WITH_SCREENSHOTS]);

/** The most that one call carries, decoded (owner, 2026-10-26). The screenshots of one report share it. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** The base64 text of MAX_UPLOAD_BYTES. A longer text is refused before it is decoded. */
export const MAX_UPLOAD_CHARS = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
/** The body of an upload call: the base64 text and a little room for the other fields. Every other MCP body stays at MAX_BODY_BYTES. */
export const UPLOAD_BODY_BYTES = MAX_UPLOAD_CHARS + 64 * 1024;
/** How long the server waits for the store to take the bytes. */
const PUT_TIMEOUT_MS = 60_000;
/** The characters that one atob call decodes (a multiple of 4). */
const DECODE_CHUNK = 1 << 16;

const Base64 = z.string().min(1).describe('The file content as standard base64 text: one line, no spaces, no data: prefix. At most 10 MB decoded.');

export const FilesUploadContentInput = z.strictObject({
  projectId: ProjectId.optional().describe('The project of the file. Leave it out for a to-do with no project (taskId alone), a chat or a meeting.'),
  conversationId: ConversationId.optional().describe('A direct chat or a group. An agent cannot upload there: the call answers not_found.'),
  meetingId: MeetingId.optional().describe('A meeting with no project.'),
  stageId: StageId.nullable().optional().describe('A stage of the project.'),
  taskId: TaskId.nullable().optional().describe('A to-do. With no projectId, an office to-do.'),
  folderId: FolderId.nullable().optional().describe('A folder of the stage (from projects.get).'),
  name: z.string().trim().min(1).max(200).describe('The file name, with its ending. The same name in the same place adds a new version.'),
  type: z.string().min(1).max(100).describe('The file type (MIME), for example application/pdf or image/png.'),
  contentBase64: Base64,
  receivedFromClient: z.boolean().optional().describe('True when the client sent this file: the upload also logs a Tracker line.'),
});

const ShotInput = z.strictObject({
  name: z.string().trim().max(200).optional().describe('A label for you. Madar does not keep it.'),
  type: z.string().min(1).max(60).describe('image/png, image/jpeg, image/gif, image/webp or image/avif.'),
  contentBase64: Base64,
});

export const FeedbackSendWithScreenshotsInput = z.strictObject({
  kind: FeedbackKind.describe('feature or bug.'),
  message: z.string().trim().min(1, 'Write what the person needs or what went wrong.').max(2000).describe('The text of the report, up to 2,000 characters.'),
  page: z.string().max(300).refine((page) => page === '' || isAppPath(page), 'Send a Madar screen path that starts with /.').optional().describe('The Madar screen path, for example /projects. Leave it out when unknown.'),
  screenshots: z.array(ShotInput).min(1).max(3).describe('1 to 3 pictures. Together at most 10 MB decoded.'),
});

export const UPLOAD_INPUTS = { [FILES_UPLOAD_CONTENT]: FilesUploadContentInput, [FEEDBACK_SEND_WITH_SCREENSHOTS]: FeedbackSendWithScreenshotsInput } as const;

export type UploadCtx = { deps: Deps; principal: Principal; office: OfficeSnapshot; runCall: RunCall; storeFetch?: typeof globalThis.fetch };

const fail = (error: unknown): RunResult => ({ ok: false, error: runErrorOf(error) });

/** The text is too long to be a file of 10 MB or less, or its decoded bytes are. The same refusal as the start call gives for a large size. */
const fileTooLarge = (field: string): RunResult => fail(tooLarge(field, MAX_UPLOAD_BYTES));

/**
 * The bytes of a standard base64 text, or null when the text is no base64. The length rule is strict (a multiple of 4, padding only at the
 * end), so a text with a space or a line break does not pass. It decodes in chunks, so the work never builds a second text of the whole file.
 */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 4 !== 0) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const size = (text.length / 4) * 3 - padding;
  const native = (Uint8Array as unknown as { fromBase64?: (text: string, o: { alphabet: 'base64'; lastChunkHandling: 'strict' }) => Uint8Array }).fromBase64;
  if (typeof native === 'function') {
    try {
      const bytes = native.call(Uint8Array, text, { alphabet: 'base64', lastChunkHandling: 'strict' });
      return bytes.length === size ? bytes : null;
    } catch {
      return null;
    }
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (let from = 0; from < text.length; from += DECODE_CHUNK) {
    const part = text.slice(from, from + DECODE_CHUNK);
    let binary: string;
    try {
      binary = atob(part);
    } catch {
      return null;
    }
    // atob drops white space: a short result means the chunk held some.
    const want = (part.length / 4) * 3 - (from + part.length === text.length ? padding : 0);
    if (binary.length !== want) return null;
    for (let i = 0; i < binary.length; i += 1) out[at + i] = binary.charCodeAt(i);
    at += binary.length;
  }
  return at === size ? out : null;
}

const notBase64 = (field: string): RunResult => fail(invalid(field, 'This is not base64 text. Send the content as standard base64 in one line, with no spaces and no data: prefix.', 'not_base64'));

type Decoded = { ok: true; bytes: Uint8Array } | { ok: false; result: RunResult };

/** The bytes of one base64 field, or the refusal. A text that is too long is refused before any decoding. */
function bytesOf(text: string, field: string): Decoded {
  if (text.length > MAX_UPLOAD_CHARS) return { ok: false, result: fileTooLarge(field) };
  const bytes = decodeBase64(text);
  if (!bytes || bytes.length === 0) return { ok: false, result: notBase64(field) };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, result: fileTooLarge(field) };
  return { ok: true, bytes };
}

/** One call of the screens for the agent, with its rights, as run.ts runs a tool. */
function callAs(ctx: UploadCtx, name: string, input: unknown, story?: string): Promise<RunResult> {
  return ctx.runCall(ctx.deps, {
    principal: ctx.principal, name, input, ...(story ? { story: { id: story } } : {}), batch: { storyRefs: new Map(), office: ctx.office, overviewCalls: 0 },
  });
}

type SignedPut = { url: string; headers: Record<string, string> };

/**
 * Puts the bytes to the signed link, with exactly the headers that the server signed. It never throws and never names the link:
 * a failure is the refusal of the screens, too_large for the size refusal of the store and failed for the rest.
 */
async function putBytes(ctx: UploadCtx, put: SignedPut, bytes: Uint8Array, field: string): Promise<RunResult | null> {
  const send = ctx.storeFetch ?? globalThis.fetch;
  let status = 0;
  let body = '';
  try {
    const response = await send(put.url, { method: 'PUT', headers: put.headers, body: bytes as unknown as BodyInit, signal: AbortSignal.timeout(PUT_TIMEOUT_MS) });
    status = response.status;
    if (response.ok) {
      await response.body?.cancel();
      return null;
    }
    body = await response.text().catch(() => '');
  } catch {
    // No answer from the store: status 0.
  }
  const failure = putFailure({ status, body });
  if (failure === 'too_large') return fileTooLarge(field);
  ctx.deps.log.warn('An upload by content did not reach the file store.', { status });
  return fail(uploadFailed(status));
}

const fieldsOf = (input: Record<string, unknown>, names: readonly string[]) => Object.fromEntries(names.filter((name) => input[name] !== undefined).map((name) => [name, input[name]]));

/** The short answer for the agent: the record of the file and its place. No storage key, no link. */
function fileAnswer(view: { file: Record<string, any>; latest: Record<string, any> }): Record<string, unknown> {
  const { file, latest } = view;
  return {
    id: file.id,
    name: file.name,
    version: latest.letter,
    size: latest.size,
    type: latest.mimeType,
    uploadedAt: latest.uploadedAt,
    place: {
      projectId: file.projectId ?? null,
      stageId: file.stageId ?? null,
      folderId: file.folderId ?? null,
      taskId: file.taskId ?? null,
      ...(file.conversationId !== undefined ? { conversationId: file.conversationId } : {}),
      ...(file.meetingId !== undefined ? { meetingId: file.meetingId } : {}),
    },
  };
}

/** files.uploadContent: the start call, the PUT, then files.upload. Every refusal comes from the call that makes it. */
async function runFilesUploadContent(args: Record<string, unknown>, ctx: UploadCtx): Promise<RunResult> {
  const { storyId, ...rest } = args;
  const parsed = FilesUploadContentInput.safeParse(rest);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')).filter(Boolean))];
    return { ok: false, error: { code: 'invalid_input', message: parsed.error.issues[0]?.message ?? 'The input is not valid.', details: { fields } } };
  }
  const input = parsed.data;
  // The size rules come first, so a file that is too large never reaches the store.
  const decoded = bytesOf(input.contentBase64, 'contentBase64');
  if (!decoded.ok) return decoded.result;
  const { bytes } = decoded;

  const start = await callAs(ctx, 'files.uploadStart', {
    ...fieldsOf(input, ['projectId', 'conversationId', 'meetingId', 'stageId', 'taskId']), name: input.name, size: bytes.length, mimeType: input.type,
  });
  if (!start.ok) return start;
  const { uploadId, put } = start.output as { uploadId: string; put: SignedPut };

  const sent = await putBytes(ctx, put, bytes, 'contentBase64');
  if (sent) return sent;

  const saved = await callAs(ctx, 'files.upload', {
    ...fieldsOf(input, ['projectId', 'conversationId', 'meetingId', 'stageId', 'taskId', 'folderId', 'receivedFromClient']), name: input.name, uploadId,
  }, typeof storyId === 'string' && storyId !== '' ? storyId : undefined);
  if (!saved.ok) return saved;
  return { ok: true, output: fileAnswer(saved.output as { file: Record<string, any>; latest: Record<string, any> }), changed: true, ...(saved.storyId !== undefined ? { storyId: saved.storyId } : {}) };
}

/** feedback.sendWithScreenshots: feedback.uploadStart for the pictures, one PUT for each, then feedback.send with the upload IDs. */
async function runFeedbackWithScreenshots(args: Record<string, unknown>, ctx: UploadCtx): Promise<RunResult> {
  const { storyId, ...rest } = args;
  const parsed = FeedbackSendWithScreenshotsInput.safeParse(rest);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')).filter(Boolean))];
    return { ok: false, error: { code: 'invalid_input', message: parsed.error.issues[0]?.message ?? 'The input is not valid.', details: { fields } } };
  }
  const input = parsed.data;
  const shots: Uint8Array[] = [];
  let total = 0;
  for (const shot of input.screenshots) {
    const decoded = bytesOf(shot.contentBase64, 'screenshots');
    if (!decoded.ok) return decoded.result;
    total += decoded.bytes.length;
    if (total > MAX_UPLOAD_BYTES) return fileTooLarge('screenshots');
    shots.push(decoded.bytes);
  }

  const start = await callAs(ctx, 'feedback.uploadStart', { screenshots: input.screenshots.map((shot, at) => ({ size: shots[at].length, mimeType: shot.type })) });
  if (!start.ok) return start;
  const { uploads } = start.output as { uploads: { uploadId: string; put: SignedPut }[] };

  const results = await Promise.all(uploads.map((upload, at) => putBytes(ctx, upload.put, shots[at], 'screenshots')));
  const refused = results.find((result) => result !== null);
  if (refused) return refused;

  const saved = await callAs(ctx, 'feedback.send', {
    kind: input.kind, message: input.message, ...(input.page !== undefined ? { page: input.page } : {}), uploadIds: uploads.map((upload) => upload.uploadId),
  }, typeof storyId === 'string' && storyId !== '' ? storyId : undefined);
  if (!saved.ok) return saved;
  const report = saved.output as { id: string; kind: string; page: string; status: string; screenshots: { type: string }[]; createdAt: string };
  return {
    ok: true, changed: true, ...(saved.storyId !== undefined ? { storyId: saved.storyId } : {}),
    output: { id: report.id, kind: report.kind, page: report.page, status: report.status, screenshots: report.screenshots.map((shot) => ({ type: shot.type })), createdAt: report.createdAt },
  };
}

export function runUpload(name: string, args: Record<string, unknown>, ctx: UploadCtx): Promise<RunResult> {
  return name === FILES_UPLOAD_CONTENT ? runFilesUploadContent(args, ctx) : runFeedbackWithScreenshots(args, ctx);
}

/**
 * The body of an MCP request (256 KB at most), except for an upload tool: it carries a file as base64 text, so it may reach UPLOAD_BODY_BYTES.
 * The read stops at once at the limit. A body past 256 KB is an upload only when its tool name says so: the Mcp-Name header (2026-07-28), or
 * the name in the first 4 KB of the body (earlier clients). app.ts checks the name again after it parses the body.
 */
export async function readMcpBody(request: Request): Promise<{ text: string; bytes: number }> {
  const tooBig = () => new ApiError('invalid_input', 'The request is too large.', { reason: 'too_large' });
  const uploadName = /"name"\s*:\s*"(files\.uploadContent|feedback\.sendWithScreenshots)"/;
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > UPLOAD_BODY_BYTES) throw tooBig();
  const byHeader = UPLOAD_TOOLS.has(request.headers.get('Mcp-Name') ?? '');
  if (!request.body) return { text: '', bytes: 0 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let limit = byHeader ? UPLOAD_BODY_BYTES : MAX_BODY_BYTES;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    chunks.push(value);
    if (size > limit) {
      // Over the small limit: decide once whether this is an upload, from the start of the body.
      if (limit === MAX_BODY_BYTES && size <= UPLOAD_BODY_BYTES && uploadName.test(new TextDecoder().decode(joinBytes(chunks, size).subarray(0, 4096)))) limit = UPLOAD_BODY_BYTES;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw tooBig();
      }
    }
  }
  return { text: new TextDecoder().decode(joinBytes(chunks, size)), bytes: size };
}

function joinBytes(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
