import { ApiError } from '../errors';
import type { Adapter } from './wire';

/** feedback.send in the real build: feedback.uploadStart, the uploads, then feedback.send with the upload IDs. Track F replaces this stub. */
export function feedbackAdapter(): Adapter {
  return async () => {
    throw new ApiError('failed', 'The feedback adapter is not built yet.', { reason: 'not_built' });
  };
}
