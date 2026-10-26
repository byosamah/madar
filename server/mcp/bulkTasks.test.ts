import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { giveRole, roleWithout } from './aiRoles.testing';
import { aiSwitchOf } from './aiSwitches';
import { call, world, type World } from './bulk.testing';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_BY_RIGHT, MCP_DENY, NO_CALL_TOOLS, mcpTools } from './tools';

/**
 * The bulk tools tasks.createMany and tasks.updateMany (owner, 2026-10-26). Each runs its items in order through the same run path and rights as
 * tasks.create and tasks.update, in one story, and a failed item does not stop the next. In the sample office usr_002 leads prj_001 (current
 * stage Permits, stg_005), usr_005 is on its team, and usr_003 is not on it.
 */

const PROJECT = 'prj_001';
const STAGE = 'stg_005';
let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

const tasksOf = (w: World) => Object.values(w.mem.tables.state.tasks);
const item = (n: number, extra: Record<string, unknown> = {}) => ({ projectId: PROJECT, title: `Bulk to-do ${n}`, stageId: STAGE, ownerId: 'usr_002', ...extra });
type Result = { index: number; ok: boolean; id?: string; title?: string; stageId?: string | null; status?: string; error?: { code: string; message: string; details: Record<string, unknown> } };

describe('the two bulk tools are tools (owner, 2026-10-26)', () => {
  const bulk = ['tasks.createMany', 'tasks.updateMany'];

  it('sit in the allowlist only, have no call of their own, and belong to the AI switch of their single call', () => {
    for (const name of bulk) {
      expect(MCP_ALLOW, name).toContain(name);
      expect(MCP_DENY as readonly string[], name).not.toContain(name);
      expect(Object.keys(MCP_BY_RIGHT), name).not.toContain(name);
      expect(NO_CALL_TOOLS.has(name), name).toBe(true);
    }
    expect(aiSwitchOf('tasks.createMany')).toBe(aiSwitchOf('tasks.create'));
    expect(aiSwitchOf('tasks.updateMany')).toBe(aiSwitchOf('tasks.update'));
    expect(aiSwitchOf('tasks.createMany')).toBe('ai.todos');
  });

  it('are writes that take a story; createMany only adds, updateMany changes', () => {
    const tools = mcpTools();
    const create = tools.find((t) => t.name === 'tasks.createMany')!;
    const update = tools.find((t) => t.name === 'tasks.updateMany')!;
    for (const tool of [create, update]) {
      expect(tool.readOnly).toBe(false);
      expect(tool.takesStory).toBe(true);
      expect(Object.keys(tool.inputSchema.properties as object).sort()).toEqual(['items', 'storyId']);
      expect(tool.inputSchema.required).toEqual(['items']);
    }
    expect(create.annotations.destructiveHint).toBe(false);
    expect(update.annotations.destructiveHint).toBe(true);
  });

  it('take 1 to 50 and 1 to 100 items', () => {
    const tools = mcpTools();
    const create = tools.find((t) => t.name === 'tasks.createMany')!;
    const update = tools.find((t) => t.name === 'tasks.updateMany')!;
    const many = (count: number, make: (n: number) => unknown) => Array.from({ length: count }, (_, n) => make(n));
    expect(create.input.safeParse({ items: [] }).success).toBe(false);
    expect(create.input.safeParse({ items: many(50, item) }).success).toBe(true);
    expect(create.input.safeParse({ items: many(51, item) }).success).toBe(false);
    const change = (n: number) => ({ id: 'tsk_011', patch: { title: `T${n}` } });
    expect(update.input.safeParse({ items: [] }).success).toBe(false);
    expect(update.input.safeParse({ items: many(100, change) }).success).toBe(true);
    expect(update.input.safeParse({ items: many(101, change) }).success).toBe(false);
  });

  it('have short docs that name the items, the story, the failure rule and the reason request, and one line in INSTRUCTIONS', () => {
    for (const name of bulk) {
      const doc = TOOL_DOCS[name].description;
      expect(doc.length, name).toBeGreaterThanOrEqual(40);
      expect(doc.length, name).toBeLessThanOrEqual(600);
      for (const word of ['items', 'storyId', 'results']) expect(doc, `${name} ${word}`).toContain(word);
      expect(doc, name).not.toMatch(/[–—]/);
    }
    expect(TOOL_DOCS['tasks.createMany'].description).toContain('50');
    expect(TOOL_DOCS['tasks.updateMany'].description).toContain('100');
    expect(TOOL_DOCS['tasks.updateMany'].description).toContain('dateReason');
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Many to-dos: '))!;
    expect(line).toBeDefined();
    for (const word of ['tasks.createMany', 'tasks.updateMany', 'more than a few']) expect(line, word).toContain(word);
    expect(line).not.toMatch(/[–—]/);
  });
});

describe('tasks.createMany over MCP', () => {
  it('makes each item, answers short rows, and puts all the changes in one story that one Undo takes back', async () => {
    const w = world(seed, 'usr_002');
    const before = tasksOf(w).length;
    const result = await call(w, 'tasks.createMany', { items: [item(1), item(2, { flagged: true, dueDate: '2026-11-01' }), item(3)] });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const answer = result.structuredContent.output as { storyId: string; done: number; failed: number; results: Result[] };
    expect(Object.keys(answer).sort()).toEqual(['done', 'failed', 'results', 'storyId']);
    expect(answer).toMatchObject({ done: 3, failed: 0 });
    expect(answer.storyId).toMatch(/^sty_/);
    expect(tasksOf(w)).toHaveLength(before + 3);
    answer.results.forEach((row, index) => {
      expect(Object.keys(row).sort()).toEqual(['id', 'index', 'ok', 'stageId', 'status', 'title']);
      expect(row).toMatchObject({ index, ok: true, title: `Bulk to-do ${index + 1}`, stageId: STAGE, status: 'todo' });
      expect(w.mem.tables.state.tasks[row.id!]).toMatchObject({ title: row.title, ownerId: 'usr_002', flagged: index === 1 });
    });
    // One story for all items.
    const events = Object.values(w.mem.tables.state.events).filter((e) => e.verb === 'task.created' && e.actorId === w.agentId);
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.correlationId))).toEqual(new Set([answer.storyId]));
    expect(events.every((e) => e.actorKind === 'agent' && e.actingForId === 'usr_002')).toBe(true);
    // The answer holds no history and no full record, so it stays short.
    expect(JSON.stringify(result.structuredContent).length).toBeLessThan(1000);
    // One Undo takes them all back.
    const undone = await call(w, 'events.undoStory', { correlationId: answer.storyId });
    expect(undone.isError, JSON.stringify(undone)).toBeUndefined();
    expect(tasksOf(w)).toHaveLength(before);
  });

  it('uses the storyId that the agent gives, and counts as one tool call against the minute limit', async () => {
    const w = world(seed, 'usr_002');
    const story = (await call(w, 'story.start', {})).structuredContent.output.storyId as string;
    const hits = w.hits.count;
    const result = await call(w, 'tasks.createMany', { items: [item(1), item(2), item(3), item(4)], storyId: story });
    expect(w.hits.count - hits).toBe(1);
    expect(result.structuredContent.output.storyId).toBe(story);
    const events = Object.values(w.mem.tables.state.events).filter((e) => e.verb === 'task.created' && e.actorId === w.agentId);
    expect(events).toHaveLength(4);
    expect(events.every((e) => e.correlationId === story)).toBe(true);
  });

  it('fails a story that is not the agent\'s as a whole, with nothing changed', async () => {
    const w = world(seed, 'usr_002');
    const before = tasksOf(w).length;
    const result = await call(w, 'tasks.createMany', { items: [item(1), item(2)], storyId: 'sty_notmine' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: 'forbidden', details: { reason: 'story_not_yours' } });
    expect(tasksOf(w)).toHaveLength(before);
  });

  it('fails one bad item alone: the others still pass, and the failed one names its index and error', async () => {
    const w = world(seed, 'usr_002');
    const before = tasksOf(w).length;
    const result = await call(w, 'tasks.createMany', { items: [item(1), item(2, { projectId: 'prj_999', stageId: undefined }), item(3)] });
    expect(result.isError).toBeUndefined();
    const answer = result.structuredContent.output as { done: number; failed: number; results: Result[] };
    expect(answer).toMatchObject({ done: 2, failed: 1 });
    expect(answer.results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(answer.results[1]).toMatchObject({ index: 1, ok: false, error: { code: 'not_found' } });
    expect(Object.keys(answer.results[1]).sort()).toEqual(['error', 'index', 'ok']);
    expect(tasksOf(w)).toHaveLength(before + 2);
  });

  it('gives a forbidden item the same error as the single call', async () => {
    const w = world(seed, 'usr_003');
    const single = await call(w, 'tasks.create', item(1));
    expect(single.isError).toBe(true);
    const result = await call(w, 'tasks.createMany', { items: [item(1), item(2)] });
    const answer = result.structuredContent.output as { done: number; failed: number; results: Result[] };
    expect(answer).toMatchObject({ done: 0, failed: 2 });
    for (const row of answer.results) expect(row.error).toEqual(single.structuredContent.error);
  });

  it('asks the reason of the one item that moves the project back, and the others pass', async () => {
    const w = world(seed, 'usr_002');
    const result = await call(w, 'tasks.createMany', { items: [item(1), item(2, { stageId: 'stg_002' }), item(3)] });
    const answer = result.structuredContent.output as { done: number; failed: number; results: Result[] };
    expect(answer).toMatchObject({ done: 2, failed: 1 });
    expect(answer.results[1].error).toMatchObject({ code: 'invalid_input', details: { reason: 'stage_back_reason' } });
    // The item goes again with its reason, in a batch of its own.
    const again = await call(w, 'tasks.createMany', { items: [item(2, { stageId: 'stg_002', reason: 'The client asked for a new option.' })] });
    expect(again.structuredContent.output).toMatchObject({ done: 1, failed: 0 });
  });

  it('is refused with ai_off when the AI switch ai.todos is off, like tasks.create', async () => {
    const w = world(seed, 'usr_002', (state) => void giveRole(state, 'usr_002', roleWithout(['ai.todos'])));
    const before = tasksOf(w).length;
    const single = await call(w, 'tasks.create', item(1));
    const result = await call(w, 'tasks.createMany', { items: [item(1)] });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.todos' } });
    expect(result.structuredContent.error).toEqual(single.structuredContent.error);
    expect(tasksOf(w)).toHaveLength(before);
  });
});

describe('tasks.updateMany over MCP', () => {
  it('changes each item, moves many to-dos to a stage in one call, and shares one story', async () => {
    const w = world(seed, 'usr_002');
    const result = await call(w, 'tasks.updateMany', {
      items: [{ id: 'tsk_011', patch: { title: 'Balady set, final' } }, { id: 'tsk_012', patch: { flagged: true } }, { id: 'tsk_009', patch: { stageId: 'stg_005' } }],
    });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const answer = result.structuredContent.output as { storyId: string; done: number; failed: number; results: Result[] };
    expect(answer).toMatchObject({ done: 3, failed: 0 });
    expect(answer.results.map((r) => r.id)).toEqual(['tsk_011', 'tsk_012', 'tsk_009']);
    expect(answer.results[0]).toMatchObject({ index: 0, ok: true, title: 'Balady set, final', stageId: STAGE, status: 'todo' });
    expect(answer.results[2]).toMatchObject({ stageId: STAGE });
    const tasks = w.mem.tables.state.tasks;
    expect(tasks.tsk_011.title).toBe('Balady set, final');
    expect(tasks.tsk_012.flagged).toBe(true);
    expect(tasks.tsk_009.stageId).toBe(STAGE);
    const events = Object.values(w.mem.tables.state.events).filter((e) => e.correlationId === answer.storyId);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every((e) => e.actorKind === 'agent')).toBe(true);
    expect(JSON.stringify(result.structuredContent).length).toBeLessThan(1000);
    // One Undo takes the whole batch back.
    expect((await call(w, 'events.undoStory', { correlationId: answer.storyId })).isError).toBeUndefined();
    expect(w.mem.tables.state.tasks.tsk_011.title).toBe('Balady submission set');
    expect(w.mem.tables.state.tasks.tsk_009.stageId).toBe('stg_004');
  });

  it('fails one bad item alone', async () => {
    const w = world(seed, 'usr_002');
    const result = await call(w, 'tasks.updateMany', { items: [{ id: 'tsk_011', patch: { flagged: true } }, { id: 'tsk_999', patch: { flagged: true } }, { id: 'tsk_012', patch: { flagged: true } }] });
    const answer = result.structuredContent.output as { done: number; failed: number; results: Result[] };
    expect(answer).toMatchObject({ done: 2, failed: 1 });
    expect(answer.results[1]).toMatchObject({ index: 1, ok: false, error: { code: 'not_found' } });
    expect(w.mem.tables.state.tasks.tsk_012.flagged).toBe(true);
  });

  it('gives a forbidden item the same error as the single call', async () => {
    const w = world(seed, 'usr_003');
    const single = await call(w, 'tasks.update', { id: 'tsk_011', patch: { flagged: true } });
    expect(single.isError).toBe(true);
    const result = await call(w, 'tasks.updateMany', { items: [{ id: 'tsk_011', patch: { flagged: true } }] });
    const answer = result.structuredContent.output as { failed: number; results: Result[] };
    expect(answer.failed).toBe(1);
    expect(answer.results[0].error).toEqual(single.structuredContent.error);
    expect(w.mem.tables.state.tasks.tsk_011.flagged).toBe(false);
  });

  it('asks the reason of the one item that moves back, then takes the item again with its reason', async () => {
    const w = world(seed, 'usr_002');
    const result = await call(w, 'tasks.updateMany', { items: [{ id: 'tsk_011', patch: { stageId: 'stg_002' } }, { id: 'tsk_012', patch: { flagged: true } }] });
    const answer = result.structuredContent.output as { done: number; failed: number; results: Result[] };
    expect(answer).toMatchObject({ done: 1, failed: 1 });
    expect(answer.results[0].error).toMatchObject({ code: 'invalid_input', details: { reason: 'stage_back_reason' } });
    expect(answer.results[1].ok).toBe(true);
    expect(w.mem.tables.state.tasks.tsk_011.stageId).toBe(STAGE);
    const again = await call(w, 'tasks.updateMany', { items: [{ id: 'tsk_011', patch: { stageId: 'stg_002' }, reason: 'The client reopened the concept.' }] });
    expect(again.structuredContent.output).toMatchObject({ done: 1, failed: 0 });
    expect(w.mem.tables.state.tasks.tsk_011.stageId).toBe('stg_002');
  });

  it('asks the dateReason of the one item that moves a date that was set', async () => {
    const w = world(seed, 'usr_002');
    const result = await call(w, 'tasks.updateMany', { items: [{ id: 'tsk_011', patch: { dueDate: '2026-12-01' } }, { id: 'tsk_012', patch: { flagged: true } }] });
    const answer = result.structuredContent.output as { results: Result[] };
    expect(answer.results[0].error).toMatchObject({ details: { reason: 'date_reason_needed' } });
    expect(answer.results[1].ok).toBe(true);
    const again = await call(w, 'tasks.updateMany', { items: [{ id: 'tsk_011', patch: { dueDate: '2026-12-01' }, dateReason: 'The client moved the meeting.' }] });
    expect(again.structuredContent.output).toMatchObject({ done: 1, failed: 0 });
    expect(w.mem.tables.state.tasks.tsk_011.dueDate).toBe('2026-12-01');
  });

  it('is refused with ai_off when the AI switch ai.todos is off, like tasks.update', async () => {
    const w = world(seed, 'usr_002', (state) => void giveRole(state, 'usr_002', roleWithout(['ai.todos'])));
    const result = await call(w, 'tasks.updateMany', { items: [{ id: 'tsk_011', patch: { flagged: true } }] });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.todos' } });
    expect(w.mem.tables.state.tasks.tsk_011.flagged).toBe(false);
  });
});
