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
import { projectTemplateCalls } from './handlers/projectTemplates';
import { pushCalls } from './handlers/push';
import { stageTemplateCalls } from './handlers/stageTemplates';
import { taskTemplateCalls } from './handlers/taskTemplates';
import { shareCalls } from './handlers/sharing';
import { subCompanyCalls } from './handlers/subCompanies';
import { teamCalls } from './handlers/teams';
import { systemCalls } from './handlers/system';
import { trackerCalls } from './handlers/tracker';
import { serverFakes } from './handlers/serverFakes';

/** The 120 calls of the call map. The server runs 116 of them (sharedCalls.ts). */
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
  ...subCompanyCalls,
  ...projectTemplateCalls,
  ...pushCalls,
};

/**
 * Every action in Madar. Screens and, later, AI agents use exactly these calls.
 * The prototype adds fake versions of the 9 server calls, so the screens use the same calls in both builds (plan 4.11).
 */
export const calls = { ...mapCalls, ...serverFakes };

export type Calls = typeof calls;
export type CallName = keyof Calls & string;
export type CallInput<N extends CallName> = z.input<Calls[N]['input']>;
export type CallOutput<N extends CallName> = z.output<Calls[N]['output']>;
export type MadarApi = Api<Calls>;
