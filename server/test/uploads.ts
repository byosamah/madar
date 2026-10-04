import { ApiError, invalid, notFound } from '../../src/api/errors';
import type { FeedbackPrepared, ScreenshotPrepared } from '../../src/api/handlers/feedback';
import type { UploadPrepared } from '../../src/api/handlers/files';
import type { Deps } from '../core/ports';
import type { CallEntry, ServerEntry, SharedEntry } from '../core/serverCallMap';
import type { ServerCallCtx } from '../core/types';
import type { FakeFiles } from './fakes/files';

/**
 * The file data of db mode (TM 3.3 and 3.6; task D2). The mirror store sends files.upload and feedback.send the way the remote
 * screens do (plan 5.2): the upload start, the upload of each file to its signed link, then the call with the upload IDs. Here
 * the upload is a write into the fake file store of the test (server/test/fakes/files.ts), and the store also keeps the content,
 * so t.store.persister and feedback.screenshot give the test its data back.
 *
 * Track F builds the upload steps of the server (server/calls/files.ts, server/calls/feedback.ts). While a step is still the T0
 * stub, it answers not_built, and only then a stand-in of this file runs in its place: an upload record in memory, the object
 * check and the copy to the final key. A stand-in checks no right; the handler's run() checks them, as on the server. When F
 * merges, the real steps answer, and the stand-ins never run again. standInUses() counts them for the run report.
 */

type Rec = Record<string, unknown>;

/** The host of every link of the fake file store. */
const FAKE_HOST = 'files.test';

const contentByStore = new WeakMap<FakeFiles, Map<string, Blob>>();

/**
 * The content of the fake store, by object key. The first call wraps copy and remove of the store, so a copy takes the content
 * with it and a remove takes it away.
 */
export function storedContent(files: FakeFiles): Map<string, Blob> {
  let content = contentByStore.get(files);
  if (content) return content;
  const blobs = new Map<string, Blob>();
  content = blobs;
  contentByStore.set(files, blobs);
  const { copy, remove } = files;
  files.copy = async (from, to) => {
    await copy(from, to);
    const blob = blobs.get(from);
    if (blob) blobs.set(to, blob);
  };
  files.remove = async (keys) => {
    await remove(keys);
    for (const key of keys) blobs.delete(key);
  };
  return blobs;
}

/** The object key of a link of the fake store: https://files.test/put/<key> or https://files.test/get/<key>?... */
export function keyOfLink(link: string): string {
  const url = new URL(link);
  const match = /^\/(?:put|get)\/(.+)$/.exec(url.pathname);
  if (url.host !== FAKE_HOST || !match) throw new Error(`db mode: ${link} is not a link of the fake file store.`);
  return decodeURIComponent(match[1]);
}

/** What the browser does with a signed upload link: the object arrives at its key, with its type and size. */
export function browserPut(files: FakeFiles, link: string, blob: Blob): void {
  const key = keyOfLink(link);
  files.objects.set(key, { size: blob.size, mimeType: blob.type || 'application/octet-stream' });
  storedContent(files).set(key, blob);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The stand-ins for the T0 stubs of track F.

type StandInUpload = { id: string; actorId: string; stagingKey: string; key: string; size: number; mimeType: string };

const uploadsByStore = new WeakMap<FakeFiles, Map<string, StandInUpload>>();
let uses = 0;
let made = 0;

/** How often a stand-in ran in place of a stub in this worker. */
export function standInUses(): number {
  return uses;
}

function uploadsOf(deps: Deps): Map<string, StandInUpload> {
  const files = deps.files as FakeFiles;
  let uploads = uploadsByStore.get(files);
  if (!uploads) uploadsByStore.set(files, (uploads = new Map()));
  return uploads;
}

function isNotBuilt(error: unknown): boolean {
  return error instanceof ApiError && (error.details as { reason?: unknown } | undefined)?.reason === 'not_built';
}

/** The real step; its stand-in only when the real step is still the stub. */
async function orStandIn<T>(real: () => Promise<T>, standIn: () => Promise<T>): Promise<T> {
  try {
    return await real();
  } catch (error) {
    if (!isNotBuilt(error)) throw error;
    uses += 1;
    return standIn();
  }
}

async function startUpload(deps: Deps, actorId: string, size: number, mimeType: string) {
  made += 1;
  const id = `upl_dbmode_${made}`;
  const upload: StandInUpload = { id, actorId, stagingKey: `up/${id}`, key: `db-mode/${id}/file`, size, mimeType };
  uploadsOf(deps).set(id, upload);
  return { uploadId: id, put: await deps.files.presignPut(upload.stagingKey, { mimeType, size }) };
}

function tooLarge(field: string, limit: number): ApiError {
  return new ApiError('invalid_input', 'The file is too large.', { fields: [field], reason: 'file_too_large', limit });
}

/** The object of one upload: it must be this person's, it must have arrived with its size, and it moves to the final key. */
async function confirm(deps: Deps, actorId: string, id: string, field: string): Promise<StandInUpload> {
  const upload = uploadsOf(deps).get(id);
  if (!upload || upload.actorId !== actorId) throw invalid(field, 'This upload does not exist.');
  const object = await deps.files.head(upload.stagingKey);
  if (!object || object.size !== upload.size) throw invalid(field, 'The file did not arrive whole. Send it again.');
  await deps.files.copy(upload.stagingKey, upload.key);
  await deps.files.remove([upload.stagingKey]);
  return upload;
}

const STAND_IN_CALLS: Record<string, (input: Rec, ctx: ServerCallCtx) => Promise<{ output: unknown; changed: boolean }>> = {
  async 'files.uploadStart'(input, { deps, office, principal }) {
    const projectId = String(input.projectId);
    if (!office.lists.projects[projectId]) throw notFound('Project', projectId);
    const size = Number(input.size);
    if (size > deps.files.maxFileBytes) throw tooLarge('size', deps.files.maxFileBytes);
    return { output: await startUpload(deps, principal.userId, size, String(input.mimeType)), changed: false };
  },
  async 'feedback.uploadStart'(input, { deps, principal }) {
    const shots = input.screenshots as { size: number; mimeType: string }[];
    const uploads = [];
    for (const shot of shots) uploads.push(await startUpload(deps, principal.userId, shot.size, shot.mimeType));
    return { output: { uploads }, changed: false };
  },
};

type HookCtx = { actorId: string; deps: Deps };
type StandInHooks = { preflight?: (input: Rec, ctx: HookCtx) => Promise<unknown>; prepare?: (preflight: unknown) => Promise<unknown> };

const STAND_IN_HOOKS: Record<string, StandInHooks> = {
  'files.upload': {
    async preflight(input, { actorId, deps }): Promise<UploadPrepared> {
      const upload = await confirm(deps, actorId, String(input.uploadId), 'uploadId');
      return { blobKey: upload.key, size: upload.size, mimeType: upload.mimeType };
    },
    prepare: async (preflight) => preflight,
  },
  'feedback.send': {
    async preflight(input, { actorId, deps }): Promise<FeedbackPrepared> {
      const shots: FeedbackPrepared['shots'] = [];
      for (const id of input.uploadIds as string[]) {
        const upload = await confirm(deps, actorId, id, 'uploadIds');
        shots.push({ blobKey: upload.key, type: upload.mimeType });
      }
      return { shots };
    },
    prepare: async (preflight) => preflight,
  },
  'feedback.screenshot': {
    async preflight(input, { deps }): Promise<ScreenshotPrepared> {
      const id = String(input.id);
      const index = Number(input.index);
      const [row] = await deps.db.statement<{ doc: { screenshots: { blobKey: string; type: string }[] } }>('read', 'select doc from feedback where id = $1', [id]);
      if (!row) throw notFound('Report', id);
      const shot = row.doc.screenshots[index];
      if (!shot) throw notFound('Screenshot', `${id}#${index}`);
      return { link: await deps.files.presignGet(shot.blobKey, { disposition: 'inline', filename: `screenshot-${index + 1}`, mimeType: shot.type }) };
    },
  },
};

function serverWithStandIn(entry: ServerEntry): ServerEntry {
  const standIn = STAND_IN_CALLS[entry.name];
  if (!standIn) return entry;
  return { ...entry, call: (input, ctx) => orStandIn(() => entry.call(input, ctx), () => standIn(input as Rec, ctx)) };
}

function sharedWithStandIn(entry: SharedEntry): SharedEntry {
  const standIn = STAND_IN_HOOKS[entry.name];
  const real = entry.hooks;
  if (!standIn || !real) return entry;
  const hooks: NonNullable<SharedEntry['hooks']> = { ...real };
  if (real.preflight && standIn.preflight) {
    const [own, other] = [real.preflight.bind(real), standIn.preflight];
    hooks.preflight = (input, ctx) => orStandIn(() => own(input, ctx), () => other(input as Rec, ctx));
  }
  if (real.prepare && standIn.prepare) {
    const [own, other] = [real.prepare.bind(real), standIn.prepare];
    hooks.prepare = (input, ctx, preflight) => orStandIn(() => own(input, ctx, preflight), () => other(preflight));
  }
  return { ...entry, hooks };
}

/** The call map with the stand-ins in front of the stubs of track F. Every other entry stays the same object. */
export function withStandIns(map: ReadonlyMap<string, CallEntry>): ReadonlyMap<string, CallEntry> {
  return new Map([...map].map(([name, entry]) => [name, entry.kind === 'server' ? serverWithStandIn(entry) : sharedWithStandIn(entry)]));
}
