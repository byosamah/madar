import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { SERVER_CALL_NAMES, serverContracts } from '../../src/api/contract/server';
import { sharedCalls } from '../../src/api/sharedCalls';
import { recordSamples } from '../../scripts/record-samples';
import { INSTRUCTIONS, TOOL_DOCS, readFirstAnswer } from './docs';
import { MCP_ALLOW, MCP_DENY, READ_FIRST, mcpTools } from './tools';

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
  const tools = mcpTools();

  it('has the 37 tools of the allowlist, each once', () => {
    expect(MCP_ALLOW).toHaveLength(37);
    expect(new Set(MCP_ALLOW).size).toBe(37);
    // An agent takes a task with no lead for its person (owner, 2026-10-05).
    expect(MCP_ALLOW).toContain('tasks.take');
    expect(tools.map((tool) => tool.name).sort()).toEqual([...MCP_ALLOW].sort());
  });

  it('puts every call in the allowlist or the deny list, and in only one', () => {
    const allow = new Set<string>(MCP_ALLOW);
    const deny = new Set<string>(MCP_DENY);
    expect(callNames.filter((name) => !allow.has(name) && !deny.has(name))).toEqual([]);
    expect([...allow].filter((name) => deny.has(name))).toEqual([]);
    // Each listed name is a real call; the only tool with no call is madar.readFirst.
    expect([...allow, ...deny].filter((name) => name !== READ_FIRST && !callNames.includes(name))).toEqual([]);
    expect(deny.size).toBe(MCP_DENY.length);
  });

  it('never allows a call that the server does not run', () => {
    for (const name of ['session.previewAs', 'session.setSimulateErrors', 'session.resetSampleData', 'files.get']) {
      expect(MCP_ALLOW).not.toContain(name);
    }
  });

  it('keeps a fixed order: madar.readFirst, story.start, then by name', () => {
    const names = tools.map((tool) => tool.name);
    expect(names.slice(0, 2)).toEqual([READ_FIRST, 'story.start']);
    const rest = names.slice(2);
    expect(rest).toEqual([...rest].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(mcpTools().map((tool) => tool.name)).toEqual(names);
  });

  it('gives each tool a title and a description of 40 to 600 characters', () => {
    for (const tool of tools) {
      expect(tool.title.length, tool.name).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeGreaterThanOrEqual(40);
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(600);
      expect(TOOL_DOCS[tool.name], tool.name).toBeDefined();
    }
    expect(Object.keys(TOOL_DOCS).sort()).toEqual([...MCP_ALLOW].sort());
  });

  it('marks reads as read-only and writes as not, from the call contracts', () => {
    for (const tool of tools) {
      const readOnly = tool.name === READ_FIRST ? true : Boolean(allDefs[tool.name].readOnly);
      expect(tool.readOnly, tool.name).toBe(readOnly);
      expect(tool.annotations.readOnlyHint, tool.name).toBe(readOnly);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
      if (!readOnly) expect(typeof tool.annotations.destructiveHint, tool.name).toBe('boolean');
    }
    expect(tools.filter((tool) => tool.readOnly)).toHaveLength(15);
    // An undo can remove a record, so the client may ask its person first.
    expect(tools.find((tool) => tool.name === 'events.undo')!.annotations.destructiveHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'tasks.create')!.annotations.destructiveHint).toBe(false);
  });

  it('marks every write that changes or removes a record as destructive, and only the pure adds as not (MCP: false means additive only)', () => {
    const additive = ['story.start', 'tasks.create', 'comments.create', 'updates.create', 'tracker.log', 'payments.create', 'deadlines.create'];
    for (const tool of tools.filter((t) => !t.readOnly)) {
      expect(tool.annotations.destructiveHint, tool.name).toBe(!additive.includes(tool.name));
    }
    for (const name of ['payments.update', 'projects.setStatus', 'tasks.update', 'tracker.close']) {
      expect(tools.find((tool) => tool.name === name)!.annotations.destructiveHint, name).toBe(true);
    }
    expect(tools.filter((tool) => !tool.readOnly && tool.annotations.destructiveHint)).toHaveLength(15);
    expect(tools.find((tool) => tool.name === 'tasks.take')!.annotations.destructiveHint).toBe(true);
  });

  it('gives each write tool except story.start an optional storyId, and no read tool one', () => {
    for (const tool of tools) {
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
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(() => ajv.compile(tool.inputSchema), tool.name).not.toThrow();
    }
  });

  it('has a recorded sample for each tool, and each schema and its zod input accept it', () => {
    const ajv = makeAjv();
    const missing = tools.filter((tool) => !(tool.name in samples)).map((tool) => tool.name);
    expect(missing).toEqual([]);
    for (const tool of tools) {
      const validate = ajv.compile(tool.inputSchema);
      const sample = samples[tool.name];
      expect(validate(sample), `${tool.name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
      expect(tool.input.safeParse(sample).success, tool.name).toBe(true);
    }
    expect(Object.keys(samples).filter((name) => !(MCP_ALLOW as readonly string[]).includes(name))).toEqual([]);
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
    for (const word of ['madar.readFirst', 'story.start', 'storyId', 'events.undoStory', 'reason', 'dateReason', 'upload', 'act for', 'notification', 'no lead', 'tasks.take']) {
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
