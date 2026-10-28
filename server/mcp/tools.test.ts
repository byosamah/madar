import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { SERVER_CALL_NAMES, serverContracts } from '../../src/api/contract/server';
import { sharedCalls } from '../../src/api/sharedCalls';
import { recordSamples } from '../../scripts/record-samples';
import { AI_SWITCH_LABELS, AI_SWITCHES } from './aiSwitches';
import { INSTRUCTIONS, TOOL_DOCS, aiSwitchLines, readFirstAnswer } from './docs';
import { heldRightsOfRole } from '../../src/api/rights';
import { expandRights } from '../../src/api/rightsCatalog';
import { MCP_ADMIN, MCP_ALLOW, MCP_BY_RIGHT, MCP_DENY, NO_CALL_TOOLS, READ_FIRST, mcpTools } from './tools';

/** The recorded sample input of each tool (scripts/record-samples.ts writes it from runs on the sample office). */
const samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>>;

const callNames = [...Object.keys(sharedCalls), ...SERVER_CALL_NAMES];
const allDefs: Record<string, { readOnly?: boolean }> = { ...sharedCalls, ...serverContracts };

/** Ajv for JSON Schema 2020-12, with the string formats that zod writes for Madar dates and emails. */
function makeAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
  ajv.addFormat('email', /^[^@\s]+@[^@\s]+$/);
  ajv.addFormat('date-time', { validate: (value: string) => /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)) });
  return ajv;
}

/** The tools of the AI switch ai.projectSetup (owner, 2026-10-25; the templates, MCP parity 2026-10-26): off for a default Member, Accounting and Management. */
const setupTools = [
  'projects.create', 'clients.create', 'clients.list', 'projectTemplates.list', 'stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete',
  'projectTemplates.save', 'projectTemplates.delete', 'projectTemplates.matchPlan', 'projectTemplates.link', 'projectTemplates.usage', 'projectTemplates.syncPlan', 'projectTemplates.syncApply',
];
/** The tools of the AI switch ai.admin (MCP parity, owner 2026-10-26): off for every built-in role except the Admin. */
const adminWork = [
  'users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'users.invites', 'users.resendInvite', 'clients.update',
  'teams.create', 'teams.update', 'teams.delete', 'subCompanies.save', 'subCompanies.delete', 'settings.update', 'roles.create', 'roles.update', 'roles.delete',
];

describe('the MCP tool list (plan 5.6, change 20)', () => {
  /** The rights of a default Member: the tools of an agent of a Member, and of an agent of an Admin (owner, 2026-10-07). */
  const memberHeld = heldRightsOfRole(undefined, 'member');
  const tools = mcpTools({ rights: memberHeld });
  const adminTools = mcpTools({ admin: true });
  /** The tools that an office right opens (role rights version 2, 2026-10-21; the feedback right, role-rights 2026-10-23). */
  const rightTools = Object.keys(MCP_BY_RIGHT);
  const paymentTools = ['payments.list', 'payments.create', 'payments.update', 'payments.markReceived'];
  const feedbackTools = ['feedback.list', 'feedback.screenshot', 'feedback.setStatus'];
  /** The right tools that a default Member holds: the Dashboard, Search and a request or a bug (the person may send one). */
  const memberRightTools = ['dashboard.get', 'search.query', 'feedback.send', 'feedback.sendWithScreenshots'];
  const allowAndAdmin = [...MCP_ALLOW, ...MCP_ADMIN, ...rightTools];
  /** The rights of a default Member plus more ids (an old id expands to its new ids). */
  const heldPlus = (...extra: string[]) => [...memberHeld, ...expandRights(extra)];

  it('has the 127 tools of the allowlist, each once', () => {
    expect(MCP_ALLOW).toHaveLength(127);
    expect(new Set(MCP_ALLOW).size).toBe(127);
    // An agent takes a task with no lead for its person (owner, 2026-10-05).
    expect(MCP_ALLOW).toContain('tasks.take');
    // The base list (no right asked) is the allowlist.
    expect(mcpTools().map((tool) => tool.name).sort()).toEqual([...MCP_ALLOW].sort());
  });

  it('gives an agent of a default Member 118 tools: the allowlist, the Dashboard, Search and a request or a bug (role rights version 2; MCP parity)', () => {
    expect(tools).toHaveLength(118);
    // The tools of project set-up are on the allowlist, but their AI switch (ai.projectSetup) is off for a default Member. The Admin tools need ai.admin and a right.
    expect(tools.map((tool) => tool.name).sort()).toEqual([...MCP_ALLOW.filter((name) => !setupTools.includes(name) && !adminWork.includes(name)), ...memberRightTools].sort());
  });

  it('keeps live.ticket from every agent (exit wave 3): an agent opens no socket', () => {
    expect(MCP_DENY).toContain('live.ticket');
    for (const admin of [false, true]) expect(mcpTools({ admin }).map((tool) => tool.name)).not.toContain('live.ticket');
  });

  // Owner, 2026-10-12: an agent may message the team, direct and in a project chat (task comments and project posts it has already).
  // It sends, finds and reads the chats of its person (fbk_011, owner 2026-10-18). Since the MCP parity track (owner, 2026-10-26) it also marks a
  // chat read or unread, archives it and sets Notify me, only when its person asks (INSTRUCTIONS).
  it('lets an agent message the team and read the chats of its person, and marks, archives and group work too (MCP parity)', () => {
    for (const name of ['chats.openDirect', 'chats.list', 'chats.send', 'chats.messages', 'chats.waiting']) {
      expect(MCP_ALLOW, name).toContain(name);
      expect(MCP_DENY, name).not.toContain(name);
      expect(tools.map((tool) => tool.name), name).toContain(name);
    }
    for (const name of ['chats.markRead', 'chats.markUnread', 'chats.unreadCount', 'chats.archive', 'chats.setNotify', 'chats.createGroup', 'chats.updateGroup', 'chats.leaveGroup', 'chats.editMessage', 'chats.deleteMessage']) {
      expect(MCP_ALLOW, name).toContain(name);
      expect(MCP_DENY, name).not.toContain(name);
      expect(tools.map((tool) => tool.name), name).toContain(name);
    }
    // The typing signal stays closed: an agent never types.
    expect(MCP_DENY).toContain('chats.typing');
    expect(tools.find((tool) => tool.name === 'chats.list')!.readOnly).toBe(true);
    expect(tools.find((tool) => tool.name === 'chats.messages')!.readOnly).toBe(true);
    expect(tools.find((tool) => tool.name === 'chats.waiting')!.readOnly).toBe(true);
    // A sent message reaches real people at once and no Undo takes it back, so the client may ask its person first.
    for (const name of ['chats.openDirect', 'chats.send']) expect(tools.find((tool) => tool.name === name)!.annotations.destructiveHint, name).toBe(true);
  });

  it('adds the 3 tools of requests and bugs only to the list of an agent whose person holds the feedback right: 158 tools for an Admin (owner, 2026-10-07; role-rights, 2026-10-23; project set-up, 2026-10-25; MCP parity, 2026-10-26)', () => {
    // The only Admin tools are the three role calls (admin.manage): the 3 tools of requests and bugs are on the right list, so a role can hold them.
    expect([...MCP_ADMIN]).toEqual(['roles.create', 'roles.update', 'roles.delete']);
    for (const name of feedbackTools) expect(MCP_BY_RIGHT[name as keyof typeof MCP_BY_RIGHT], name).toBe('feedback.manage');
    expect(tools.filter((tool) => tool.name.startsWith('feedback.')).map((tool) => tool.name)).toEqual(['feedback.send', 'feedback.sendWithScreenshots']);
    expect(adminTools).toHaveLength(158);
    expect(adminTools.map((tool) => tool.name).sort()).toEqual([...allowAndAdmin].sort());
    // The list of a Member is the Admin list without the tools of the rights and the switches that a Member lacks, in the same order.
    const lacking = [...paymentTools, 'reports.office', ...feedbackTools, ...setupTools, ...adminWork, 'payments.delete'];
    const rest = adminTools.map((tool) => tool.name).filter((name) => !lacking.includes(name));
    expect(tools.map((tool) => tool.name)).toEqual(rest);
    // A report comes in from the screens: an agent sends one for its person (no screenshot), and never starts an upload.
    expect(MCP_BY_RIGHT['feedback.send']).toBe('feedback.send');
    expect(MCP_DENY).toContain('feedback.uploadStart');
  });

  it('gives the 3 tools of requests and bugs to a person with the feedback right and to nobody else (role-rights)', () => {
    const names = (rights: Parameters<typeof mcpTools>[0]) => mcpTools(rights).map((tool) => tool.name);
    // The feedback right alone adds exactly the 3 tools to the default list.
    const holder = names({ rights: heldPlus('feedback.manage') });
    expect(holder).toHaveLength(121);
    for (const name of feedbackTools) expect(holder, name).toContain(name);
    expect(holder).not.toContain('reports.office');
    // Every other right, and all the rights but this one, leave the 3 tools out.
    const others = heldPlus('people.manage', 'payment.manage', 'report.office', 'gaps.view', 'subCompanies.manage', 'templates.updateProjects', 'project.editAny', 'task.changeAny', 'agents.undoAny');
    for (const name of feedbackTools) {
      expect(names({ rights: others }), name).not.toContain(name);
      expect(names({}), name).not.toContain(name);
    }
    // The AI switch also counts: the feedback right without ai.feedback gives no tool.
    expect(names({ rights: heldPlus('feedback.manage').filter((id) => id !== 'ai.feedback') })).not.toContain('feedback.list');
    // The Admin list holds them.
    for (const name of feedbackTools) expect(names({ admin: true }), name).toContain(name);
  });

  // Owner, 2026-10-18 (fbk_016): the office report is for the people who hold the report right (Admin and Management by default).
  it('gives reports.office only to an agent whose person holds the report right, and explains the design guide', () => {
    expect(rightTools).toEqual([
      ...paymentTools, 'dashboard.get', 'search.query', 'reports.office', ...feedbackTools, 'projects.create', 'clients.create', 'payments.delete', 'feedback.send', 'feedback.sendWithScreenshots',
      'users.create', 'users.resendInvite', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'teams.create', 'teams.update', 'teams.delete',
      'clients.update', 'subCompanies.save', 'subCompanies.delete', 'settings.update',
    ]);
    expect(MCP_BY_RIGHT['reports.office']).toBe('report.office');
    expect(MCP_ALLOW as readonly string[]).not.toContain('reports.office');
    expect(MCP_DENY as readonly string[]).not.toContain('reports.office');
    expect(tools.map((tool) => tool.name)).not.toContain('reports.office');
    // Accounting holds the payment switches and no report right: the Member list plus the 5 payment tools, 123 in all.
    const accounting = mcpTools({ rights: heldRightsOfRole(undefined, 'accounting') });
    expect(accounting).toHaveLength(123);
    expect(accounting.map((tool) => tool.name)).not.toContain('reports.office');
    expect(accounting.map((tool) => tool.name)).toEqual(adminTools.map((tool) => tool.name).filter((name) => !feedbackTools.includes(name) && !setupTools.includes(name) && !adminWork.includes(name) && name !== 'reports.office'));
    // Management, with its default rights, gets the report too: 124 in all. It holds the people rights, but ai.admin is off, so it gets no Admin tool.
    const management = mcpTools({ rights: heldRightsOfRole(undefined, 'management') });
    expect(management).toHaveLength(124);
    expect(management.map((tool) => tool.name)).toContain('reports.office');
    expect(management.map((tool) => tool.name)).toEqual(adminTools.map((tool) => tool.name).filter((name) => !feedbackTools.includes(name) && !setupTools.includes(name) && !adminWork.includes(name)));
    expect(adminTools.map((tool) => tool.name)).toContain('reports.office');
    // The office report is read only, and its agent never gets a storage key or a write.
    expect(adminTools.find((tool) => tool.name === 'reports.office')!.readOnly).toBe(true);
    expect(adminTools.find((tool) => tool.name === 'reports.office')!.takesStory).toBe(false);
    const doc = TOOL_DOCS['reports.office'].description;
    for (const word of ['design', 'white page', 'payment.view', 'report.office', 'guide: true', 'range', 'trend']) expect(doc, word).toContain(word);
    expect(doc).not.toMatch(/[\u2013\u2014]/);
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Reports: '));
    expect(line).toBeDefined();
    expect(line).toContain('reports.office');
    expect(line).toContain('design');
    // A request for a Madar report goes to the guide (owner, 2026-10-21), so every report has the same form.
    expect(line).toContain('guide: true');
    expect(line).not.toMatch(/[\u2013\u2014]/);
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

  it('offers the Admin work through the right list and the Admin list (MCP parity, owner 2026-10-26), and keeps the delete of a project from every agent', () => {
    // The people, client, sub-company and settings calls need their right. The three role calls need admin.manage, which only the Admin holds.
    for (const name of adminWork.filter((item) => !MCP_ADMIN.includes(item as never) && item !== 'users.invites')) expect(rightTools, name).toContain(name);
    expect(MCP_ALLOW).toContain('users.invites');
    expect(MCP_BY_RIGHT['users.create']).toBe('people.invite');
    expect(MCP_BY_RIGHT['settings.update']).toBe('office.settings');
    // projects.delete has no Undo: it stays on the deny list, and no list and no tool holds it.
    expect(MCP_DENY).toContain('projects.delete');
    expect(allowAndAdmin as readonly string[]).not.toContain('projects.delete');
    expect(adminTools.map((tool) => tool.name)).not.toContain('projects.delete');
    expect(Object.keys(TOOL_DOCS)).not.toContain('projects.delete');
    // The Undo tools stay on the list. The call refuses an agent the Undo of a role change (rolesLeaks.test.ts).
    expect(allowAndAdmin as readonly string[]).toEqual(expect.arrayContaining(['events.undo', 'events.undoStory']));
  });

  it('keeps on the deny list only the calls that an agent cannot or must not do, each with its reason (MCP parity)', () => {
    expect([...MCP_DENY].sort()).toEqual([
      'chats.insertProjects', 'chats.typing', 'daftra.findClients', 'daftra.matchClient', 'daftra.paymentLink', 'daftra.status', 'feedback.uploadStart', 'files.upload', 'files.uploadStart',
      'google.connect', 'google.connectStart', 'google.disconnect', 'google.status', 'live.ticket', 'meetings.extend', 'meetings.settle', 'payments.linkInvoice',
      'payments.unlinkInvoice', 'projects.delete', 'push.mine', 'push.register', 'push.remove', 'session.get',
    ]);
  });

  it('puts every call in exactly one of the allowlist, the Admin list, the right list and the deny list', () => {
    const allow = new Set<string>(MCP_ALLOW);
    const admin = new Set<string>(MCP_ADMIN);
    const right = new Set<string>(rightTools);
    const deny = new Set<string>(MCP_DENY);
    expect(callNames.filter((name) => !allow.has(name) && !admin.has(name) && !right.has(name) && !deny.has(name))).toEqual([]);
    expect([...allow].filter((name) => deny.has(name) || admin.has(name) || right.has(name))).toEqual([]);
    expect([...admin].filter((name) => deny.has(name) || right.has(name))).toEqual([]);
    expect([...right].filter((name) => deny.has(name))).toEqual([]);
    // Each listed name is a real call; the only tools with no call are madar.readFirst, pictures.get (owner, 2026-10-21), the two bulk tools and the two upload tools (owner, 2026-10-26).
    expect([...NO_CALL_TOOLS].sort()).toEqual(['feedback.sendWithScreenshots', 'files.uploadContent', READ_FIRST, 'pictures.get', 'tasks.createMany', 'tasks.updateMany']);
    expect([...allow, ...admin, ...right, ...deny].filter((name) => !NO_CALL_TOOLS.has(name) && !callNames.includes(name))).toEqual([]);
    expect(deny.size).toBe(MCP_DENY.length);
    expect(admin.size).toBe(3);
    expect(right.size).toBe(28);
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
    expect(mcpTools({ rights: memberHeld }).map((tool) => tool.name)).toEqual(tools.map((tool) => tool.name));
    expect(mcpTools({ admin: true }).map((tool) => tool.name)).toEqual(adminTools.map((tool) => tool.name));
    // The feedback tools sort between events.undoStory and files.delete (feedback.send and feedback.sendWithScreenshots sort with them).
    const names = adminTools.map((tool) => tool.name);
    expect(names.slice(names.indexOf('events.undoStory'), names.indexOf('files.delete') + 1)).toEqual(['events.undoStory', 'feedback.list', 'feedback.screenshot', 'feedback.send', 'feedback.sendWithScreenshots', 'feedback.setStatus', 'files.delete']);
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
      // madar.readFirst and pictures.get read; the bulk tools and the upload tools write.
      const writes = tool.name.endsWith('Many') || tool.name === 'files.uploadContent' || tool.name === 'feedback.sendWithScreenshots';
      const readOnly = writes ? false : NO_CALL_TOOLS.has(tool.name) ? true : Boolean(allDefs[tool.name].readOnly);
      expect(tool.readOnly, tool.name).toBe(readOnly);
      expect(tool.annotations.readOnlyHint, tool.name).toBe(readOnly);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
      if (!readOnly) expect(typeof tool.annotations.destructiveHint, tool.name).toBe('boolean');
    }
    expect(tools.filter((tool) => tool.readOnly)).toHaveLength(31);
    // payments.list, feedback.list and feedback.screenshot are reads of an agent of an Admin, reports.office is a read of the report right, and the lists of clients and templates belong to ai.projectSetup.
    expect(adminTools.filter((tool) => tool.readOnly)).toHaveLength(42);
    for (const name of ['feedback.list', 'feedback.screenshot']) expect(adminTools.find((tool) => tool.name === name)!.annotations.readOnlyHint, name).toBe(true);
    // An undo can remove a record, so the client may ask its person first.
    expect(tools.find((tool) => tool.name === 'events.undo')!.annotations.destructiveHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'tasks.create')!.annotations.destructiveHint).toBe(false);
  });

  it('marks every write that changes or removes a record as destructive, and only the pure adds as not (MCP: false means additive only)', () => {
    const additive = [
      'story.start', 'tasks.create', 'tasks.createMany', 'files.uploadContent', 'feedback.sendWithScreenshots', 'comments.create', 'updates.create', 'tracker.log', 'payments.create', 'deadlines.create', 'meetings.create', 'folders.create',
      'tasks.createFromTemplate', 'feedback.send', 'teams.create', 'roles.create', 'chats.createGroup', 'stageTemplates.save', 'taskTemplates.save',
    ];
    for (const tool of adminTools.filter((t) => !t.readOnly)) {
      expect(tool.annotations.destructiveHint, tool.name).toBe(!additive.includes(tool.name));
    }
    for (const name of ['payments.update', 'projects.setStatus', 'tasks.update', 'tracker.close']) {
      expect(adminTools.find((tool) => tool.name === name)!.annotations.destructiveHint, name).toBe(true);
    }
    expect(tools.filter((tool) => !tool.readOnly && tool.annotations.destructiveHint)).toHaveLength(72);
    expect(adminTools.filter((tool) => !tool.readOnly && tool.annotations.destructiveHint)).toHaveLength(97);
    // users.create sends an invitation email, so it is not additive.
    expect(adminTools.find((tool) => tool.name === 'users.create')!.annotations.destructiveHint).toBe(true);
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

  it('adds the AI switches of the person to the answer of madar.readFirst, in three short lines (role rights version 2)', () => {
    const person = { name: 'Sara Ali', systemRole: 'member' as const };
    const member = heldRightsOfRole(undefined, 'member');
    const answer = readFirstAnswer(person, undefined, member);
    const added = answer.slice(INSTRUCTIONS.length).trim().split('\n');
    expect(added).toHaveLength(4);
    expect(added[0]).toContain('You act for Sara Ali');
    // A default Member holds every AI switch except ai.projectSetup (owner, 2026-10-25) and ai.admin (MCP parity, 2026-10-26): those two are off, with the tools that they close.
    expect(added[1]).toBe('AI switches that are on: ' + AI_SWITCHES.filter((id) => id !== 'ai.projectSetup' && id !== 'ai.admin').map((id) => `${AI_SWITCH_LABELS[id]} (${id})`).join(', ') + '.');
    expect(added[2]).toBe(`AI switches that are off: AI creates projects and clients (ai.projectSetup), which closes ${setupTools.join(', ')}; AI does Admin work (ai.admin), which closes ${adminWork.join(', ')}. Do not try a tool that is closed. Tell your person.`);
    expect(added[3]).toBe('You take back the changes of the agents of other people on: the projects your person leads.');
    // A switch that is off shows with the tools that it closes. The Undo scopes change the last line.
    const without = member.filter((id) => id !== 'ai.todos' && id !== 'ai.undoOthers.lead');
    const text = aiSwitchLines(without);
    expect(text).toContain('AI works on to-dos (ai.todos), which closes tasks.create, tasks.update, tasks.createMany, tasks.updateMany, tasks.complete');
    expect(text).toContain('Do not try a tool that is closed. Tell your person.');
    expect(text.split('\n')[2]).toBe('You take back the changes of the agents of other people on: none.');
    expect(aiSwitchLines(heldRightsOfRole(undefined, 'member').concat(['ai.undoOthers.all'])).split('\n')[2]).toContain('every project');
    expect(aiSwitchLines([])).toContain('AI switches that are on: none.');
    for (const line of [answer, text]) expect(line).not.toMatch(/[\u2013\u2014]/);
    // The answer of a call with no rights is the old answer.
    expect(readFirstAnswer(person).split('\n').slice(-1)[0]).toContain('whose role in Madar is Member.');
  });

  it('names the custom role of a Member with the name of that role, and the built-in role otherwise (fbk_014)', () => {
    const roles = { custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage' as const] }] };
    expect(readFirstAnswer({ name: 'Ali Cash', systemRole: 'member', roleId: 'rol_001' }, roles)).toContain('whose role in Madar is Cashier.');
    expect(readFirstAnswer({ name: 'Ali Cash', systemRole: 'member', roleId: 'rol_999' }, roles)).toContain('whose role in Madar is Member.');
    expect(readFirstAnswer({ name: 'Ali Cash', systemRole: 'member', roleId: 'rol_001' })).toContain('whose role in Madar is Member.');
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
