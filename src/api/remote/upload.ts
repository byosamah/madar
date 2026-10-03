import { ApiError } from '../errors';
import type { Adapter } from './wire';

/**
 * files.upload in the real build (plan 5.2): files.uploadStart, the upload of the file (and its small picture), then files.upload
 * with the upload ID. makeThumb comes in as a parameter, so src/api never imports src/app. Track F replaces this stub.
 */
export function uploadAdapter(_o: { makeThumb: (file: Blob) => Promise<Blob | null> }): Adapter {
  return async () => {
    throw new ApiError('failed', 'The upload adapter is not built yet.', { reason: 'not_built' });
  };
}
