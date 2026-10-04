import { MAX_SHOT_BYTES } from '../../src/api/contract/server';
import { invalid, notFound } from '../../src/api/errors';
import type { FeedbackPrepared, ScreenshotPrepared } from '../../src/api/handlers/feedback';
import type { ServerHooks } from '../../src/api/registry';
import type { Deps } from '../core/ports';
import type { ServerCall } from '../core/types';
import { confirmUpload } from '../files/confirm';
import { removeNowOrLater } from '../files/effects';
import { checkIntent, declaredType, insertIntents, intentExpiry, newUploadId, readIntents, useIntents, type Intent } from '../files/intents';
import { screenshotKey, stagingKey } from '../files/keys';
import { readFeedback } from '../files/records';
import { assertAdmin, authorityOf, loadAuthority } from '../files/rights';

/**
 * The feedback screenshots on the server (plan 5.2; plan 2b, point 7; task F2). The flow of files.upload, with no project:
 * feedback.uploadStart signs one PUT for each screenshot, the preflight of feedback.send checks and copies each one to
 * feedback/<intent>/file, and its prepare marks the intents used inside the lock.
 */

/** A report keeps a screenshot type of at most 60 characters (src/api/contract/entities.ts, Feedback). */
const SHOT_TYPE_LIMIT = 60;

export const feedbackUploadStart: ServerCall<'feedback.uploadStart'> = async (input, ctx) => {
  const { deps, office, now } = ctx;
  const userId = ctx.principal.userId;
  authorityOf((id) => office.lists.users[id], userId);
  if (input.screenshots.some((shot) => shot.mimeType.length > SHOT_TYPE_LIMIT)) throw invalid('screenshots', 'A screenshot must be a PNG, JPEG, GIF or WebP picture.');
  const intents: Intent[] = [];
  const uploads = [];
  for (const shot of input.screenshots) {
    const id = newUploadId();
    const put = await deps.files.presignPut(stagingKey(id), { mimeType: shot.mimeType, size: shot.size });
    intents.push({
      id, actorId: userId, projectId: null, stagingKey: stagingKey(id), key: screenshotKey(id), thumbKey: null, size: shot.size,
      mimeType: declaredType(shot.mimeType), expiresAt: intentExpiry(now, deps.files.kind), usedAt: null,
    });
    uploads.push({ uploadId: id, put });
  }
  await insertIntents(deps.db, intents);
  return { output: { uploads }, changed: false };
};

const idsOf = (input: unknown) => (input as { uploadIds: string[] }).uploadIds;

/** feedback.send on the server: the screenshots come as upload IDs (the wire form). With none, the hooks do no work. */
export const feedbackSendHooks: ServerHooks<unknown, FeedbackPrepared, Deps> = {
  async preflight(input, { actorId, now, deps }): Promise<FeedbackPrepared> {
    const ids = idsOf(input);
    if (ids.length === 0) return { shots: [] };
    if (new Set(ids).size !== ids.length) throw invalid('uploadIds', 'Send each screenshot once.');
    const found = await readIntents(deps.db, ids);
    const intents = ids.map((id) => checkIntent(found.get(id), { id, actorId, now, field: 'uploadIds', projectId: null, allowUsed: true }));
    const remove = (keys: string[]) => removeNowOrLater(deps, keys);
    // A used intent: a retry of a call that committed. No store call (as in files.upload); runCall replays the stored answer of the
    // key, and without one prepare refuses with conflict.
    for (const intent of intents.filter((i) => i.usedAt === null)) {
      await confirmUpload(deps.files, { staging: intent.stagingKey, final: intent.key, field: 'uploadIds', want: intent, maxBytes: MAX_SHOT_BYTES, remove });
    }
    return { shots: intents.map((intent) => ({ blobKey: intent.key, type: intent.mimeType })) };
  },
  async prepare(input, { actorId, now, q }, preflight): Promise<FeedbackPrepared> {
    await useIntents(q, idsOf(input), actorId, now);
    return preflight as FeedbackPrepared;
  },
};

/**
 * feedback.screenshot on the server: a read call, so its preflight signs the download link and runCall passes that value to run()
 * as "prepared" ({ link }). Only the Admin reads reports, so the hook checks that right before it signs (plan 2b, point 7).
 */
export const feedbackScreenshotHooks: ServerHooks<unknown, ScreenshotPrepared, Deps> = {
  async preflight(input, { actorId, deps }): Promise<ScreenshotPrepared> {
    const { id, index } = input as { id: string; index: number };
    assertAdmin(await loadAuthority(deps.db, actorId));
    const report = await readFeedback(deps.db, id);
    if (!report) throw notFound('Report', id);
    const shot = report.screenshots[index];
    if (!shot) throw notFound('Screenshot', `${id}#${index}`);
    const link = await deps.files.presignGet(shot.blobKey, { disposition: 'inline', filename: `screenshot-${index + 1}`, mimeType: shot.type });
    return { link };
  },
};
