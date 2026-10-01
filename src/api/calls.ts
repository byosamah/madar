import type { z } from 'zod';
import type { Api } from './client';
import { chatCalls } from './handlers/chats';
import { contentCalls } from './handlers/content';
import { fileCalls } from './handlers/files';
import { historyCalls } from './handlers/history';
import { insightCalls } from './handlers/insights';
import { notificationCalls } from './handlers/notifications';
import { peopleCalls } from './handlers/people';
import { projectCalls } from './handlers/projects';
import { taskCalls } from './handlers/tasks';
import { systemCalls } from './handlers/system';

/** Every action in Madar. Screens and, later, AI agents use exactly these calls. */
export const calls = {
  ...peopleCalls,
  ...systemCalls,
  ...projectCalls,
  ...taskCalls,
  ...contentCalls,
  ...fileCalls,
  ...historyCalls,
  ...notificationCalls,
  ...chatCalls,
  ...insightCalls,
};

export type Calls = typeof calls;
export type CallName = keyof Calls & string;
export type CallInput<N extends CallName> = z.input<Calls[N]['input']>;
export type CallOutput<N extends CallName> = z.output<Calls[N]['output']>;
export type MadarApi = Api<Calls>;
