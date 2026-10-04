import type { ServerCallName } from '../../src/api/contract/server';
import type { ServerHooks } from '../../src/api/registry';
import type { SharedCallName } from '../../src/api/sharedCalls';
import type { Deps } from '../core/ports';
import type { ServerCall } from '../core/types';
import { agentsList, agentsRemove } from './agents';
import { feedbackScreenshotHooks, feedbackSendHooks, feedbackUploadStart } from './feedback';
import { filesLink, filesUploadHooks, filesUploadStart, projectsDeleteHooks } from './files';
import { usersInvites, usersResendInvite } from './people';
import { storyStart } from './story';
import { usageGet, usageRetryEffect } from './usage';

/**
 * The registry of the 10 server calls (plan 4.11). runCall (C3) finds a server call here; each owner track replaces its file's body,
 * never this list. The contracts are in src/api/contract/server.ts.
 */
export const SERVER_CALLS: { [N in ServerCallName]: ServerCall<N> } = {
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
};

/**
 * The server hooks of the shared calls (plan 4.5, steps 5.1 and 5.5). They replace the prototype "prepare" on the server.
 * Track F fills the bodies in server/calls/{files,feedback}.ts, never this list.
 */
export const SERVER_HOOKS: Partial<Record<SharedCallName, ServerHooks<unknown, unknown, Deps>>> = {
  'files.upload': filesUploadHooks,
  'feedback.send': feedbackSendHooks,
  'feedback.screenshot': feedbackScreenshotHooks,
  'projects.delete': projectsDeleteHooks,
};
