import { beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_RIGHT_IDS } from '../../src/api/rightsCatalog';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { call, world as makeWorld, MCP_URL, TOKEN } from './bulk.testing';
import { readFirstAnswer } from './docs';
import { mcpTools, wireTool } from './tools';

/**
 * The size of the tool list (owner, 2026-10-26). The Admin's list was about 156 KB of JSON for about 160 tools, and a client keeps the whole
 * list in the context of the model. The schemas lose what the server checks anyway and what the TOOL_DOCS say already: the long patterns, the
 * id patterns, the story text, the 120 right ids that appeared twice, the empty defaults. The server still checks every rule: the zod input of
 * a tool is untouched, and the MCP layer validates with it. These two numbers must not grow back:
 *   - the whole tools/list of an Admin stays under 110 KB (110,000 bytes);
 *   - no single tool (name, title, description, schema, annotations) is over 2 KB (2,048 bytes).
 * Before: 167,428 bytes and 10 tools over 2 KB (roles.update 5,709, roles.create 5,597, projects.create 4,942).
 */
const LIST_LIMIT = 110_000;
const TOOL_LIMIT = 2_048;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

const wireOf = (tool: ReturnType<typeof mcpTools>[number]) => ({ name: tool.name, ...wireTool(tool), inputSchema: tool.inputSchema });

describe('the size of the tool list of an Admin', () => {
  it('stays under 110 KB for the whole list, and no tool is over 2 KB', () => {
    const tools = mcpTools({ admin: true });
    const sizes = tools.map((tool) => [tool.name, bytes(wireOf(tool))] as const).sort((a, b) => b[1] - a[1]);
    const total = bytes(tools.map(wireOf));
    expect(sizes.filter(([, size]) => size > TOOL_LIMIT), 'tools over 2 KB').toEqual([]);
    expect(total, `the list is ${total} bytes; the largest tools are ${sizes.slice(0, 5).map(([name, size]) => `${name} ${size}`).join(', ')}`).toBeLessThan(LIST_LIMIT);
  });

  it('is the same size in the real tools/list answer of the MCP server', async () => {
    const w = makeWorld(seed, 'usr_001');
    const response = await w.app.fetch(new Request('http://127.0.0.1/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN.token}`,
        'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test-agent', version: '1.0.0' } } },
      }),
    }));
    const body = JSON.parse(await response.text()) as { result: { tools: unknown[] } };
    expect(body.result.tools.length).toBe(mcpTools({ admin: true }).length);
    expect(bytes(body.result.tools)).toBeLessThan(LIST_LIMIT + 4_000);
    expect(MCP_URL).toContain('/mcp');
  });
});

describe('the slim schemas keep every rule on the server', () => {
  it('gives the right IDs of a role as plain strings, once, and the server still refuses an unknown ID', async () => {
    for (const name of ['roles.create', 'roles.update']) {
      const tool = mcpTools({ admin: true }).find((item) => item.name === name)!;
      const text = JSON.stringify(tool.inputSchema);
      expect(text, name).not.toContain('task.deleteOwn');
      expect(text, name).not.toContain('project.create');
      expect(bytes(wireOf(tool)), name).toBeLessThan(1_500);
      expect(tool.description, name).toContain('madar.readFirst');
    }
    const w = makeWorld(seed, 'usr_001');
    const refused = await call(w, 'roles.create', { name: 'Site supervisors', nameAr: 'مشرفو المواقع', rights: ['not.a.right'] });
    expect(refused.isError).toBe(true);
    // The check of the tool names the field, and its answer lists the valid IDs, so the agent can correct itself.
    expect(JSON.stringify(refused)).toContain('rights.0');
    expect(JSON.stringify(refused)).toContain('task.deleteOwn');
    expect((w.mem.tables.state.settings.roles?.custom ?? []).some((role) => role.name === 'Site supervisors')).toBe(false);
  });

  it('tells the Admin where to read the right IDs: madar.readFirst lists all of them, and no other person gets the list', () => {
    const admin = readFirstAnswer({ name: 'Hala', systemRole: 'admin' }, undefined, [...CATALOG_RIGHT_IDS, 'admin.manage']);
    expect(admin).toContain('Switch IDs for roles.create and roles.update');
    for (const id of CATALOG_RIGHT_IDS) expect(admin, id).toContain(id);
    const member = readFirstAnswer({ name: 'Reem', systemRole: 'member' }, undefined, ['ai.connect']);
    expect(member).not.toContain('Switch IDs for roles.create and roles.update');
  });

  it('keeps the zod input of each tool whole: a wrong ID shape, a long text and a story text are still refused by the check of the tool', () => {
    const tools = mcpTools({ admin: true });
    const byName = (name: string) => tools.find((tool) => tool.name === name)!;
    expect(byName('tasks.get').input.safeParse({ id: 'abc' }).success).toBe(false);
    expect(byName('projects.get').input.safeParse({ id: 'prj_1' }).success).toBe(false);
    expect(byName('projects.get').input.safeParse({ id: 'prj_001' }).success).toBe(true);
    expect(byName('users.create').input.safeParse({ name: 'X', email: 'not an email', discipline: 'D' }).success).toBe(false);
    expect(byName('tasks.create').input.safeParse({ projectId: 'prj_001', title: 'X', storyId: '' }).success).toBe(false);
    expect(byName('projects.create').input.safeParse({ name: 'X', codeParts: { initials: 'ab', classification: 'RES', type: 'Villa' } }).success).toBe(false);
  });

  it('keeps a short hint for the story ID, the dates and the initials, so the model knows the shape', () => {
    const tool = mcpTools({ admin: true }).find((item) => item.name === 'projects.create')!;
    const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties.storyId).toBeDefined();
    expect(JSON.stringify(properties.startDate)).toContain('"format":"date"');
    expect(JSON.stringify(properties.codeParts)).toContain('[A-Z]{3,4}');
  });
});

describe('a full read of one project template (owner, 2026-10-26)', () => {
  it('gives projectTemplates.list an id argument that returns the whole template, so an agent can read it before projectTemplates.save', async () => {
    const w = makeWorld(seed, 'usr_001');
    const all = await call(w, 'projectTemplates.list', {});
    const rows = all.structuredContent.output as { id: string; stageNames: string[]; taskCount: number }[];
    expect(rows.length).toBeGreaterThan(0);
    // The list stays lean. The id gives the same template with its stages, its tasks and its roles in full, as the screens edit it.
    expect(rows[0]).not.toHaveProperty('tasks');
    const one = await call(w, 'projectTemplates.list', { id: rows[0].id });
    expect(one.isError, JSON.stringify(one)).toBeUndefined();
    const full = one.structuredContent.output as { id: string; stages: unknown[]; tasks: unknown[]; roles: unknown[] }[];
    expect(full).toHaveLength(1);
    expect(full[0]).toMatchObject({ id: rows[0].id });
    expect(full[0].stages.length).toBe(rows[0].stageNames.length);
    expect(full[0].tasks.length).toBe(rows[0].taskCount);
    const missing = await call(w, 'projectTemplates.list', { id: 'ptp_404' });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.error).toMatchObject({ code: 'not_found' });
  });
});
