import { z } from 'zod';
import { sharedCalls } from '../../src/api/sharedCalls';
import type { RunError, RunResult } from '../core/types';

/**
 * The bulk tools for to-dos (owner, 2026-10-26). tasks.createMany makes up to 50 to-dos and tasks.updateMany changes up to 100, in one tool
 * call. Like pictures.get, they have no call of their own: each item runs the single tool (tasks.create or tasks.update) through the same
 * run path, so every right, every refusal and every reason request stays the same. All items share one story, so one events.undoStory takes
 * the batch back. A failed item does not stop the next. The whole batch counts as one tool call against the minute limit, because the limit
 * counts the request (app.ts).
 */

export const TASKS_CREATE_MANY = 'tasks.createMany';
export const TASKS_UPDATE_MANY = 'tasks.updateMany';
/** The bulk tools, each with the single tool that runs for every item. The AI switch of a bulk tool is the switch of its single tool. */
export const BULK_TOOLS: Readonly<Record<string, 'tasks.create' | 'tasks.update'>> = {
  [TASKS_CREATE_MANY]: 'tasks.create',
  [TASKS_UPDATE_MANY]: 'tasks.update',
};

export const MAX_CREATE_ITEMS = 50;
export const MAX_UPDATE_ITEMS = 100;

/** Each item is the input of tasks.create (it has no storyId: the story belongs to the whole batch). */
export const TasksCreateManyInput = z.object({
  items: z.array(sharedCalls['tasks.create'].input).min(1).max(MAX_CREATE_ITEMS).describe('The to-dos to make, 1 to 50. Each item is the input of tasks.create.'),
});

/** Each item is the input of tasks.update: id, patch, and the reason and dateReason of that item. */
export const TasksUpdateManyInput = z.object({
  items: z.array(sharedCalls['tasks.update'].input).min(1).max(MAX_UPDATE_ITEMS).describe('The changes, 1 to 100. Each item is the input of tasks.update: id, patch, and reason or dateReason for that item.'),
});

export const BULK_INPUTS = { [TASKS_CREATE_MANY]: TasksCreateManyInput, [TASKS_UPDATE_MANY]: TasksUpdateManyInput } as const;

/** One item as the agent reads it: a short row, or the error of the single call. */
export type BulkRow =
  | { index: number; ok: true; id: string; title: string; stageId: string | null; status: string }
  | { index: number; ok: false; error: RunError };
export type BulkAnswer = { storyId: string; done: number; failed: number; results: BulkRow[] };

/** Runs one call of the agent: a tool name and its arguments, through the run path of run.ts. */
export type RunOne = (tool: 'story.start' | 'tasks.create' | 'tasks.update', args: Record<string, unknown>) => Promise<RunResult>;

const invalid = (message: string, fields: string[]): RunResult => ({ ok: false, error: { code: 'invalid_input', message, details: { fields } } });

/** The short row of a task that a call gave back: TaskDetail holds the task in `task`. */
function rowOf(index: number, output: unknown): BulkRow {
  const task = (output as { task?: { id: string; title: string; stageId: string | null; status: string } } | null)?.task;
  if (!task) return { index, ok: false, error: { code: 'failed', message: 'The call gave no task.', details: {} } };
  return { index, ok: true, id: task.id, title: task.title, stageId: task.stageId ?? null, status: task.status };
}

export async function runBulk(name: string, args: Record<string, unknown>, runOne: RunOne): Promise<RunResult> {
  const single = BULK_TOOLS[name];
  const input = BULK_INPUTS[name as keyof typeof BULK_INPUTS];
  if (!single || !input) return invalid(`${name} is not a bulk tool.`, []);
  const { storyId: given, ...rest } = args;
  const parsed = input.safeParse(rest);
  if (!parsed.success) return invalid(`Send items: ${name === TASKS_CREATE_MANY ? '1 to 50 to-dos' : '1 to 100 changes'}.`, ['items']);
  // The items go as the agent sent them: the single call parses each one again with its own wire form.
  const items = (rest as { items: Record<string, unknown>[] }).items;

  let storyId: string;
  if (typeof given === 'string' && given !== '') storyId = given;
  else {
    const started = await runOne('story.start', {});
    if (!started.ok) return started;
    storyId = String((started.output as { storyId: string }).storyId);
  }

  const results: BulkRow[] = [];
  for (const [index, item] of items.entries()) {
    const result = await runOne(single, { ...item, storyId });
    // A story that is not the agent's fails every item the same way: stop at once, with nothing changed.
    if (!result.ok && index === 0 && result.error.details?.reason === 'story_not_yours') return result;
    results.push(result.ok ? rowOf(index, result.output) : { index, ok: false, error: result.error });
  }
  const done = results.filter((row) => row.ok).length;
  const answer: BulkAnswer = { storyId, done, failed: results.length - done, results };
  return { ok: true, output: answer, changed: done > 0 };
}
