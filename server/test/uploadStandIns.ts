import { ApiError, invalid, notFound } from '../../src/api/errors';
import type { FeedbackPrepared, ScreenshotPrepared } from '../../src/api/handlers/feedback';
import type { UploadPrepared } from '../../src/api/handlers/files';
import type { Deps } from '../core/ports';
import type { CallEntry, ServerEntry, SharedEntry } from '../core/serverCallMap';
import type { ServerCallCtx } from '../core/types';
import type { FakeFiles } from './fakes/files';

/**
 * The upload steps for the in-memory unit tests of dbApi.test.ts only. The real steps of track F (server/calls/files.ts,
 * server/calls/feedback.ts) keep their upload records in SQL (server/files/intents.ts), which the in-memory data of runCall
 * (server/core/memoryData.ts) does not answer. So those tests run these stand-ins in their place: an upload record in memory, the
 * object check and the copy to the final key. A stand-in checks no right; the handler's run() checks them, as on the server. The
 * db project runs the real steps of track F on the local stack, with no stand-in (task D, follow-up of the F merge).
 */

type Rec = Record<string, unknown>;

type StandInUpload = { id: string; actorId: string; stagingKey: string; key: string; size: number; mimeType: string };

const uploadsByStore = new WeakMap<FakeFiles, Map<string, StandInUpload>>();
let made = 0;

function uploadsOf(deps: Deps): Map<string, StandInUpload> {
  const files = deps.files as FakeFiles;
  let uploads = uploadsByStore.get(files);
  if (!uploads) uploadsByStore.set(files, (uploads = new Map()));
  return uploads;
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
type StandInHooks = { preflight: (input: Rec, ctx: HookCtx) => Promise<unknown>; prepare?: (preflight: unknown) => Promise<unknown> };

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

function serverStandIn(entry: ServerEntry): ServerEntry {
  const standIn = STAND_IN_CALLS[entry.name];
  return standIn ? { ...entry, call: (input, ctx) => standIn(input as Rec, ctx) } : entry;
}

function sharedStandIn(entry: SharedEntry): SharedEntry {
  const standIn = STAND_IN_HOOKS[entry.name];
  if (!standIn) return entry;
  const hooks: NonNullable<SharedEntry['hooks']> = { preflight: (input, ctx) => standIn.preflight(input as Rec, ctx) };
  const prepare = standIn.prepare;
  if (prepare) hooks.prepare = (_input, _ctx, preflight) => prepare(preflight);
  return { ...entry, hooks };
}

/** A new call map with the stand-ins in place of the upload steps. Every other entry stays the same object. */
export function uploadStandIns(map: ReadonlyMap<string, CallEntry>): ReadonlyMap<string, CallEntry> {
  return new Map([...map].map(([name, entry]) => [name, entry.kind === 'server' ? serverStandIn(entry) : sharedStandIn(entry)]));
}
