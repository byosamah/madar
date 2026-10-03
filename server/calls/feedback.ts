import type { ServerHooks } from '../../src/api/registry';
import type { FeedbackPrepared } from '../../src/api/handlers/feedback';
import { notBuiltAsync } from '../core/notBuilt';
import type { Deps } from '../core/ports';
import type { ServerCall } from '../core/types';

/** Track F replaces these stubs (plan 5.2). */
export const feedbackUploadStart: ServerCall<'feedback.uploadStart'> = () => notBuiltAsync('feedback.uploadStart');

/** feedback.send on the server: the screenshots come as upload IDs (the wire form). */
export const feedbackSendHooks: ServerHooks<unknown, FeedbackPrepared, Deps> = {
  preflight: () => notBuiltAsync('The feedback.send preflight'),
  prepare: () => notBuiltAsync('The feedback.send prepare'),
};
