import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { call, world, type World } from './bulk.testing';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { DEFAULT_LIMIT, MAX_LIMIT, pageOf, pagingOf } from './paging';
import { mcpTools } from './tools';

/**
 * Long lists (owner, 2026-10-26): projects.list and tasks.list take limit (default 50, at most 200), offset and full, in the MCP layer only.
 * They give a page of short rows and `page: { total, offset, limit, next }` beside `output`; full: true gives the full rows of the screens.
 */

let seed: State;
let admin: World;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
  admin = world(seed, 'usr_001');
});

const SHORT_PROJECT = ['code', 'health', 'id', 'kind', 'leaderName', 'name', 'nameAr', 'nextDeadline', 'stageName', 'status'];
const SHORT_TASK = ['dueDate', 'flagged', 'id', 'ownerId', 'ownerName', 'projectCode', 'projectId', 'projectName', 'stageId', 'stageName', 'status', 'title'];
type Page = { total: number; offset: number; limit: number; next: number | null };
const ids = (output: { id: string }[]) => output.map((row) => row.id);

describe('the paging helpers', () => {
  it('give the defaults, cut a value into range, and name the next offset', () => {
    expect(pagingOf({})).toEqual({ limit: DEFAULT_LIMIT, offset: 0, full: false });
    expect(DEFAULT_LIMIT).toBe(50);
    expect(MAX_LIMIT).toBe(200);
    expect(pagingOf({ limit: 999, offset: -4, full: true })).toEqual({ limit: 200, offset: 0, full: true });
    expect(pagingOf({ limit: 0 }).limit).toBe(1);
    const rows = Array.from({ length: 12 }, (_, i) => i);
    expect(pageOf(rows, { limit: 5, offset: 0, full: false })).toEqual({ rows: [0, 1, 2, 3, 4], page: { total: 12, offset: 0, limit: 5, next: 5 } });
    expect(pageOf(rows, { limit: 5, offset: 10, full: false })).toEqual({ rows: [10, 11], page: { total: 12, offset: 10, limit: 5, next: null } });
    expect(pageOf(rows, { limit: 12, offset: 0, full: false }).page.next).toBeNull();
    expect(pageOf(rows, { limit: 5, offset: 40, full: false })).toEqual({ rows: [], page: { total: 12, offset: 40, limit: 5, next: null } });
  });
});

describe('the three arguments in the tool schema', () => {
  it('belong to projects.list and tasks.list only', () => {
    const tools = mcpTools({ admin: true });
    for (const name of ['projects.list', 'tasks.list']) {
      const tool = tools.find((t) => t.name === name)!;
      const properties = tool.inputSchema.properties as Record<string, { type?: string }>;
      expect(Object.keys(properties), name).toEqual(expect.arrayContaining(['limit', 'offset', 'full']));
      // The list schema leaves the bounds out (toolSize.test.ts); the text of the tool names the 200, and the check of the tool keeps 1 to 200 and 0 up.
      expect(tool.description, name).toContain('at most 200');
      expect(tool.input.safeParse({ limit: 200, offset: 0 }).success, name).toBe(true);
      expect(tool.input.safeParse({ limit: 0 }).success, name).toBe(false);
    }
    // Other tools keep their own limit and have no offset or full.
    for (const name of ['events.list', 'updates.list', 'chats.messages', 'deadlines.list']) {
      const properties = Object.keys(tools.find((t) => t.name === name)!.inputSchema.properties as object);
      expect(properties, name).not.toContain('offset');
      expect(properties, name).not.toContain('full');
    }
    const list = mcpTools({ admin: true }).find((t) => t.name === 'tasks.list')!;
    expect(list.input.safeParse({ limit: 201 }).success).toBe(false);
    expect(list.input.safeParse({ offset: -1 }).success).toBe(false);
    expect(list.input.safeParse({ limit: 200, offset: 0, full: true }).success).toBe(true);
  });

  it('are named in both docs, within 600 characters, and in INSTRUCTIONS', () => {
    for (const name of ['projects.list', 'tasks.list']) {
      const doc = TOOL_DOCS[name].description;
      for (const word of ['limit', 'offset', 'page.next', 'full', '200']) expect(doc, `${name} ${word}`).toContain(word);
      expect(doc.length, name).toBeLessThanOrEqual(600);
      expect(doc, name).not.toMatch(/[–—]/);
    }
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Long lists: '))!;
    for (const word of ['projects.list', 'tasks.list', 'limit', 'offset', 'page.next', 'full: true']) expect(line, word).toContain(word);
  });
});

describe('projects.list over MCP', () => {
  it('gives short rows with only the listed keys, and a page that holds all the projects', async () => {
    const result = await call(admin, 'projects.list', {});
    expect(result.isError).toBeUndefined();
    const rows = result.structuredContent.output as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(SHORT_PROJECT);
    expect(result.structuredContent.page).toEqual({ total: rows.length, offset: 0, limit: 50, next: null });
    expect(rows[0]).toMatchObject({ id: expect.stringMatching(/^prj_/), code: expect.any(String), name: expect.any(String), status: 'active', stageName: expect.any(String), leaderName: expect.any(String) });
    // Without full there is no tile drawing and no client record.
    expect(JSON.stringify(rows)).not.toContain('<svg');
  });

  it('cuts a page and gives the right next', async () => {
    const all = (await call(admin, 'projects.list', {})).structuredContent.output as { id: string }[];
    const one = await call(admin, 'projects.list', { limit: 5 });
    expect(ids(one.structuredContent.output)).toEqual(ids(all).slice(0, 5));
    expect(one.structuredContent.page).toEqual({ total: all.length, offset: 0, limit: 5, next: 5 });
    const two = await call(admin, 'projects.list', { limit: 5, offset: 5 });
    expect(ids(two.structuredContent.output)).toEqual(ids(all).slice(5, 10));
    const last = await call(admin, 'projects.list', { limit: 5, offset: all.length - 2 });
    expect(last.structuredContent.output).toHaveLength(2);
    expect(last.structuredContent.page.next).toBeNull();
    const beyond = await call(admin, 'projects.list', { limit: 5, offset: 500 });
    expect(beyond.structuredContent.output).toEqual([]);
    expect(beyond.structuredContent.page).toEqual({ total: all.length, offset: 500, limit: 5, next: null });
  });

  it('still takes the filters of the call, and counts the total after the filter', async () => {
    const mine = await call(world(seed, 'usr_002'), 'projects.list', { filter: 'mine' });
    const all = await call(admin, 'projects.list', {});
    expect(mine.structuredContent.page.total).toBeLessThan(all.structuredContent.page.total);
    expect(mine.structuredContent.page.total).toBe(mine.structuredContent.output.length);
  });

  it('gives the full rows as today with full: true, cut to the same page', async () => {
    const short = await call(admin, 'projects.list', { limit: 3 });
    const full = await call(admin, 'projects.list', { limit: 3, full: true });
    expect(full.structuredContent.page).toEqual(short.structuredContent.page);
    const rows = full.structuredContent.output as { project: { id: string }; look: { tile: string }; stages: unknown[]; client: unknown; viewerCan: unknown; team: unknown[] }[];
    expect(rows.map((row) => row.project.id)).toEqual(ids(short.structuredContent.output));
    for (const row of rows) {
      expect(Object.keys(row)).toEqual(expect.arrayContaining(['project', 'client', 'health', 'stages', 'currentStage', 'team', 'viewerCan', 'look']));
      expect(row.look.tile).toContain('<svg');
    }
  });
});

describe('tasks.list over MCP', () => {
  it('gives 50 short rows by default, with only the listed keys, and a next offset', async () => {
    const result = await call(admin, 'tasks.list', {});
    expect(result.isError).toBeUndefined();
    const rows = result.structuredContent.output as Record<string, unknown>[];
    const page = result.structuredContent.page as Page;
    expect(page.total).toBeGreaterThan(100);
    expect(rows).toHaveLength(50);
    expect(page).toEqual({ total: page.total, offset: 0, limit: 50, next: 50 });
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(SHORT_TASK);
    const named = rows.find((row) => row.projectId !== null && row.ownerId !== null)!;
    expect(named).toMatchObject({ projectCode: expect.any(String), projectName: expect.any(String), stageName: expect.any(String), ownerName: expect.any(String) });
  });

  it('walks every page with next and meets each task once', async () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    let total = 0;
    while (offset !== null) {
      const result: Record<string, any> = await call(admin, 'tasks.list', { limit: 60, offset });
      seen.push(...ids(result.structuredContent.output));
      total = result.structuredContent.page.total;
      offset = result.structuredContent.page.next;
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    // The pages together are the whole list that the full form gives.
    const everything = (await call(admin, 'tasks.list', { limit: 200, full: true })).structuredContent.output as { task: { id: string } }[];
    expect(everything.map((row) => row.task.id)).toEqual(seen.slice(0, 200));
  });

  it('gives the full rows as today with full: true', async () => {
    const result = await call(admin, 'tasks.list', { limit: 2, full: true, projectId: 'prj_001' });
    const rows = result.structuredContent.output as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(['task', 'owner', 'helpers', 'project', 'stage', 'commentCount', 'overdue', 'canMove', 'waitingFor']));
    expect(result.structuredContent.page).toMatchObject({ limit: 2, offset: 0, next: 2 });
  });

  it('keeps the filters: a short row of a project filter names that project', async () => {
    const result = await call(admin, 'tasks.list', { projectId: 'prj_001' });
    const rows = result.structuredContent.output as { projectId: string; projectCode: string; projectName: string }[];
    expect(rows).toHaveLength(13);
    expect(rows.every((row) => row.projectId === 'prj_001' && row.projectCode === 'KH-26-001' && row.projectName === 'Corniche Office Tower')).toBe(true);
    expect(result.structuredContent.page).toEqual({ total: 13, offset: 0, limit: 50, next: null });
  });

  it('is less than half of the full form for the same rows', async () => {
    const short = JSON.stringify((await call(admin, 'tasks.list', { limit: 50 })).structuredContent);
    const full = JSON.stringify((await call(admin, 'tasks.list', { limit: 50, full: true })).structuredContent);
    expect(short.length).toBeLessThan(full.length * 0.5);
  });
});
