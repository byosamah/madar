import { beforeAll, describe, expect, it } from 'vitest';
import type { Meeting } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { makeTask } from '../../src/test/factories';
import { createRunCall } from '../core/runCall';
import { giveRole, roleWithout } from './aiRoles.testing';
import { aiSwitchOf } from './aiSwitches';
import { call } from './bulk.testing';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_BY_RIGHT, MCP_DENY, NO_CALL_TOOLS, mcpTools } from './tools';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_CHARS, decodeBase64 } from './upload';
import { base64Of, sampleBytes, uploadWorld, type UploadWorld } from './upload.testing';

/**
 * files.uploadContent (owner, 2026-10-26: "the agent sends the file content in the call", 10 MB at most). The tool runs files.uploadStart, puts the
 * bytes to the signed link on the server side, then runs files.upload, all with the rights of the person. In the sample office usr_002 leads
 * prj_001, usr_005 is on its team, and usr_003 is not on it. The harness adds a chat, an office to-do and a finished meeting.
 */

const PROJECT = 'prj_001';
const PDF = new TextEncoder().encode('%PDF-1.4 a small plan');
let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

/** A direct chat of usr_002 and usr_004, an office to-do of usr_002, and a meeting of usr_002 with usr_004 that ended at 08:00 on the test day. */
function extras(state: State): void {
  state.conversations = { ...state.conversations, cnv_901: { id: 'cnv_901', kind: 'direct', projectId: null, memberIds: ['usr_002', 'usr_004'], createdAt: '2026-10-04T09:00:00+03:00' } as never };
  state.tasks.tsk_901 = makeTask({ id: 'tsk_901', projectId: null, stageId: null, title: 'Licence', ownerId: 'usr_002', createdBy: 'usr_002', needsReview: false, helperIds: [] });
  const meeting: Meeting = {
    id: 'mtg_901', kind: 'meeting', title: 'Site talk', projectId: null, startsAt: '2026-10-04T07:00:00.000+03:00', endsAt: '2026-10-04T08:00:00.000+03:00', where: '', guests: '', notes: '',
    organizerId: 'usr_002', attendeeIds: ['usr_004'], status: 'scheduled', rev: 1, createdBy: 'usr_002', createdAt: '2026-10-01T09:00:00.000+03:00',
  };
  state.meetings = { ...(state.meetings ?? {}), mtg_901: meeting };
}

const world = (person = 'usr_002', prepare?: (state: State) => void, o?: { maxFileBytes?: number }) => uploadWorld(seed, person, (state) => { extras(state); prepare?.(state); }, o);
const pdf = (extra: Record<string, unknown> = {}) => ({ projectId: PROJECT, name: 'Plan.pdf', type: 'application/pdf', contentBase64: base64Of(PDF), ...extra });
type Answer = { id: string; name: string; version: string; size: number; type: string; uploadedAt: string; place: Record<string, unknown> };
const answerOf = (result: Record<string, any>) => result.structuredContent.output as Answer;
const errorOf = (result: Record<string, any>) => result.structuredContent?.error as { code: string; message: string; details?: Record<string, any> } | undefined;
const noStoreWork = (w: UploadWorld) => {
  expect(w.files.calls).toEqual([]);
  expect(w.puts).toEqual([]);
  expect(w.filesDb.intents.size).toBe(0);
};

/** The same call as the screens make it, for a person: the refusal that the tool must repeat. */
async function screensCall(w: UploadWorld, personId: string, name: string, input: Record<string, unknown>) {
  const run = createRunCall({ data: () => w.mem.data() });
  return run(w.deps, { principal: { userId: personId }, name, input, batch: { storyRefs: new Map(), office: await w.mem.data().office(), overviewCalls: 0 } });
}

describe('files.uploadContent is a tool (owner, 2026-10-26)', () => {
  it('sits in the allowlist only, has no call of its own, and uses the AI switch of the file tools (ai.projects)', () => {
    expect(MCP_ALLOW).toContain('files.uploadContent');
    expect(MCP_DENY as readonly string[]).not.toContain('files.uploadContent');
    expect(Object.keys(MCP_BY_RIGHT)).not.toContain('files.uploadContent');
    expect(NO_CALL_TOOLS.has('files.uploadContent')).toBe(true);
    expect(aiSwitchOf('files.uploadContent')).toBe('ai.projects');
    expect(aiSwitchOf('files.uploadContent')).toBe(aiSwitchOf('files.move'));
  });

  it('leaves the three upload calls of the screens on the deny list: the tool runs them inside', () => {
    for (const name of ['files.upload', 'files.uploadStart', 'feedback.uploadStart']) expect(MCP_DENY as readonly string[], name).toContain(name);
  });

  it('is a write that adds a record and takes a story; the input names the place, the name, the type and the content', () => {
    const tool = mcpTools().find((t) => t.name === 'files.uploadContent')!;
    expect(tool.readOnly).toBe(false);
    expect(tool.takesStory).toBe(true);
    expect(tool.annotations.destructiveHint).toBe(false);
    expect(Object.keys(tool.inputSchema.properties as object).sort()).toEqual([
      'contentBase64', 'conversationId', 'folderId', 'meetingId', 'name', 'projectId', 'receivedFromClient', 'stageId', 'storyId', 'taskId', 'type',
    ]);
    expect(tool.inputSchema.required).toEqual(['name', 'type', 'contentBase64']);
  });

  it('has a short doc, and INSTRUCTIONS tells the agent how to upload, the limit, the rights and the picture rules', () => {
    const doc = TOOL_DOCS['files.uploadContent'].description;
    expect(doc.length).toBeLessThanOrEqual(600);
    for (const word of ['contentBase64', '10 MB', 'upload rights', 'safe-type', 'new version', 'never gives a link', 'conversationId', 'chats.send']) expect(doc, word).toContain(word);
    expect(doc).not.toMatch(/[–—]/);
    const files = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Files: '))!;
    for (const word of ['files.uploadContent', 'contentBase64', '10 MB', 'upload rights', 'safe-type']) expect(files, word).toContain(word);
    expect(files).not.toContain('the person uses the Madar screens');
    const pictures = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Pictures: '))!;
    // Pictures are uploads too (owner, 2026-10-26): a small picture goes as a data address, a cover is a file.
    for (const word of ['files.uploadContent', 'coverFileId', 'me.updateProfile', 'subCompanies.save', '24,000', 'data address']) expect(pictures, word).toContain(word);
    expect(pictures).not.toContain('You cannot upload or change a picture');
    expect(pictures).not.toContain('cannot set a profile picture or a sub-company logo');
    expect(TOOL_DOCS['files.list'].description).toContain('files.uploadContent');
  });
});

describe('decodeBase64', () => {
  it('decodes standard base64 with and without padding, and refuses everything else', () => {
    for (const size of [1, 2, 3, 4, 5, 100, 70_000]) {
      const bytes = sampleBytes(size);
      expect(Array.from(decodeBase64(base64Of(bytes))!), `${size} bytes`).toEqual(Array.from(bytes));
    }
    for (const text of ['', 'abc', 'ab cd', 'abcd\n', 'ab=c', 'a-b_', 'data:text/plain;base64,QUJD', 'QUJD=', '====']) expect(decodeBase64(text), text).toBeNull();
  });
});

describe('files.uploadContent over MCP', () => {
  it('uploads a project file: the record has the right size and type, files.list shows it, the object sits at the final key, and staging is empty', async () => {
    const w = world();
    const result = await call(w, 'files.uploadContent', pdf({ stageId: 'stg_005' }));
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const out = answerOf(result);
    expect(out).toMatchObject({ name: 'Plan.pdf', version: 'A', size: PDF.length, type: 'application/pdf', place: { projectId: PROJECT, stageId: 'stg_005', folderId: null, taskId: null } });
    expect(out.id).toMatch(/^fil_/);
    const listed = await call(w, 'files.list', { projectId: PROJECT });
    const row = (listed.structuredContent.output as { file: { id: string; name: string }; latest: { size: number; mimeType: string } }[]).find((r) => r.file.id === out.id)!;
    expect(row.file.name).toBe('Plan.pdf');
    expect(row.latest).toMatchObject({ size: PDF.length, mimeType: 'application/pdf' });
    const keys = [...w.files.objects.keys()];
    expect(keys.filter((key) => key.startsWith('up/'))).toEqual([]);
    const final = keys.filter((key) => key.startsWith('prj-001/') && key.endsWith('/file'));
    expect(final).toHaveLength(1);
    expect(w.files.objects.get(final[0])).toEqual({ size: PDF.length, mimeType: 'application/pdf' });
    expect(new Uint8Array(await w.content.get(final[0])!.arrayBuffer())).toEqual(PDF);
    // The server put the bytes once, to the signed link, with exactly the signed headers.
    expect(w.puts).toHaveLength(1);
    expect(w.puts[0]).toMatchObject({ size: PDF.length, headers: { 'Content-Type': 'application/pdf' } });
    expect(w.puts[0].url).toMatch(/^https:\/\/files\.test\/put\/up\/upl-/);
  });

  it('gives an answer with no storage key and no signed link', async () => {
    const w = world();
    const result = await call(w, 'files.uploadContent', pdf());
    const text = JSON.stringify(result);
    for (const bad of ['blobKey', 'thumbKey', 'prj-001/', 'up/upl', 'files.test', 'https://', 'token', 'uploadId']) expect(text, bad).not.toContain(bad);
    expect(Object.keys(answerOf(result)).sort()).toEqual(['id', 'name', 'place', 'size', 'type', 'uploadedAt', 'version']);
  });

  it('counts as one tool call', async () => {
    const w = world();
    await call(w, 'files.uploadContent', pdf());
    expect(w.hits.count).toBe(1);
  });

  it('writes one History line that names the agent and its person, and a story groups it', async () => {
    const w = world();
    const story = (await call(w, 'story.start', {})).structuredContent.output.storyId as string;
    const result = await call(w, 'files.uploadContent', pdf({ storyId: story }));
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(result.structuredContent.storyId).toBe(story);
    const events = Object.values(w.mem.tables.state.events).filter((e) => e.verb === 'file.added' && e.targetId === answerOf(result).id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: 'usr_950', actorKind: 'agent', actingForId: 'usr_002', projectId: PROJECT });
    expect(events[0].correlationId).toBe(story);
  });

  it('adds a new version when the name is in the place already', async () => {
    const w = world();
    const first = answerOf(await call(w, 'files.uploadContent', pdf()));
    const second = answerOf(await call(w, 'files.uploadContent', pdf({ contentBase64: base64Of(new TextEncoder().encode('%PDF-1.4 second')) })));
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ version: 'B', size: '%PDF-1.4 second'.length });
  });

  it('puts the file in a folder of the stage, and the folder is the folder of files.list', async () => {
    const w = world();
    const made = await call(w, 'folders.create', { projectId: PROJECT, stageId: 'stg_005', name: 'Permits' });
    const folderId = made.structuredContent.output.id as string;
    const result = await call(w, 'files.uploadContent', pdf({ folderId }));
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(answerOf(result).place).toMatchObject({ projectId: PROJECT, stageId: 'stg_005', folderId });
  });

  it('uploads to an office to-do with taskId alone, and the person who does not see the to-do gets not_found', async () => {
    const w = world();
    const result = await call(w, 'files.uploadContent', { taskId: 'tsk_901', name: 'Licence.pdf', type: 'application/pdf', contentBase64: base64Of(PDF) });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(answerOf(result).place).toMatchObject({ projectId: null, taskId: 'tsk_901' });
    const listed = await call(w, 'files.list', { taskId: 'tsk_901' });
    expect(listed.structuredContent.output).toHaveLength(1);
    const outsider = world('usr_003');
    const refused = await call(outsider, 'files.uploadContent', { taskId: 'tsk_901', name: 'Licence.pdf', type: 'application/pdf', contentBase64: base64Of(PDF) });
    expect(errorOf(refused)).toMatchObject({ code: 'not_found' });
    noStoreWork(outsider);
  });

  it('uploads to a finished meeting with no project for its organizer, and not_found for a person outside it', async () => {
    const w = world();
    const result = await call(w, 'files.uploadContent', { meetingId: 'mtg_901', name: 'Minutes.pdf', type: 'application/pdf', contentBase64: base64Of(PDF) });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(answerOf(result).place).toMatchObject({ projectId: null, meetingId: 'mtg_901' });
    const outsider = world('usr_005');
    const refused = await call(outsider, 'files.uploadContent', { meetingId: 'mtg_901', name: 'Minutes.pdf', type: 'application/pdf', contentBase64: base64Of(PDF) });
    expect(errorOf(refused)).toMatchObject({ code: 'not_found' });
    noStoreWork(outsider);
  });
});

describe('files.uploadContent keeps the refusals of the screens', () => {
  it('refuses a person without the upload right, and an outsider of the project, with the refusal of files.uploadStart and no store work', async () => {
    for (const person of ['usr_005', 'usr_003']) {
      const w = world(person, (state) => {
        if (person === 'usr_005') giveRole(state, 'usr_005', roleWithout(['file.upload.team']));
      });
      const result = await call(w, 'files.uploadContent', pdf());
      expect(result.isError, person).toBe(true);
      const screens = await screensCall(w, person, 'files.uploadStart', { projectId: PROJECT, name: 'Plan.pdf', size: PDF.length, mimeType: 'application/pdf' });
      expect(screens.ok, person).toBe(false);
      expect(errorOf(result), person).toEqual((screens as { error: unknown }).error);
      expect(errorOf(result)).toMatchObject({ code: 'forbidden', details: { action: 'file.upload' } });
      expect(Object.values(w.mem.tables.state.files).filter((f) => f.name === 'Plan.pdf'), person).toEqual([]);
      noStoreWork(w);
    }
  });

  it('refuses a chat upload by a person who is no member, with not_found and no store work, as the screens do', async () => {
    for (const person of ['usr_003', 'usr_001']) {
      const w = world(person);
      const result = await call(w, 'files.uploadContent', { conversationId: 'cnv_901', name: 'Photo.png', type: 'image/png', contentBase64: base64Of(PDF) });
      expect(errorOf(result), person).toMatchObject({ code: 'not_found', message: 'Conversation cnv_901 does not exist.' });
      expect(Object.values(w.mem.tables.state.files).filter((f) => f.conversationId === 'cnv_901'), person).toEqual([]);
      noStoreWork(w);
      const screens = await screensCall(w, person, 'files.uploadStart', { conversationId: 'cnv_901', name: 'Photo.png', size: 4, mimeType: 'image/png' });
      expect(screens).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    // A chat that does not exist answers the same.
    const w = world('usr_002');
    const missing = await call(w, 'files.uploadContent', { conversationId: 'cnv_404', name: 'Photo.png', type: 'image/png', contentBase64: base64Of(PDF) });
    expect(errorOf(missing)).toMatchObject({ code: 'not_found', message: 'Conversation cnv_404 does not exist.' });
    noStoreWork(w);
  });

  it('sends a file into a direct chat of its person (owner, 2026-10-26): the file stays in the chat, a message carries it, and the other member opens it', async () => {
    const w = world('usr_002');
    const result = await call(w, 'files.uploadContent', { conversationId: 'cnv_901', name: 'Photo.png', type: 'image/png', contentBase64: base64Of(PDF) });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const out = answerOf(result);
    expect(out.place).toMatchObject({ projectId: null, taskId: null, conversationId: 'cnv_901' });
    expect(w.mem.tables.state.files[out.id]).toMatchObject({ conversationId: 'cnv_901', projectId: null, name: 'Photo.png' });
    expect(w.mem.tables.state.files[out.id].versions[0].uploadedBy).toBe('usr_950');
    const final = [...w.files.objects.keys()].filter((key) => key.startsWith('chat/cnv-901/') && key.endsWith('/file'));
    expect(final).toHaveLength(1);
    // The file is no part of any list or search. A chat message carries it, and the agent reads the id, the name and the type there.
    const sent = await call(w, 'chats.send', { conversationId: 'cnv_901', body: 'The photo.', fileIds: [out.id] });
    expect(sent.isError, JSON.stringify(sent)).toBeUndefined();
    const read = await call(w, 'chats.messages', { conversationId: 'cnv_901' });
    const rows = read.structuredContent.output.messages as { message: { body: string }; files: { id: string; name: string }[] }[];
    expect(rows.find((row) => row.message.body === 'The photo.')?.files).toEqual([{ id: out.id, name: 'Photo.png', mimeType: 'image/png' }]);
    const link = await call(w, 'files.link', { id: out.id, variant: 'full', disposition: 'inline' });
    expect(link.isError, JSON.stringify(link)).toBeUndefined();
    expect(link.structuredContent.output.url).toMatch(/^https:\/\//);
    // The other member opens it too, and a person outside the chat does not.
    const member = world('usr_004');
    member.mem.tables.state.files[out.id] = w.mem.tables.state.files[out.id];
    member.mem.tables.version += 1;
    expect((await call(member, 'files.link', { id: out.id, variant: 'full', disposition: 'inline' })).isError).toBeUndefined();
  });

  it('keeps every person rule on a chat upload: a project chat and a closed chat refuse the agent as they refuse its person', async () => {
    const w = world('usr_002', (state) => {
      state.conversations = {
        ...state.conversations,
        cnv_902: { id: 'cnv_902', kind: 'direct', projectId: null, memberIds: ['usr_002', 'usr_011'], createdAt: '2026-10-04T09:00:00+03:00' } as never,
      };
      state.users.usr_011 = { ...state.users.usr_011, active: false };
    });
    const closed = await call(w, 'files.uploadContent', { conversationId: 'cnv_902', name: 'Photo.png', type: 'image/png', contentBase64: base64Of(PDF) });
    expect(errorOf(closed)).toMatchObject({ code: 'forbidden', details: { reason: 'person_left' } });
    const screens = await screensCall(w, 'usr_002', 'files.uploadStart', { conversationId: 'cnv_902', name: 'Photo.png', size: 4, mimeType: 'image/png' });
    expect(screens).toMatchObject({ ok: false, error: { code: 'forbidden', details: { reason: 'person_left' } } });
    noStoreWork(w);
  });

  it('gives the agent of an outsider not_found on every path of a chat file: the upload, the link and the messages, with no file name', async () => {
    const owner = world('usr_002');
    const out = answerOf(await call(owner, 'files.uploadContent', { conversationId: 'cnv_901', name: 'Hidden-chat-photo.png', type: 'image/png', contentBase64: base64Of(PDF) }));
    for (const person of ['usr_003', 'usr_001']) {
      const w = world(person);
      w.mem.tables.state.files[out.id] = owner.mem.tables.state.files[out.id];
      w.mem.tables.version += 1;
      const link = await call(w, 'files.link', { id: out.id, variant: 'full', disposition: 'inline' });
      expect(errorOf(link), person).toMatchObject({ code: 'not_found', message: `File ${out.id} does not exist.` });
      const messages = await call(w, 'chats.messages', { conversationId: 'cnv_901' });
      expect(errorOf(messages), person).toMatchObject({ code: 'not_found' });
      const upload = await call(w, 'files.uploadContent', { conversationId: 'cnv_901', name: 'Leak.png', type: 'image/png', contentBase64: base64Of(PDF) });
      expect(errorOf(upload), person).toMatchObject({ code: 'not_found' });
      for (const result of [link, messages, upload]) expect(JSON.stringify(result), person).not.toContain('Hidden-chat-photo');
      expect(w.puts, person).toEqual([]);
      expect(w.files.calls.filter((c) => c.op === 'presignGet'), person).toEqual([]);
    }
  });

  it('refuses a hidden project as a missing project', async () => {
    const w = world('usr_002', (state) => {
      state.projects.prj_005.access = { hidden: true, viewerIds: ['usr_011'] };
    });
    const result = await call(w, 'files.uploadContent', pdf({ projectId: 'prj_005' }));
    expect(errorOf(result)).toMatchObject({ code: 'not_found' });
    noStoreWork(w);
  });

  it('is closed by the AI switch ai.projects: the call fails with ai_off and nothing is stored', async () => {
    const w = world('usr_002', (state) => void giveRole(state, 'usr_002', roleWithout(['ai.projects'])));
    const result = await call(w, 'files.uploadContent', pdf());
    expect(errorOf(result)).toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.projects' } });
    noStoreWork(w);
  });

  it('stores a type that may not open in the browser as a download: the signed type is application/octet-stream, as on the screens', async () => {
    const w = world();
    const result = await call(w, 'files.uploadContent', pdf({ name: 'page.html', type: 'text/html' }));
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(w.puts[0].headers['Content-Type']).toBe('application/octet-stream');
    const final = [...w.files.objects.entries()].find(([key]) => key.startsWith('prj-001/'))!;
    expect(final[1].mimeType).toBe('application/octet-stream');
    // The link of the file is a download for such a type (server/files/links.ts); the record keeps the declared type.
    expect(answerOf(result).type).toBe('text/html');
  });

  it('refuses a type that is not a type before any store work', async () => {
    const w = world();
    const result = await call(w, 'files.uploadContent', pdf({ type: 'not a type' }));
    expect(errorOf(result)).toMatchObject({ code: 'invalid_input' });
    noStoreWork(w);
  });
});

describe('files.uploadContent and the size limit', () => {
  it('refuses a file of 10 MB plus one byte before any store work, with the limit in the answer', async () => {
    const w = world();
    const result = await call(w, 'files.uploadContent', pdf({ contentBase64: base64Of(sampleBytes(MAX_UPLOAD_BYTES + 1)) }));
    expect(errorOf(result)).toMatchObject({ code: 'invalid_input', details: { reason: 'file_too_large', limit: MAX_UPLOAD_BYTES } });
    noStoreWork(w);
  });

  it('refuses a text that is longer than any 10 MB file can be without decoding it', async () => {
    const w = world();
    const result = await call(w, 'files.uploadContent', pdf({ contentBase64: 'A'.repeat(MAX_UPLOAD_CHARS + 4) }));
    expect(errorOf(result)).toMatchObject({ code: 'invalid_input', details: { reason: 'file_too_large' } });
    noStoreWork(w);
  });

  it('refuses text that is not base64 before any store work', async () => {
    for (const text of ['not base64!', 'QUJD\nREVG', 'data:text/plain;base64,QUJD']) {
      const w = world();
      const result = await call(w, 'files.uploadContent', pdf({ contentBase64: text }));
      expect(errorOf(result), text).toMatchObject({ code: 'invalid_input', details: { reason: 'not_base64', fields: ['contentBase64'] } });
      noStoreWork(w);
    }
  });

  it('takes a file of exactly 10 MB through the whole app, and the stored bytes are the bytes that were sent', async () => {
    const w = world();
    const bytes = sampleBytes(MAX_UPLOAD_BYTES);
    const result = await call(w, 'files.uploadContent', pdf({ name: 'Big.bin', type: 'application/octet-stream', contentBase64: base64Of(bytes) }));
    expect(result.isError, JSON.stringify(result).slice(0, 300)).toBeUndefined();
    expect(answerOf(result).size).toBe(MAX_UPLOAD_BYTES);
    const final = [...w.files.objects.keys()].find((key) => key.startsWith('prj-001/'))!;
    const stored = new Uint8Array(await w.content.get(final)!.arrayBuffer());
    expect(stored.length).toBe(MAX_UPLOAD_BYTES);
    expect(Buffer.compare(stored, bytes)).toBe(0);
  }, 60_000);

  it('refuses the file when the file store is smaller than the file: the start call checks the limit of the store', async () => {
    const w = world('usr_002', undefined, { maxFileBytes: 1000 });
    const result = await call(w, 'files.uploadContent', pdf({ contentBase64: base64Of(sampleBytes(2000)) }));
    expect(errorOf(result)).toMatchObject({ code: 'invalid_input', details: { reason: 'file_too_large', limit: 1000 } });
    expect(w.puts).toEqual([]);
  });
});

describe('files.uploadContent when the store fails', () => {
  it('answers failed with upload_failed when the store refuses the PUT, saves no record, and never names the link', async () => {
    const w = world();
    w.failPut.status = 500;
    const result = await call(w, 'files.uploadContent', pdf());
    expect(errorOf(result)).toMatchObject({ code: 'failed', details: { reason: 'upload_failed', status: 500 } });
    expect(JSON.stringify(result)).not.toContain('files.test');
    expect(Object.values(w.mem.tables.state.files).filter((f) => f.name === 'Plan.pdf')).toEqual([]);
    // The intent stays unused: the uploads job removes the staging object after 2 hours 10 minutes. No cleanup of our own.
    expect([...w.filesDb.intents.values()].map((i) => i.usedAt)).toEqual([null]);
  });

  it('answers failed when the store does not answer at all', async () => {
    const w = world();
    w.failPut.status = 'network';
    const result = await call(w, 'files.uploadContent', pdf());
    expect(errorOf(result)).toMatchObject({ code: 'failed', details: { reason: 'upload_failed', status: 0 } });
    expect(Object.values(w.mem.tables.state.files).filter((f) => f.name === 'Plan.pdf')).toEqual([]);
  });
});

describe('the body limit of the MCP endpoint', () => {
  const modern = { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call' };
  const legacy = { 'MCP-Protocol-Version': '2025-11-25' };
  const raw = (w: UploadWorld, body: string, headers: Record<string, string> = {}) =>
    w.app.fetch(new Request('http://127.0.0.1/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer agent-token', ...headers },
      body,
    }));
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' } };
  /** A tools/call body. The earlier eras carry no _meta. */
  const rpc = (name: string, args: Record<string, unknown>, order: 'name-first' | 'args-first' = 'name-first', era: 'modern' | 'earlier' = 'modern') => {
    const extra = era === 'modern' ? { _meta: meta } : {};
    const params = order === 'name-first' ? { name, arguments: args, ...extra } : { arguments: args, name, ...extra };
    return JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });
  };

  it('keeps 256 KB for every other tool: a larger body gets 413 too_large, also with the name of an upload tool in the header', async () => {
    const w = world();
    const big = rpc('comments.create', { taskId: 'tsk_001', text: 'x'.repeat(300 * 1024) });
    for (const headers of [{ ...modern, 'Mcp-Name': 'comments.create' }, { ...modern, 'Mcp-Name': 'files.uploadContent' }, legacy]) {
      const response = await raw(w, big, headers);
      expect(response.status, JSON.stringify(headers)).toBe(413);
      expect(await response.json()).toMatchObject({ error: { data: { reason: 'too_large' } } });
    }
    expect(w.hits.count).toBe(0);
  });

  it('lets an upload of 10 MB through with the Mcp-Name header, and also from an earlier client that sends none (the name is in the first bytes)', async () => {
    for (const [era, headers] of [['modern', { ...modern, 'Mcp-Name': 'files.uploadContent' }], ['earlier', legacy]] as const) {
      const w = world();
      const response = await raw(w, rpc('files.uploadContent', pdf({ contentBase64: base64Of(sampleBytes(MAX_UPLOAD_BYTES)) }), 'name-first', era), headers);
      // An earlier client gets the answer as one server-sent event.
      const text = await response.text();
      const body = JSON.parse(text.startsWith('event:') ? text.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : text) as { result?: { isError?: boolean; structuredContent?: { output?: { size: number } } } };
      expect(response.status).toBe(200);
      expect(body.result?.isError, JSON.stringify(headers)).toBeUndefined();
      expect(body.result?.structuredContent?.output?.size).toBe(MAX_UPLOAD_BYTES);
    }
  }, 60_000);

  it('knows an upload by the name at the start of the body: an earlier client that sends the arguments first gets 413 past 256 KB', async () => {
    const w = world();
    const response = await raw(w, rpc('files.uploadContent', pdf({ contentBase64: base64Of(sampleBytes(1024 * 1024)) }), 'args-first', 'earlier'), legacy);
    expect(response.status).toBe(413);
    noStoreWork(w);
  });

  it('refuses a body past the upload limit', async () => {
    const w = world();
    const response = await raw(w, rpc('files.uploadContent', pdf({ contentBase64: 'A'.repeat(MAX_UPLOAD_CHARS + 200_000) })), { ...modern, 'Mcp-Name': 'files.uploadContent' });
    expect(response.status).toBe(413);
    noStoreWork(w);
  });
});
