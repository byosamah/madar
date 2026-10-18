import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { SERVER_CALL_NAMES, serverContracts } from '../../src/api/contract/server';
import { sharedCalls } from '../../src/api/sharedCalls';
import { recordSamples } from '../../scripts/record-samples';
import { INSTRUCTIONS, TOOL_DOCS, readFirstAnswer } from './docs';
import { MCP_ADMIN, MCP_ALLOW, MCP_DENY, READ_FIRST, mcpTools } from './tools';

/** The recorded sample input of each tool (scripts/record-samples.ts writes it from runs on the sample office). */
const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>>;

const callNames = [...Object.keys(sharedCalls), ...SERVER_CALL_NAMES];
const allDefs: Record<string, { readOnly?: boolean }> = { ...sharedCalls, ...serverContracts };

/** Ajv for JSON Schema 2020-12, with the two string formats that zod writes for Madar dates. */
function makeAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  ajv.addFormat('date-time', { validate: (value: string) => /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)) });
  return ajv;
}

describe('the MCP tool list (plan 5.6, change 20)', () => {
  /** The tools of an agent whose person is not an Admin, and of an agent of an Admin (owner, 2026-10-07). */
  const tools = mcpTools();
  const adminTools = mcpTools({ admin: true });
  const allowAndAdmin = [...MCP_ALLOW, ...MCP_ADMIN];

  it('has the 44 tools of the allowlist, each once', () => {
    expect(MCP_ALLOW).toHaveLength(44);
    expect(new Set(MCP_ALLOW).size).toBe(44);
    // An agent takes a task with no lead for its person (owner, 2026-10-05).
    expect(MCP_ALLOW).toContain('tasks.take');
    expect(tools.map((tool) => tool.name).sort()).toEqual([...MCP_ALLOW].sort());
  });

  it('keeps live.ticket from every agent (exit wave 3): an agent opens no socket', () => {
    expect(MCP_DENY).toContain('live.ticket');
    for (const admin of [false, true]) expect(mcpTools({ admin }).map((tool) => tool.name)).not.toContain('live.ticket');
  });

  // Owner, 2026-10-12: an agent may message the team, direct and in a project chat (task comments and project posts it has already).
  // It sends, finds and reads the chats of its person (fbk_011, owner 2026-10-18). It never marks a chat read or archives one.
  it('lets an agent message the team and read the chats of its person, and keeps the read marks and the archive from it', () => {
    for (const name of ['chats.openDirect', 'chats.list', 'chats.send', 'chats.messages', 'chats.waiting']) {
      expect(MCP_ALLOW, name).toContain(name);
      expect(MCP_DENY, name).not.toContain(name);
      expect(tools.map((tool) => tool.name), name).toContain(name);
    }
    for (const name of ['chats.markRead', 'chats.unreadCount', 'chats.archive']) {
      expect(MCP_DENY, name).toContain(name);
      expect(tools.map((tool) => tool.name), name).not.toContain(name);
    }
    // Group work is screen work: an agent sends to a group, but it does not make, rename or leave one.
    for (const name of ['chats.createGroup', 'chats.updateGroup', 'chats.leaveGroup']) expect(MCP_DENY, name).toContain(name);
    expect(tools.find((tool) => tool.name === 'chats.list')!.readOnly).toBe(true);
    expect(tools.find((tool) => tool.name === 'chats.messages')!.readOnly).toBe(true);
    expect(tools.find((tool) => tool.name === 'chats.waiting')!.readOnly).toBe(true);
    // A sent message reaches real people at once and no Undo takes it back, so the client may ask its person first.
    for (const name of ['chats.openDirect', 'chats.send']) expect(tools.find((tool) => tool.name === name)!.annotations.destructiveHint, name).toBe(true);
  });

  it('adds the 3 Admin tools of requests and bugs only to the list of an agent of an Admin: 47 tools (owner, 2026-10-7)', () => {
    expect([...MCP_ADMIN]).toEqual(['feedback.list', 'feedback.screenshot', 'feedback.setStatus']);
    expect(tools).toHaveLength(44);
    expect(tools.filter((tool) => tool.name.startsWith('feedback.'))).toEqual([]);
    expect(adminTools).toHaveLength(47);
    expect(adminTools.map((tool) => tool.name).sort()).toEqual([...allowAndAdmin].sort());
    // The default list is the Admin list without the 3 tools, in the same order.
    expect(tools.map((tool) => tool.name)).toEqual(adminTools.map((tool) => tool.name).filter((name) => !(MCP_ADMIN as readonly string[]).includes(name)));
    // A report comes in from the screens only: an agent never sends one or starts its upload.
    for (const name of ['feedback.send', 'feedback.uploadStart']) expect(MCP_DENY).toContain(name);
  });

  it('never offers a push device call to an agent: the three push calls are on the deny list (owner, 2026-10-08)', () => {
    for (const name of ['push.register', 'push.remove', 'push.mine']) {
      expect(MCP_DENY, name).toContain(name);
      expect(allowAndAdmin as readonly string[], name).not.toContain(name);
      expect(adminTools.map((tool) => tool.name), name).not.toContain(name);
      expect(Object.keys(TOOL_DOCS), name).not.toContain(name);
      expect(Object.keys(samples), name).not.toContain(name);
    }
  });

  it('puts every call in exactly one of the allowlist, the Admin list and the deny list', () => {
    const allow = new Set<string>(MCP_ALLOW);
    const admin = new Set<string>(MCP_ADMIN);
    const deny = new Set<string>(MCP_DENY);
    expect(callNames.filter((name) => !allow.has(name) && !admin.has(name) && !deny.has(name))).toEqual([]);
    expect([...allow].filter((name) => deny.has(name) || admin.has(name))).toEqual([]);
    expect([...admin].filter((name) => deny.has(name))).toEqual([]);
    // Each listed name is a real call; the only tool with no call is madar.readFirst.
    expect([...allow, ...admin, ...deny].filter((name) => name !== READ_FIRST && !callNames.includes(name))).toEqual([]);
    expect(deny.size).toBe(MCP_DENY.length);
    expect(admin.size).toBe(3);
  });

  it('never allows a call that the server does not run', () => {
    for (const name of ['session.previewAs', 'session.setSimulateErrors', 'session.resetSampleData', 'files.get']) {
      expect(MCP_ALLOW).not.toContain(name);
    }
  });

  it('keeps a fixed order in both lists: madar.readFirst, story.start, then by name', () => {
    for (const list of [tools, adminTools]) {
      const names = list.map((tool) => tool.name);
      expect(names.slice(0, 2)).toEqual([READ_FIRST, 'story.start']);
      const rest = names.slice(2);
      expect(rest).toEqual([...rest].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    expect(mcpTools().map((tool) => tool.name)).toEqual(tools.map((tool) => tool.name));
    expect(mcpTools({ admin: true }).map((tool) => tool.name)).toEqual(adminTools.map((tool) => tool.name));
    // The feedback tools sort between events.undoStory and files.list.
    const names = adminTools.map((tool) => tool.name);
    expect(names.slice(names.indexOf('events.undoStory'), names.indexOf('files.list') + 1)).toEqual(['events.undoStory', ...MCP_ADMIN, 'files.list']);
  });

  it('gives each tool a title and a description of 40 to 600 characters', () => {
    for (const tool of adminTools) {
      expect(tool.title.length, tool.name).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeGreaterThanOrEqual(40);
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(600);
      expect(TOOL_DOCS[tool.name], tool.name).toBeDefined();
    }
    expect(Object.keys(TOOL_DOCS).sort()).toEqual([...allowAndAdmin].sort());
  });

  it('marks reads as read-only and writes as not, from the call contracts', () => {
    for (const tool of adminTools) {
      const readOnly = tool.name === READ_FIRST ? true : Boolean(allDefs[tool.name].readOnly);
      expect(tool.readOnly, tool.name).toBe(readOnly);
      expect(tool.annotations.readOnlyHint, tool.name).toBe(readOnly);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
      if (!readOnly) expect(typeof tool.annotations.destructiveHint, tool.name).toBe('boolean');
    }
    expect(tools.filter((tool) => tool.readOnly)).toHaveLength(19);
    // feedback.list and feedback.screenshot are reads of an agent of an Admin.
    expect(adminTools.filter((tool) => tool.readOnly)).toHaveLength(21);
    for (const name of ['feedback.list', 'feedback.screenshot']) expect(adminTools.find((tool) => tool.name === name)!.annotations.readOnlyHint, name).toBe(true);
    // An undo can remove a record, so the client may ask its person first.
    expect(tools.find((tool) => tool.name === 'events.undo')!.annotations.destructiveHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'tasks.create')!.annotations.destructiveHint).toBe(false);
  });

  it('marks every write that changes or removes a record as destructive, and only the pure adds as not (MCP: false means additive only)', () => {
    const additive = ['story.start', 'tasks.create', 'comments.create', 'updates.create', 'tracker.log', 'payments.create', 'deadlines.create'];
    for (const tool of adminTools.filter((t) => !t.readOnly)) {
      expect(tool.annotations.destructiveHint, tool.name).toBe(!additive.includes(tool.name));
    }
    for (const name of ['payments.update', 'projects.setStatus', 'tasks.update', 'tracker.close']) {
      expect(tools.find((tool) => tool.name === name)!.annotations.destructiveHint, name).toBe(true);
    }
    expect(tools.filter((tool) => !tool.readOnly && tool.annotations.destructiveHint)).toHaveLength(18);
    expect(adminTools.filter((tool) => !tool.readOnly && tool.annotations.destructiveHint)).toHaveLength(19);
    expect(tools.find((tool) => tool.name === 'tasks.take')!.annotations.destructiveHint).toBe(true);
    // A done change sends the sender a notice, so the client may ask its person first.
    expect(adminTools.find((tool) => tool.name === 'feedback.setStatus')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  });

  it('gives each write tool except story.start an optional storyId, and no read tool one', () => {
    for (const tool of adminTools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      const required = (tool.inputSchema.required ?? []) as string[];
      const takesStory = !tool.readOnly && tool.name !== 'story.start';
      expect(tool.takesStory, tool.name).toBe(takesStory);
      expect('storyId' in properties, tool.name).toBe(takesStory);
      expect(required).not.toContain('storyId');
    }
  });

  it('gives each tool an object inputSchema that compiles with Ajv 2020-12', () => {
    const ajv = makeAjv();
    for (const tool of adminTools) {
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(() => ajv.compile(tool.inputSchema), tool.name).not.toThrow();
    }
  });

  it('has a recorded sample for each tool of both lists, and each schema and its zod input accept it', () => {
    const ajv = makeAjv();
    const missing = adminTools.filter((tool) => !(tool.name in samples)).map((tool) => tool.name);
    expect(missing).toEqual([]);
    for (const tool of adminTools) {
      const validate = ajv.compile(tool.inputSchema);
      const sample = samples[tool.name];
      expect(validate(sample), `${tool.name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
      expect(tool.input.safeParse(sample).success, tool.name).toBe(true);
    }
    expect(Object.keys(samples).filter((name) => !(allowAndAdmin as readonly string[]).includes(name))).toEqual([]);
  });

  it('keeps samples.json equal to a new recording, so every sample is a call that runs on the sample office', async () => {
    // When this fails after a contract change, run: npx tsx scripts/record-samples.ts
    expect(await recordSamples()).toEqual(samples);
  });

  it('keeps date fields short: the format stays, the long zod pattern goes, and the zod input still refuses a bad date', () => {
    const tool = mcpTools().find((t) => t.name === 'deadlines.create')!;
    const date = (tool.inputSchema.properties as Record<string, Record<string, unknown>>).date;
    expect(date.format).toBe('date');
    expect(date.pattern).toBeUndefined();
    expect(tool.input.safeParse({ ...samples['deadlines.create'], date: '2026-02-30' }).success).toBe(false);
  });

  it('refuses a sample with a wrong type, so the schemas are not empty', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(tools.find((tool) => tool.name === 'tasks.get')!.inputSchema);
    expect(validate({ id: 42 })).toBe(false);
    expect(validate({})).toBe(false);
  });
});

describe('the written instructions (plan 5.6; spec 1, section 17)', () => {
  it('tells an agent the rules, stories, Undo, reasons and uploads', () => {
    for (const word of ['madar.readFirst', 'story.start', 'storyId', 'events.undoStory', 'reason', 'dateReason', 'upload', 'act for', 'notification', 'no lead', 'tasks.take', 'chats.send', 'chats.openDirect']) {
      expect(INSTRUCTIONS, word).toContain(word);
    }
  });

  it('answers madar.readFirst with the instructions plus one line that names the person and the role the agent acts for', () => {
    const answer = readFirstAnswer({ name: 'Sara Ali', systemRole: 'accounting' });
    expect(answer.startsWith(INSTRUCTIONS)).toBe(true);
    const added = answer.slice(INSTRUCTIONS.length).trim();
    expect(added.split('\n')).toHaveLength(1);
    expect(added).toContain('Sara Ali');
    expect(added).toContain('Accounting');
    expect(added).toContain('act for');
    expect(readFirstAnswer({ name: 'Omar', systemRole: 'admin' })).toContain('Admin');
  });

  it('names the person in English, also when the person has an Arabic name (owner item 12)', () => {
    const person = { name: 'Sara Ali', nameAr: 'سارة علي', systemRole: 'member' as const };
    const answer = readFirstAnswer(person);
    expect(answer).toContain('You act for Sara Ali,');
    expect(answer).not.toContain('سارة');
  });

  it('tells an agent that users.list gives both names', () => {
    expect(TOOL_DOCS['users.list'].description).toContain('nameAr');
  });

  it('holds no em dash', () => {
    const dash = String.fromCharCode(0x2014);
    expect(INSTRUCTIONS).not.toContain(dash);
    for (const [name, doc] of Object.entries(TOOL_DOCS)) {
      expect(doc.title + doc.description, name).not.toContain(dash);
    }
  });
});
