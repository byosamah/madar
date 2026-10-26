import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { createRunCall } from '../core/runCall';
import { giveRole, roleWithout } from './aiRoles.testing';
import { aiOffError } from './aiSwitches';
import { TOKEN, call } from './bulk.testing';
import { base64Of, uploadWorld, type UploadWorld } from './upload.testing';

/**
 * The AI switches on the files of a chat (security review of 2026-10-26). A file of a direct chat or a group is chat data. The agent of a
 * member opens it only when its person holds "AI reads chats" (ai.readChats), as chats.messages needs it, and sends one into a chat only
 * when its person holds "AI sends messages" (ai.messages), as chats.send needs it. A person at the screen needs neither switch.
 * In the sample office usr_002 leads prj_001 and is in the direct chat cnv_901 with usr_004. usr_003 is in no chat.
 */

const PNG = new TextEncoder().encode('png-bytes');
let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

function extras(state: State): void {
  state.conversations = { ...state.conversations, cnv_901: { id: 'cnv_901', kind: 'direct', projectId: null, memberIds: ['usr_002', 'usr_004'], createdAt: '2026-10-04T09:00:00+03:00' } as never };
}

const world = (person: string, off: Parameters<typeof roleWithout>[0] = []): UploadWorld =>
  uploadWorld(seed, person, (state) => {
    extras(state);
    if (off.length > 0) giveRole(state, person, roleWithout(off));
  });

const chatUpload = { conversationId: 'cnv_901', name: 'Chat-photo.png', type: 'image/png', contentBase64: base64Of(PNG) };
const errorOf = (result: Record<string, any>) => result.structuredContent?.error as { code: string; message: string; details?: Record<string, any> } | undefined;
const refused = (switchId: string) => ({ code: 'forbidden', details: { reason: 'ai_off', right: switchId } });

/** A chat file made by the member (switches on), then copied into the world under test. */
async function chatFileFor(w: UploadWorld): Promise<string> {
  const maker = world('usr_002');
  const result = await call(maker, 'files.uploadContent', chatUpload);
  expect(result.isError, JSON.stringify(result)).toBeUndefined();
  const id = (result.structuredContent.output as { id: string }).id;
  w.mem.tables.state.files[id] = maker.mem.tables.state.files[id];
  w.mem.tables.version += 1;
  return id;
}

async function screensCall(w: UploadWorld, personId: string, name: string, input: Record<string, unknown>) {
  const run = createRunCall({ data: () => w.mem.data() });
  const principal = personId === w.agentId ? { userId: personId, agent: { clientId: TOKEN.clientId } } : { userId: personId };
  return run(w.deps, { principal, name, input, batch: { storyRefs: new Map(), office: await w.mem.data().office(), overviewCalls: 0 } });
}

describe('a chat file needs the switch "AI reads chats" (ai.readChats)', () => {
  it('refuses files.link with the reason of chats.messages when the switch is off, and signs no link', async () => {
    const w = world('usr_002', ['ai.readChats']);
    const id = await chatFileFor(w);
    const link = await call(w, 'files.link', { id, variant: 'full', disposition: 'inline' });
    expect(errorOf(link)).toMatchObject(refused('ai.readChats'));
    expect(w.files.calls.filter((c) => c.op === 'presignGet')).toEqual([]);
    // The reason and the text are those of chats.messages.
    const messages = await call(w, 'chats.messages', { conversationId: 'cnv_901' });
    expect(errorOf(messages)).toMatchObject(refused('ai.readChats'));
    expect(errorOf(link)!.message).toBe(errorOf(messages)!.message);
    expect(errorOf(link)!.message).toBe(aiOffError('ai.readChats').message);
  });

  it('opens files.link when the switch is on', async () => {
    const w = world('usr_002');
    const id = await chatFileFor(w);
    const link = await call(w, 'files.link', { id, variant: 'full', disposition: 'inline' });
    expect(link.isError, JSON.stringify(link)).toBeUndefined();
    expect(link.structuredContent.output.url).toMatch(/^https:\/\//);
  });

  it('keeps a person who is no member at not_found, with the switch off too (no hint that the file exists)', async () => {
    const w = world('usr_003', ['ai.readChats']);
    const id = await chatFileFor(w);
    const link = await call(w, 'files.link', { id, variant: 'full', disposition: 'inline' });
    expect(errorOf(link)).toMatchObject({ code: 'not_found', message: `File ${id} does not exist.` });
    const missing = await call(w, 'files.link', { id: 'fil_9999', variant: 'full', disposition: 'inline' });
    expect(errorOf(missing)).toMatchObject({ code: 'not_found' });
  });

  it('keeps a chat file out of files.list, with the switch on or off', async () => {
    for (const off of [[], ['ai.readChats' as const]]) {
      const w = world('usr_002', off);
      const id = await chatFileFor(w);
      const listed = await call(w, 'files.list', { projectId: 'prj_001' });
      expect(listed.isError, JSON.stringify(listed)).toBeUndefined();
      expect(JSON.stringify(listed.structuredContent.output)).not.toContain(id);
    }
  });

  it('refuses the cover picture (pictures.get) when the cover is a chat file and the switch is off, and gives it when the switch is on', async () => {
    const off = world('usr_002', ['ai.readChats']);
    const offId = await chatFileFor(off);
    off.mem.tables.state.projects.prj_001.coverFileId = offId;
    off.mem.tables.version += 1;
    const blocked = await call(off, 'pictures.get', { kind: 'projectCover', id: 'prj_001' });
    expect(errorOf(blocked)).toMatchObject(refused('ai.readChats'));
    expect(off.files.calls.filter((c) => c.op === 'presignGet')).toEqual([]);

    const on = world('usr_002');
    const onId = await chatFileFor(on);
    on.mem.tables.state.projects.prj_001.coverFileId = onId;
    on.mem.tables.version += 1;
    const shown = await call(on, 'pictures.get', { kind: 'projectCover', id: 'prj_001' });
    expect(shown.isError, JSON.stringify(shown)).toBeUndefined();
    expect(shown.structuredContent.output).toMatchObject({ kind: 'projectCover', id: 'prj_001', cover: { fileId: onId } });
  });

  it('refuses a chat file as the cover of a project in projects.update, for an agent and for a person (a cover shows to every viewer)', async () => {
    const w = world('usr_002');
    const id = await chatFileFor(w);
    const viaAgent = await call(w, 'projects.update', { id: 'prj_001', patch: { coverFileId: id } });
    expect(errorOf(viaAgent)).toMatchObject({ code: 'invalid_input', details: { reason: 'cover_chat_file' } });
    const viaScreens = await screensCall(w, 'usr_002', 'projects.update', { id: 'prj_001', patch: { coverFileId: id } });
    expect(viaScreens).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'cover_chat_file' } } });
    expect(w.mem.tables.state.projects.prj_001.coverFileId).not.toBe(id);
    // The admin is refused too.
    const admin = world('usr_001');
    const adminId = await chatFileFor(admin);
    const adminTry = await screensCall(admin, 'usr_001', 'projects.update', { id: 'prj_001', patch: { coverFileId: adminId } });
    expect(adminTry).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('needs no switch for a person at the screen: the person opens the chat file', async () => {
    const w = world('usr_002', ['ai.readChats']);
    const id = await chatFileFor(w);
    const screens = await screensCall(w, 'usr_002', 'files.link', { id, variant: 'full', disposition: 'inline' });
    expect(screens.ok, JSON.stringify(screens)).toBe(true);
  });
});
