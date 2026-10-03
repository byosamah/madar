import type { z } from 'zod';
import type { Api } from './client';
import { chatCalls } from './handlers/chats';
import { contentCalls } from './handlers/content';
import { fileCalls } from './handlers/files';
import { historyCalls } from './handlers/history';
import { insightCalls } from './handlers/insights';
import { notificationCalls } from './handlers/notifications';
import { paymentCalls } from './handlers/payments';
import { peopleCalls } from './handlers/people';
import { projectCalls } from './handlers/projects';
import { taskCalls } from './handlers/tasks';
import { feedbackCalls } from './handlers/feedback';
import { stageTemplateCalls } from './handlers/stageTemplates';
import { taskTemplateCalls } from './handlers/taskTemplates';
import { shareCalls } from './handlers/sharing';
import { teamCalls } from './handlers/teams';
import { systemCalls } from './handlers/system';
import { trackerCalls } from './handlers/tracker';

/** The 112 calls of the call map. The server runs 108 of them (sharedCalls.ts). */
export const mapCalls = {
  ...peopleCalls,
  ...systemCalls,
  ...projectCalls,
  ...taskCalls,
  ...contentCalls,
  ...fileCalls,
  ...shareCalls,
  ...historyCalls,
  ...notificationCalls,
  ...chatCalls,
  ...insightCalls,
  ...stageTemplateCalls,
  ...feedbackCalls,
  ...taskTemplateCalls,
  ...trackerCalls,
  ...paymentCalls,
  ...teamCalls,
};

/** Every action in Madar. Screens and, later, AI agents use exactly these calls. */
export const calls = mapCalls;

export type Calls = typeof calls;
export type CallName = keyof Calls & string;
export type CallInput<N extends CallName> = z.input<Calls[N]['input']>;
export type CallOutput<N extends CallName> = z.output<Calls[N]['output']>;
export type MadarApi = Api<Calls>;
