import { beforeAll, describe, expect, it } from 'vitest';
import type { CustomRole } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { memoryData, type MemoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { OfficeSnapshot } from '../core/types';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { mcpApp } from './app';
import type { AgentPrincipal, AgentToken } from './auth';
import { DEFAULT_EXTRA } from '../../src/api/rightsCatalog';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { giveRole, roleWithout } from './aiRoles.testing';
import { AI_SWITCHES, aiSwitchOf } from './aiSwitches';
import { MCP_ADMIN, MCP_ALLOW, MCP_BY_RIGHT, MCP_DENY, mcpTools } from './tools';

/**
 * The MCP parity track (owner, 2026-10-26): an agent does what its person does in the screens, with the rights of that person. The tests run
 * each opened area as an agent, and probe the refusals that the screens give. In process, as folderTools.test.ts: the MCP app with the real
 * runCall on the memory office. The Admin is usr_001 (agent usr_009), Reem is a Member (usr_003), Turki is Management (usr_010).
 */
const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const VERSION = '2026-07-28';
const NOW = new Date('2026-10-04T06:00:00Z');
const TOKEN: AgentToken = {
  token: 'agent-token', authUserId: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', clientId: '907ef9d7-7bfc-4e2b-ac19-e027f13226fa', sessionId: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b',
};
const ADMIN = 'usr_001';
const MEMBER = 'usr_003';
const MANAGEMENT = 'usr_010';

let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

type World = { app: ReturnType<typeof mcpApp>; deps: FakeDeps; mem: MemoryData };

/** The agent of a person. The Admin keeps usr_009; any other person gets a copy of that agent record with its own id. */
function world(personId: string = ADMIN, prepare?: (state: State) => void): World {
  const mem = memoryData(structuredClone(seed));
  const agentId = personId === ADMIN ? 'usr_009' : `usr_9${personId.slice(-2)}`;
  if (agentId !== 'usr_009') mem.tables.state.users[agentId] = { ...mem.tables.state.users.usr_009, id: agentId, email: `${agentId}@madar.test`, ownerId: personId };
  prepare?.(mem.tables.state);
  mem.tables.version += 1;
  const deps = fakeDeps({ db: mem.db, config: { mcpUrl: MCP_URL } });
  deps.clock.set(NOW);
  const app = mcpApp(deps, {
    checkToken: async () => TOKEN,
    agentOf: async (): Promise<AgentPrincipal> => ({ principal: { userId: agentId, agent: { clientId: TOKEN.clientId } }, ownerId: personId, linked: false }),
    runCall: createRunCall({ data: () => mem.data() }),
    readOffice: async (): Promise<OfficeSnapshot> => mem.data().office(),
    limit: async () => ({ ok: true, count: 1, retryAfterMs: 0 }),
    stateKey: 'k'.repeat(40),
  });
  return { app, deps, mem };
}

let nextRpc = 1;
type Raw = { result?: Record<string, any>; error?: { code: number; message: string } };

async function raw(w: World, method: string, params: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Raw> {
  const response = await w.app.fetch(new Request('http://127.0.0.1/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${TOKEN.token}`,
      'MCP-Protocol-Version': VERSION, 'Mcp-Method': method, ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: nextRpc++, method,
      params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test-agent', version: '1.0.0' } } },
    }),
  }));
  return JSON.parse(await response.text()) as Raw;
}

const callRaw = (w: World, name: string, args: Record<string, unknown> = {}) => raw(w, 'tools/call', { name, arguments: args }, { 'Mcp-Name': name });

/** A call that must work: it gives the output. */
async function ok(w: World, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const body = await callRaw(w, name, args);
  expect(body.error, `${name}: ${JSON.stringify(body)}`).toBeUndefined();
  expect(body.result?.isError, `${name}: ${JSON.stringify(body.result)}`).toBeUndefined();
  return body.result!.structuredContent.output;
}

/** A call that must fail inside Madar: it gives the error of the tool result. */
async function refused(w: World, name: string, args: Record<string, unknown> = {}): Promise<{ code: string; message: string; details?: Record<string, any> }> {
  const body = await callRaw(w, name, args);
  expect(body.error, `${name}: ${JSON.stringify(body)}`).toBeUndefined();
  expect(body.result?.isError, `${name} should fail`).toBe(true);
  return body.result!.structuredContent.error;
}

/**
 * A risky Admin act of an agent (guard.ts): the first call fails with confirm_needed, the person reads the code in the email, and the second
 * call sends it with the same arguments. The memory world runs no mail, so the test reads the code from the outbox row (the effect removes it
 * after the mail goes; guard.lite.test.ts checks that on SQLite).
 */
async function confirmed(w: World, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const first = await refused(w, name, args);
  expect(first, name).toMatchObject({ code: 'forbidden', details: { reason: 'confirm_needed' } });
  const rows = w.mem.tables.outbox.filter((row) => row.kind === 'mcp.confirm');
  const code = String(rows[rows.length - 1].payload.code);
  expect(code).toMatch(/^\d{6}$/);
  return ok(w, name, { ...args, confirmCode: code });
}

/** A tool that the list never named: the server answers with an unknown tool (-32602). */
async function unknown(w: World, name: string, args: Record<string, unknown> = {}): Promise<void> {
  const body = await callRaw(w, name, args);
  expect(body.error?.code, `${name}: ${JSON.stringify(body)}`).toBe(-32602);
}

const listed = async (w: World): Promise<string[]> => ((await raw(w, 'tools/list', {})).result!.tools as { name: string }[]).map((tool) => tool.name);

const stateOf = (w: World) => w.mem.tables.state;
const firstActive = (state: State) => Object.values(state.projects).find((p) => p.status === 'active' && p.kind !== 'internal')!;

describe('the project set-up tools, for the agent of the Admin', () => {
  it('pause a project with a reason, move the restart date, resume it, and record both names in the History', async () => {
    const w = world();
    const project = firstActive(stateOf(w));
    const paused = await ok(w, 'projects.pause', { id: project.id, reason: 'The client has not sent the survey.', resumeOn: '2026-10-20' });
    expect(paused.project.status).toBe('on_hold');
    await ok(w, 'projects.setRestart', { id: project.id, resumeOn: '2026-10-25' });
    expect(stateOf(w).projects[project.id].pause?.resumeOn).toBe('2026-10-25');
    const resumed = await ok(w, 'projects.resume', { id: project.id });
    expect(resumed.project.status).toBe('active');
    const events = Object.values(stateOf(w).events).filter((event) => event.targetId === project.id && event.verb === 'project.paused');
    expect(events).toMatchObject([{ actorId: 'usr_009', actingForId: ADMIN, actorKind: 'agent' }]);
  });

  it('add, change and remove a link, set and clear the health by hand, and take a team member in and out', async () => {
    const w = world();
    const project = firstActive(stateOf(w));
    await ok(w, 'projects.addLink', { projectId: project.id, kind: 'moodboard', label: 'Moodboard', url: 'https://example.com/mood' });
    const link = stateOf(w).projects[project.id].links!.slice(-1)[0];
    await ok(w, 'projects.updateLink', { projectId: project.id, linkId: link.id, label: 'Moodboard 2' });
    expect(stateOf(w).projects[project.id].links!.find((item) => item.id === link.id)?.label).toBe('Moodboard 2');
    await ok(w, 'projects.removeLink', { projectId: project.id, linkId: link.id });
    expect(stateOf(w).projects[project.id].links!.some((item) => item.id === link.id)).toBe(false);
    await ok(w, 'projects.setHealthOverride', { id: project.id, value: 'at_risk', reason: 'The survey is late.' });
    expect(stateOf(w).projects[project.id].healthOverride).toBeDefined();
    await ok(w, 'projects.clearHealthOverride', { id: project.id });
    const onTeam = new Set(Object.values(stateOf(w).members).filter((m) => m.projectId === project.id).map((m) => m.userId));
    const newcomer = Object.values(stateOf(w).users).find((u) => u.kind === 'human' && u.active && !onTeam.has(u.id) && u.id !== ADMIN)!;
    await ok(w, 'members.add', { projectId: project.id, userId: newcomer.id, discipline: 'Architect' });
    await ok(w, 'members.update', { projectId: project.id, userId: newcomer.id, discipline: 'Site engineer' });
    await ok(w, 'members.remove', { projectId: project.id, userId: newcomer.id });
    expect(Object.values(stateOf(w).members).some((m) => m.projectId === project.id && m.userId === newcomer.id)).toBe(false);
  });

  it('keep projects.delete away from every agent, the agent of the Admin too, and change nothing', async () => {
    const w = world();
    const project = firstActive(stateOf(w));
    expect(await listed(w)).not.toContain('projects.delete');
    await unknown(w, 'projects.delete', { id: project.id });
    expect(stateOf(w).projects[project.id]).toBeDefined();
  });
});

describe('the same refusals as the screens, for a person without the right', () => {
  it('refuse members.add and projects.setLeader to the agent of a Member who does not lead the project, with forbidden', async () => {
    const w = world(MEMBER);
    const project = Object.values(stateOf(w)).length ? Object.values(stateOf(w).projects).find((p) => p.leaderId !== MEMBER && p.status === 'active')! : undefined!;
    const error = await refused(w, 'projects.setLeader', { id: project.id, leaderId: MEMBER });
    expect(error.code).toBe('forbidden');
    const second = await refused(w, 'members.add', { projectId: project.id, userId: 'usr_007' });
    expect(second.code).toBe('forbidden');
  });

  it('refuse chats.editMessage and chats.deleteMessage on the message of another person, as in the screens', async () => {
    const w = world(ADMIN);
    const sent = await ok(w, 'chats.openDirect', { userId: MEMBER });
    const memberAgent = world(MEMBER);
    // The Member writes a message in the chat of the Admin and the Member; the agent of the Admin may not change it.
    const room = sent.id as string;
    const sample = await ok(memberAgent, 'chats.openDirect', { userId: ADMIN });
    expect(sample.id).toBe(room);
    const message = await ok(memberAgent, 'chats.send', { conversationId: room, body: 'A message of Reem.' });
    // The two worlds use two copies of the office: put the message of Reem into the copy of the Admin.
    stateOf(w).messages[message.message.id] = stateOf(memberAgent).messages[message.message.id];
    w.mem.tables.version += 1;
    const edit = await refused(w, 'chats.editMessage', { id: message.message.id, body: 'The Admin changed it.' });
    expect(edit).toMatchObject({ code: 'forbidden', details: { reason: 'not_author' } });
    const drop = await refused(w, 'chats.deleteMessage', { id: message.message.id });
    expect(drop).toMatchObject({ code: 'forbidden', details: { reason: 'not_author' } });
    expect(stateOf(w).messages[message.message.id].body).toBe('A message of Reem.');
  });
});

describe('the to-do, post, comment and message tools', () => {
  it('make a to-do from a template, delete it, and delete the template', async () => {
    const w = world();
    const project = firstActive(stateOf(w));
    // The current stage: a to-do in an earlier stage moves the project back and asks a reason.
    const stage = stateOf(w).stages[project.currentStageId!];
    await ok(w, 'taskTemplates.save', { name: 'Check the levels', stageName: stage.name, description: 'Compare the levels.', checklist: ['Read the survey'], needsReview: true, schedule: 'static' });
    const listedTemplates = await ok(w, 'taskTemplates.list', { stageName: stage.name });
    const template = (listedTemplates as { id: string; name: string }[]).find((item) => item.name === 'Check the levels')!;
    await ok(w, 'tasks.createFromTemplate', { templateId: template.id, stageId: stage.id, ownerId: project.leaderId });
    const task = Object.values(stateOf(w).tasks).find((t) => t.title === 'Check the levels')!;
    expect(task.projectId).toBe(project.id);
    expect(await ok(w, 'tasks.delete', { id: task.id })).toEqual({ deleted: true });
    expect(stateOf(w).tasks[task.id]).toBeUndefined();
    await ok(w, 'taskTemplates.delete', { id: template.id });
    expect(Object.values(stateOf(w).taskTemplates ?? {}).some((item) => item.name === 'Check the levels')).toBe(false);
  });

  it('change and delete the post and the comment of the person, and react to the comment', async () => {
    const w = world();
    const project = firstActive(stateOf(w));
    const task = Object.values(stateOf(w).tasks).find((t) => t.projectId === project.id)!;
    const post = await ok(w, 'updates.create', { projectId: project.id, body: 'A post.' });
    await ok(w, 'updates.update', { id: post.id, body: 'A post, changed.' });
    expect(stateOf(w).updates[post.id].body).toBe('A post, changed.');
    await ok(w, 'updates.delete', { id: post.id });
    expect(stateOf(w).updates[post.id]).toBeUndefined();
    const comment = await ok(w, 'comments.create', { targetType: 'task', targetId: task.id, body: 'A comment.' });
    await ok(w, 'comments.update', { id: comment.comment.id, body: 'A comment, changed.' });
    const reacted = await ok(w, 'reactions.toggle', { commentId: comment.comment.id, emoji: '👍' });
    expect(reacted.comment.reactions['👍']).toEqual(['usr_009']);
    await ok(w, 'comments.delete', { id: comment.comment.id });
    expect(stateOf(w).comments[comment.comment.id]).toBeUndefined();
  });

  it('edit and delete a message of the person, make a group chat, change it and leave it', async () => {
    const w = world();
    const chat = await ok(w, 'chats.openDirect', { userId: MEMBER });
    const message = await ok(w, 'chats.send', { conversationId: chat.id, body: 'A message.' });
    const edited = await ok(w, 'chats.editMessage', { id: message.message.id, body: 'A message, changed.' });
    expect(edited.message.body).toBe('A message, changed.');
    expect(await ok(w, 'chats.deleteMessage', { id: message.message.id })).toEqual({ deleted: true });
    const group = await ok(w, 'chats.createGroup', { name: 'Site team', memberIds: [MEMBER, MANAGEMENT] });
    await ok(w, 'chats.updateGroup', { conversationId: group.id, name: 'Site team, Al Khobar' });
    expect(stateOf(w).conversations[group.id].name).toBe('Site team, Al Khobar');
    await ok(w, 'chats.leaveGroup', { conversationId: group.id });
    expect(stateOf(w).conversations[group.id].memberIds).not.toContain(ADMIN);
  });
});

describe('the files without upload', () => {
  it('give a signed link and never a storage key, in the link and in the lists', async () => {
    const w = world();
    const project = firstActive(stateOf(w));
    const file = Object.values(stateOf(w).files).find((f) => f.projectId === project.id)!;
    const body = await callRaw(w, 'files.link', { id: file.id, variant: 'full', disposition: 'inline' });
    expect(body.error).toBeUndefined();
    // The link is signed, as the link of feedback.screenshot: its path names the object, the answer holds no key field.
    const link = body.result!.structuredContent.output as Record<string, unknown>;
    expect(Object.keys(link).sort()).toEqual(['expiresAt', 'mimeType', 'name', 'size', 'url']);
    expect(link.url).toEqual(expect.stringMatching(/^https:\/\//));
    expect(JSON.stringify(body.result)).not.toContain('blobKey');
    for (const name of ['files.list', 'files.move']) {
      const stage = Object.values(stateOf(w).stages).find((s) => s.projectId === project.id)!;
      const answer = name === 'files.list' ? await callRaw(w, name, { projectId: project.id }) : await callRaw(w, name, { id: file.id, stageId: stage.id, folderId: null });
      expect(JSON.stringify(answer.result), name).not.toContain('blobKey');
      expect(JSON.stringify(answer.result), name).not.toContain('thumbKey');
    }
    expect(stateOf(w).files[file.id].versions[0].blobKey).toBeDefined();
  });

  it('mark a file delivered, share it in the project chat, and delete it', async () => {
    const w = world();
    const project = firstActive(stateOf(w));
    const file = Object.values(stateOf(w).files).find((f) => f.projectId === project.id)!;
    const delivered = await ok(w, 'files.markDelivered', { id: file.id });
    expect(delivered.entry.auto).toBe('delivered');
    const shared = await ok(w, 'files.share', { fileId: file.id, target: { kind: 'project_chat' }, message: 'The drawing.' });
    expect(shared.kind).toBe('project_chat');
    expect(await ok(w, 'files.delete', { id: file.id })).toEqual({ deleted: true });
    expect(stateOf(w).files[file.id]).toBeUndefined();
  });

  it('keep the uploads closed', async () => {
    const w = world();
    for (const name of ['files.upload', 'files.uploadStart', 'feedback.uploadStart']) {
      expect(await listed(w), name).not.toContain(name);
      await unknown(w, name, {});
    }
  });
});

describe('the bell, the read marks and the own chat state', () => {
  it('read the bell, mark notices read and unread, and mark a chat read, unread, archived and Notify me', async () => {
    const w = world();
    const notice = Object.values(stateOf(w).notifications).find((n) => n.userId === ADMIN)!;
    const rows = await ok(w, 'notifications.list', { unreadOnly: false, limit: 50 });
    expect(rows.length).toBeGreaterThan(0);
    expect(await ok(w, 'notifications.count', {})).toMatchObject({ unread: expect.any(Number), badge: expect.any(Number) });
    await ok(w, 'notifications.markRead', { ids: [notice.id] });
    expect(stateOf(w).notifications[notice.id].read).toBe(true);
    await ok(w, 'notifications.markUnread', { ids: [notice.id] });
    expect(stateOf(w).notifications[notice.id].read).toBe(false);
    await ok(w, 'notifications.markAllRead', {});
    expect(Object.values(stateOf(w).notifications).filter((n) => n.userId === ADMIN).every((n) => n.read)).toBe(true);
    const room = Object.values(stateOf(w).conversations).find((c) => c.kind === 'project')!;
    expect(await ok(w, 'chats.unreadCount', {})).toEqual({ unread: expect.any(Number) });
    await ok(w, 'chats.markUnread', { conversationId: room.id });
    await ok(w, 'chats.markRead', { conversationId: room.id });
    expect(await ok(w, 'chats.setNotify', { conversationId: room.id, notify: 'named' })).toEqual({ notify: 'named' });
    expect(await ok(w, 'chats.archive', { conversationId: room.id, archived: true })).toEqual({ archived: true });
  });

  it('mark the read state of the person and not of the agent', async () => {
    const w = world();
    const room = Object.values(stateOf(w).conversations).find((c) => c.kind === 'project')!;
    await ok(w, 'chats.setNotify', { conversationId: room.id, notify: 'named' });
    const marks = Object.values(stateOf(w).chatReads).filter((mark) => mark.conversationId === room.id);
    expect(marks.find((mark) => mark.userId === ADMIN)?.notify).toBe('named');
    expect(marks.some((mark) => mark.userId === 'usr_009')).toBe(false);
  });

  it('refuse the email switches and the morning summary to an agent, as the call does', async () => {
    const w = world();
    const email = await refused(w, 'notifications.updateSettings', { channel: 'email', trigger: 'mention', on: false });
    expect(email).toMatchObject({ code: 'forbidden', details: { action: 'notifications.email' } });
    const summary = await refused(w, 'notifications.updateSettings', { morningSummary: false });
    expect(summary.code).toBe('forbidden');
    await ok(w, 'notifications.updateSettings', { channel: 'app', trigger: 'mention', on: false });
    expect(stateOf(w).users[ADMIN].preferences.notifications.mention).toBe(false);
  });
});

describe('the own profile, preferences, requests and AI apps', () => {
  it('change the profile and the preferences of the person, not the record of the agent, and set the picture of the person as picture data', async () => {
    const w = world(MEMBER);
    const agentBefore = JSON.stringify(stateOf(w).users.usr_903);
    await ok(w, 'me.updateProfile', { discipline: 'Site engineer', nameAr: 'ريم' });
    expect(stateOf(w).users[MEMBER]).toMatchObject({ discipline: 'Site engineer', nameAr: 'ريم' });
    await ok(w, 'me.updatePreferences', { theme: 'dark', language: 'ar' });
    expect(stateOf(w).users[MEMBER].preferences).toMatchObject({ theme: 'dark', language: 'ar' });
    expect(JSON.stringify(stateOf(w).users.usr_903)).toBe(agentBefore);
    const address = await refused(w, 'me.updateProfile', { avatarUrl: 'https://example.com/me.png' });
    expect(address).toMatchObject({ code: 'invalid_input' });
    expect(stateOf(w).users[MEMBER].avatarUrl).toBe(seed.users[MEMBER].avatarUrl);
    await ok(w, 'me.updateProfile', { avatarUrl: 'data:image/png;base64,AAAA' });
    expect(stateOf(w).users[MEMBER].avatarUrl).toBe('data:image/png;base64,AAAA');
    expect(stateOf(w).users.usr_903.avatarUrl).toBeNull();
    // The tool schema shows avatarUrl for me.updateProfile.
    const tool = mcpTools({ admin: true }).find((item) => item.name === 'me.updateProfile')!;
    expect(Object.keys(tool.inputSchema.properties as object)).toContain('avatarUrl');
  });

  it('keep the picture of another person and the email refused, and follow the AI switches for a picture and a logo', async () => {
    const w = world(ADMIN);
    // The tool schema has no avatarUrl for users.update, so the MCP check stops it (and the call refuses an agent too: agentProfile.test.ts).
    const other = await callRaw(w, 'users.update', { id: MEMBER, patch: { avatarUrl: 'data:image/png;base64,AAAA' } });
    expect(other.error !== undefined || other.result?.isError === true).toBe(true);
    const email = await refused(w, 'users.update', { id: MEMBER, patch: { email: 'someone.else@madar.test' } });
    expect(email).toMatchObject({ code: 'forbidden', details: { action: 'people.email' } });
    expect(stateOf(w).users[MEMBER].avatarUrl).toBe(seed.users[MEMBER].avatarUrl);
    expect(stateOf(w).users[MEMBER].email).toBe(seed.users[MEMBER].email);
    // The switch ai.myState closes the own picture, and ai.admin closes the logo of a sub-company.
    const noMyState = world(MEMBER, (state) => void giveRole(state, MEMBER, roleWithout(['ai.myState'])));
    expect(await refused(noMyState, 'me.updateProfile', { avatarUrl: 'data:image/png;base64,AAAA' })).toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.myState' } });
    const noAdmin = world(ADMIN, (state) => void giveRole(state, ADMIN, roleWithout(['ai.admin'])));
    expect(await refused(noAdmin, 'subCompanies.save', { name: 'Marsa Design', nameAr: 'مرسى للتصميم', logo: 'data:image/png;base64,AAAA' }))
      .toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.admin' } });
  });

  it('refuse quiet hours, Away and what reaches the Admin to an agent', async () => {
    const w = world(ADMIN);
    const hours = await refused(w, 'me.updatePreferences', { workHours: { quiet: true, days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00' } });
    expect(hours).toMatchObject({ code: 'forbidden', details: { action: 'me.workHours' } });
    expect(await refused(w, 'me.updatePreferences', { awayByHand: true })).toMatchObject({ code: 'forbidden', details: { action: 'me.away' } });
    expect(await refused(w, 'me.updatePreferences', { adminReach: 'all' })).toMatchObject({ code: 'forbidden', details: { action: 'me.adminReach' } });
  });

  it('send a request or a bug for the person with no screenshot, and leave the upload IDs out of the tool', async () => {
    const w = world(MEMBER);
    const report = await ok(w, 'feedback.send', { kind: 'feature', message: 'Add a print view.', page: '/projects' });
    expect(report).toMatchObject({ kind: 'feature', message: 'Add a print view.', screenshots: [], status: 'new' });
    const tool = mcpTools({ admin: true }).find((item) => item.name === 'feedback.send')!;
    expect(Object.keys(tool.inputSchema.properties as object).sort()).toEqual(['kind', 'message', 'page', 'storyId']);
    expect(MCP_DENY).toContain('feedback.uploadStart');
  });
});

describe('the templates, the Tracker, payments and meetings', () => {
  it('make and delete a stage template, and read where a project template is used', async () => {
    const w = world();
    await ok(w, 'stageTemplates.save', { name: 'Small villa stages', stages: ['Concept', 'Design'] });
    const rows = await ok(w, 'stageTemplates.list', {});
    const template = (rows as { id: string; name: string }[]).find((item) => item.name === 'Small villa stages')!;
    expect(await ok(w, 'stageTemplates.delete', { id: template.id })).toBeDefined();
    const base = Object.values(stateOf(w).projectTemplates ?? {})[0];
    const usage = await ok(w, 'projectTemplates.usage', { templateId: base.id });
    expect(usage).toMatchObject({ linked: expect.any(Array), notLinked: expect.any(Array) });
  });

  it('give a Tracker reply, export the log, and delete the entry', async () => {
    const w = world();
    const project = firstActive(stateOf(w));
    const colleague = Object.values(stateOf(w).members).find((m) => m.projectId === project.id && m.userId !== ADMIN)!.userId;
    const logged = await ok(w, 'tracker.log', { projectId: project.id, type: 'message', direction: 'in', title: 'The client asked for the plan', waiting: 'us', date: '2026-10-04' });
    await ok(w, 'tracker.assignReply', { id: logged.entry.id, userId: colleague, dueDate: '2026-10-08' });
    expect(stateOf(w).tracker![logged.entry.id].replyTaskId).toBeDefined();
    const rows = await ok(w, 'tracker.export', { projectId: project.id });
    expect(rows.length).toBeGreaterThan(0);
    await ok(w, 'tracker.delete', { id: logged.entry.id });
    expect(stateOf(w).tracker![logged.entry.id]).toBeUndefined();
  });

  it('delete a payment and a cancelled meeting, and refuse the payment delete to a person without the payment right', async () => {
    const w = world();
    const project = firstActive(stateOf(w));
    await ok(w, 'payments.create', { projectId: project.id, name: 'Fee', amount: 1000, dueDate: '2026-11-04' });
    const payment = Object.values(stateOf(w).payments ?? {}).find((p) => p.name === 'Fee')!;
    expect(await ok(w, 'payments.delete', { id: payment.id })).toEqual({ deleted: true });
    await ok(w, 'meetings.create', { kind: 'team', title: 'Weekly', startsAt: '2026-10-10T09:00:00+03:00' });
    const meeting = Object.values(stateOf(w).meetings ?? {}).find((m) => m.title === 'Weekly')!;
    const early = await refused(w, 'meetings.delete', { id: meeting.id });
    expect(early).toMatchObject({ code: 'conflict' });
    await ok(w, 'meetings.cancel', { id: meeting.id });
    expect(await ok(w, 'meetings.delete', { id: meeting.id })).toEqual({ deleted: 1 });
    // A Member holds no payment right: the tool is not in the list, and a call is an unknown tool.
    const member = world(MEMBER);
    expect(await listed(member)).not.toContain('payments.delete');
    await unknown(member, 'payments.delete', { id: payment.id });
  });
});

describe('the Admin work, for the agent of the Admin', () => {
  it('add, change, turn off, turn on and remove a person, and read the invitations', async () => {
    const w = world();
    const created = await confirmed(w, 'users.create', { name: 'Layla Hassan', nameAr: 'ليلى حسن', email: 'layla@madar.test', discipline: 'Architect', systemRole: 'member' });
    expect(created).toMatchObject({ name: 'Layla Hassan', systemRole: 'member', active: true });
    expect((await ok(w, 'users.get', { id: created.id })).email).toBe('layla@madar.test');
    await ok(w, 'users.update', { id: created.id, patch: { discipline: 'Site engineer' } });
    expect(stateOf(w).users[created.id].discipline).toBe('Site engineer');
    await confirmed(w, 'users.deactivate', { id: created.id });
    expect(stateOf(w).users[created.id].active).toBe(false);
    await confirmed(w, 'users.reactivate', { id: created.id });
    await confirmed(w, 'users.deactivate', { id: created.id });
    await confirmed(w, 'users.remove', { id: created.id });
    expect(stateOf(w).users[created.id].removed).toBe(true);
    // The email and the picture of a person never change through an agent.
    const email = await refused(w, 'users.update', { id: MEMBER, patch: { email: 'new@madar.test' } });
    expect(email).toMatchObject({ code: 'forbidden', details: { action: 'people.email' } });
    // The tool leaves the picture out and refuses the key: the patch is strict, so the request fails before runCall.
    const picture = await callRaw(w, 'users.update', { id: MEMBER, patch: { avatarUrl: 'https://example.com/me.png' } });
    expect(picture.result?.isError).toBe(true);
    expect(JSON.stringify(picture.result)).toContain('Unrecognized key');
    expect(stateOf(w).users[MEMBER].avatarUrl).toBe(seed.users[MEMBER].avatarUrl);
    const tool = mcpTools({ admin: true }).find((item) => item.name === 'users.update')!;
    const patch = (tool.inputSchema.properties as Record<string, { properties: Record<string, unknown> }>).patch.properties;
    expect(Object.keys(patch)).not.toContain('avatarUrl');
  });

  it('change a client, make and delete a team, a sub-company and a role, and read and change the office settings', async () => {
    const w = world();
    const client = Object.values(stateOf(w).clients)[0];
    await ok(w, 'clients.update', { id: client.id, patch: { phone: '+966 13 555 0100' } });
    expect(stateOf(w).clients[client.id].phone).toBe('+966 13 555 0100');
    await ok(w, 'teams.create', { name: 'Site visits', memberIds: [MEMBER] });
    const team = Object.values(stateOf(w).teams ?? {}).find((t) => t.name === 'Site visits')!;
    expect(await ok(w, 'teams.list', {})).toEqual(expect.arrayContaining([expect.objectContaining({ id: team.id })]));
    await ok(w, 'teams.update', { id: team.id, name: 'Site visits and surveys' });
    await ok(w, 'teams.delete', { id: team.id });
    expect(stateOf(w).teams![team.id]).toBeUndefined();
    await ok(w, 'subCompanies.save', { name: 'Marsa Design', nameAr: 'مرسى للتصميم', logo: null });
    const sub = Object.values(stateOf(w).subCompanies ?? {}).find((c) => c.name === 'Marsa Design')!;
    await ok(w, 'subCompanies.save', { id: sub.id, name: 'Marsa Design', nameAr: 'مرسى للتصميم', logo: 'data:image/png;base64,AAAA' });
    expect(stateOf(w).subCompanies![sub.id].logo).toBe('data:image/png;base64,AAAA');
    // A logo that is no picture data fails at the MCP check of the arguments or inside the call, and the logo stays.
    const badLogo = await callRaw(w, 'subCompanies.save', { id: sub.id, name: 'Marsa Design', nameAr: 'مرسى للتصميم', logo: 'https://example.com/logo.png' });
    expect(badLogo.error !== undefined || badLogo.result?.isError === true).toBe(true);
    expect(stateOf(w).subCompanies![sub.id].logo).toBe('data:image/png;base64,AAAA');
    await ok(w, 'subCompanies.delete', { id: sub.id, moveToId: null });
    const settings = await ok(w, 'settings.get', {});
    await ok(w, 'settings.update', { staleAfterDays: settings.staleAfterDays + 1 });
    expect(stateOf(w).settings.staleAfterDays).toBe(settings.staleAfterDays + 1);
    await confirmed(w, 'roles.create', { name: 'Site supervisors', nameAr: 'مشرفو المواقع', rights: ['task.deleteOwn'] });
    const role = stateOf(w).settings.roles!.custom!.find((r) => r.name === 'Site supervisors')!;
    await confirmed(w, 'roles.update', { role: role.id, name: 'Site supervisors, Al Khobar' });
    await confirmed(w, 'roles.delete', { id: role.id });
    expect(stateOf(w).settings.roles?.custom?.some((r) => r.id === role.id)).toBe(false);
  });

  it('record the changes of people and roles with both names, and refuse an agent the Undo of them', async () => {
    const w = world();
    await confirmed(w, 'roles.create', { name: 'Site supervisors', nameAr: 'مشرفو المواقع', rights: ['task.deleteOwn'] });
    const event = Object.values(stateOf(w).events).find((item) => item.verb === 'role.created')!;
    expect(event).toMatchObject({ actorId: 'usr_009', actingForId: ADMIN, actorKind: 'agent' });
    const undo = await refused(w, 'events.undo', { eventId: event.id });
    expect(undo.code).toBe('forbidden');
  });
});

describe('the Admin work, for a person without the Admin right or the AI switch', () => {
  const rolesTools = ['roles.create', 'roles.update', 'roles.delete'];
  const adminTools = ['users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'users.invites', 'users.resendInvite', 'clients.update',
    'teams.create', 'teams.update', 'teams.delete', 'subCompanies.save', 'subCompanies.delete', 'settings.update', ...rolesTools];

  it('give the agent of a Member none of them, and fail a call with ai_off (a right tool) or as an unknown tool (a role tool)', async () => {
    const w = world(MEMBER);
    const names = await listed(w);
    for (const name of adminTools) expect(names, name).not.toContain(name);
    for (const [name, args] of [
      ['users.create', { name: 'X', email: 'x@madar.test', systemRole: 'member', discipline: 'Design' }],
      ['settings.update', { staleAfterDays: 9 }],
    ] as const) {
      const error = await refused(w, name, args);
      expect(error).toMatchObject({ code: 'forbidden' });
      // A Member holds neither the people right nor the office right, and ai.admin is off: the right tools stay unknown to the list, and the call names the switch.
      expect(error.details, name).toMatchObject({ reason: 'ai_off', right: 'ai.admin' });
    }
    await unknown(w, 'roles.update', { role: 'member', name: 'X' });
    expect(Object.keys(stateOf(w).users).length).toBe(Object.keys(seed.users).length + 1);
    expect(Object.values(stateOf(w).users).some((u) => u.email === 'x@madar.test')).toBe(false);
  });

  it('give the Management person the people tools only when the Admin turns ai.admin on, and keep the role tools for the Admin', async () => {
    const off = world(MANAGEMENT);
    expect(await listed(off)).not.toContain('users.create');
    expect(await refused(off, 'users.update', { id: MEMBER, patch: { discipline: 'Planner' } })).toMatchObject({ details: { reason: 'ai_off', right: 'ai.admin' } });
    const on = world(MANAGEMENT, (state) => {
      state.settings.roles = { rights: { management: [...DEFAULT_EXTRA.management, 'ai.admin'] } };
    });
    const names = await listed(on);
    for (const name of ['users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'users.invites', 'users.resendInvite', 'teams.create', 'teams.update', 'teams.delete']) expect(names, name).toContain(name);
    // Management holds no right to change a client, a sub-company or the settings, and never the role calls.
    for (const name of ['clients.update', 'subCompanies.save', 'settings.update', ...rolesTools]) expect(names, name).not.toContain(name);
    await ok(on, 'users.update', { id: MEMBER, patch: { discipline: 'Planner' } });
    expect(stateOf(on).users[MEMBER].discipline).toBe('Planner');
    // The same refusal as in the screens: Management never makes an Admin.
    const promote = await refused(on, 'users.update', { id: MEMBER, patch: { systemRole: 'admin' } });
    expect(promote).toMatchObject({ code: 'forbidden', details: { action: 'people.manage' } });
    await unknown(on, 'roles.update', { role: 'member', name: 'X' });
  });

  it('give a custom role with ai.admin and no right for the call no tool of it', async () => {
    const role: CustomRole = roleWithout([], ['ai.admin']);
    const w = world(MEMBER, (state) => {
      giveRole(state, MEMBER, role);
    });
    const names = await listed(w);
    expect(names).not.toContain('users.create');
    await unknown(w, 'users.create', { name: 'X', email: 'x@madar.test', systemRole: 'member', discipline: 'Design' });
  });
});

describe('the email code guard through MCP (owner decision, 2026-10-26)', () => {
  const GUARDED = ['users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'roles.create', 'roles.update', 'roles.delete'];

  it('gives confirmCode to the eight guarded tools and to no other tool', () => {
    for (const tool of mcpTools({ admin: true })) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string }>;
      expect('confirmCode' in properties, tool.name).toBe(GUARDED.includes(tool.name));
      expect((tool.inputSchema.required as string[] | undefined) ?? [], tool.name).not.toContain('confirmCode');
    }
    // A code is six digits: the check of the tool refuses another shape before the call runs.
    const tool = mcpTools({ admin: true }).find((item) => item.name === 'users.deactivate')!;
    expect(tool.input.safeParse({ id: MEMBER, confirmCode: '12345' }).success).toBe(false);
    expect(tool.input.safeParse({ id: MEMBER, confirmCode: 'abcdef' }).success).toBe(false);
    expect(tool.input.safeParse({ id: MEMBER, confirmCode: '123456' }).success).toBe(true);
    expect(tool.input.safeParse({ id: MEMBER }).success).toBe(true);
  });

  it('explains the flow in the text of each guarded tool and in the instructions, and keeps each text at 600 characters at most', () => {
    for (const name of GUARDED) {
      const text = TOOL_DOCS[name].description;
      expect(text, name).toContain('confirmCode');
      expect(text, name).toContain('confirm_needed');
      expect(text.length, name).toBeLessThanOrEqual(600);
    }
    expect(INSTRUCTIONS).toContain('Codes for risky Admin acts');
    expect(INSTRUCTIONS).toContain('confirm_needed');
    for (const name of GUARDED) expect(INSTRUCTIONS, name).toContain(name);
  });

  it('answers the first call with confirm_needed, changes nothing, and writes one mail row to the person with the code in it', async () => {
    const w = world();
    const users = Object.keys(stateOf(w).users).length;
    const error = await refused(w, 'users.create', { name: 'Layla Hassan', email: 'layla@madar.test', discipline: 'Architect', systemRole: 'admin' });
    expect(error).toMatchObject({ code: 'forbidden', details: { reason: 'confirm_needed', expiresInMinutes: 10 } });
    expect(error.message).toContain('confirmCode');
    expect(Object.keys(stateOf(w).users)).toHaveLength(users);
    const rows = w.mem.tables.outbox.filter((row) => row.kind === 'mcp.confirm');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ personId: ADMIN, agent: expect.any(String), act: { key: 'usersCreate' } });
    // The answer never holds the code.
    expect(JSON.stringify(error)).not.toContain(String(rows[0].payload.code));
  });

  it('refuses a wrong code and a code for other arguments through MCP', async () => {
    const w = world();
    const args = { id: MEMBER };
    await refused(w, 'users.deactivate', args);
    const rows = () => w.mem.tables.outbox.filter((row) => row.kind === 'mcp.confirm');
    const code = String(rows()[0].payload.code);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await refused(w, 'users.deactivate', { ...args, confirmCode: wrong })).toMatchObject({ code: 'forbidden', details: { reason: 'confirm_wrong' } });
    expect(await refused(w, 'users.deactivate', { id: 'usr_004', confirmCode: code })).toMatchObject({ code: 'forbidden', details: { reason: 'confirm_invalid' } });
    expect(stateOf(w).users[MEMBER].active).toBe(true);
    await ok(w, 'users.deactivate', { ...args, confirmCode: code });
    expect(stateOf(w).users[MEMBER].active).toBe(false);
    expect(rows()).toHaveLength(1);
  });

  it('asks no code for the calls that only look like the guarded ones', async () => {
    const w = world();
    await ok(w, 'users.update', { id: MEMBER, patch: { discipline: 'Planner' } });
    await ok(w, 'teams.create', { name: 'Site visits', memberIds: [MEMBER] });
    await ok(w, 'settings.update', { staleAfterDays: 9 });
    expect(w.mem.tables.outbox.filter((row) => row.kind === 'mcp.confirm')).toHaveLength(0);
  });
});

describe('the lists, the AI switches and the words of the parity track', () => {
  const opened = [
    'projects.setLeader', 'projects.pause', 'projects.resume', 'projects.setRestart', 'projects.setAccess', 'projects.addLink', 'projects.updateLink', 'projects.removeLink',
    'projects.setHealthOverride', 'projects.clearHealthOverride', 'members.add', 'members.addTeam', 'members.remove', 'members.update', 'stages.setPrerequisites', 'deadlines.delete',
    'tasks.createFromTemplate', 'tasks.newVersion', 'tasks.delete', 'updates.update', 'updates.delete', 'comments.update', 'comments.delete', 'reactions.toggle',
    'chats.editMessage', 'chats.deleteMessage', 'files.link', 'files.delete', 'files.markDelivered', 'files.share',
    'notifications.list', 'notifications.count', 'notifications.markRead', 'notifications.markAllRead', 'notifications.markUnread', 'notifications.updateSettings',
    'chats.markRead', 'chats.markUnread', 'chats.unreadCount', 'chats.archive', 'chats.setNotify', 'chats.createGroup', 'chats.updateGroup', 'chats.leaveGroup',
    'stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete', 'projectTemplates.save', 'projectTemplates.delete', 'projectTemplates.matchPlan', 'projectTemplates.link',
    'projectTemplates.usage', 'projectTemplates.syncPlan', 'projectTemplates.syncApply', 'taskTemplates.list', 'taskTemplates.save', 'taskTemplates.rename', 'taskTemplates.delete',
    'tracker.delete', 'tracker.assignReply', 'tracker.export', 'payments.delete', 'meetings.delete',
    'me.updateProfile', 'me.updatePreferences', 'feedback.send', 'agents.list', 'agents.remove',
    'users.get', 'users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'users.invites', 'users.resendInvite', 'clients.update',
    'teams.list', 'teams.create', 'teams.update', 'teams.delete', 'subCompanies.save', 'subCompanies.delete', 'settings.get', 'settings.update', 'roles.create', 'roles.update', 'roles.delete',
  ];
  const needsAsk = [
    'projects.setLeader', 'projects.pause', 'projects.resume', 'projects.setAccess', 'projects.removeLink', 'projects.setHealthOverride', 'members.add', 'members.addTeam', 'members.remove',
    'deadlines.delete', 'tasks.newVersion', 'tasks.delete', 'updates.delete', 'comments.delete', 'chats.editMessage', 'chats.deleteMessage', 'chats.createGroup', 'chats.updateGroup',
    'chats.leaveGroup', 'files.delete', 'files.markDelivered', 'files.share', 'stageTemplates.save', 'stageTemplates.delete', 'projectTemplates.save', 'projectTemplates.delete',
    'projectTemplates.link', 'projectTemplates.syncApply', 'taskTemplates.save', 'taskTemplates.delete', 'tracker.delete', 'tracker.assignReply', 'payments.delete', 'meetings.delete',
    'agents.remove', 'users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'users.resendInvite', 'clients.update', 'teams.create', 'teams.update',
    'teams.delete', 'subCompanies.save', 'subCompanies.delete', 'settings.update', 'roles.create', 'roles.update', 'roles.delete',
  ];

  it('opens each of the 88 tools in exactly one list, with exactly one AI switch', () => {
    expect(opened).toHaveLength(88);
    for (const name of opened) {
      const where = [MCP_ALLOW as readonly string[], MCP_ADMIN as readonly string[], Object.keys(MCP_BY_RIGHT), MCP_DENY as readonly string[]].filter((list) => list.includes(name));
      expect(where, name).toHaveLength(1);
      expect(MCP_DENY as readonly string[], name).not.toContain(name);
      const owners = AI_SWITCHES.filter((id) => aiSwitchOf(name) === id);
      expect(owners, name).toHaveLength(1);
    }
  });

  it('keeps on the deny list the calls that cannot work for an agent or that the owner kept in the screens', () => {
    for (const name of ['projects.delete', 'session.get', 'push.register', 'push.remove', 'push.mine', 'live.ticket', 'chats.typing', 'google.connectStart', 'google.connect', 'google.status', 'google.disconnect',
      'meetings.settle', 'meetings.extend', 'files.upload', 'files.uploadStart', 'feedback.uploadStart']) {
      expect(MCP_DENY as readonly string[], name).toContain(name);
    }
  });

  it('writes a short exact doc for each opened tool, and "Ask your person first" on the deletes, the invitations and the Admin work', () => {
    const dash = String.fromCharCode(0x2014);
    for (const name of opened) {
      const doc = TOOL_DOCS[name];
      expect(doc, name).toBeDefined();
      expect(doc.description.length, name).toBeGreaterThanOrEqual(40);
      expect(doc.description.length, name).toBeLessThanOrEqual(600);
      expect(doc.title + doc.description, name).not.toContain(dash);
    }
    for (const name of needsAsk) expect(TOOL_DOCS[name].description, name).toMatch(/Ask your person|ask your person/);
  });

  it('tells the agent the new rules in INSTRUCTIONS, and drops the old "agent never" lines of the opened tools', () => {
    expect(INSTRUCTIONS).toContain('Marks and screen state:');
    expect(INSTRUCTIONS).toContain('Do these only when your person asks.');
    expect(INSTRUCTIONS).toContain('Ask first:');
    // The rule that a project delete stays in the screens has one place: New projects (join check, 2026-10-26).
    expect(INSTRUCTIONS.match(/delete[s]? a project/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(INSTRUCTIONS).toContain('Admin work:');
    expect(INSTRUCTIONS).toContain('Only an Admin deletes a project, in the Madar screens.');
    for (const old of [
      'You cannot mark a chat read or unread', 'never delete one', 'Only your person edits, deletes or reacts to a message, in the screens', 'You cannot add or change a link',
      'You cannot read or change quiet hours', 'The person pauses, resumes and moves the date in the Madar screens', 'You never change the switches of a role.',
    ]) expect(INSTRUCTIONS, old).not.toContain(old);
    expect(INSTRUCTIONS).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  });
});
