import { MAX_SHOT_BYTES, type SignedPut } from '../contract/server';
import { putFailure, tooLarge, uploadFailed, xhrPut, type PutSender } from './upload';
import type { Adapter } from './wire';

type ScreenReport = { kind: string; message: string; page?: string; screenshots?: Blob[] };

/** feedback.send in the real build: feedback.uploadStart, the uploads, then feedback.send with the upload IDs (plan 5.2). */
export function feedbackAdapter(o: { put?: PutSender } = {}): Adapter {
  const send = o.put ?? xhrPut;
  return async (raw, ctx) => {
    const { screenshots = [], ...report } = raw as ScreenReport;
    const uploadIds: string[] = [];
    if (screenshots.length > 0) {
      const start = (await ctx.call('feedback.uploadStart', {
        screenshots: screenshots.map((shot) => ({ size: shot.size, mimeType: shot.type })),
      })) as { uploads: { uploadId: string; put: SignedPut }[] };
      for (const [i, upload] of start.uploads.entries()) {
        const result = await send(upload.put, screenshots[i]);
        const failure = putFailure(result);
        // The server already refused a screenshot over 10 MB, so a size refusal of the store names that limit.
        if (failure === 'too_large') throw tooLarge('screenshots', MAX_SHOT_BYTES);
        if (failure) throw uploadFailed(result.status);
        uploadIds.push(upload.uploadId);
      }
    }
    return ctx.call('feedback.send', { ...report, uploadIds });
  };
}
