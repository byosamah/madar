import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { giveRole, roleWithout } from './aiRoles.testing';
import { aiSwitchOf } from './aiSwitches';
import { call } from './bulk.testing';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_DENY, NO_CALL_TOOLS, mcpTools } from './tools';
import { createRunCall } from '../core/runCall';
import { MAX_UPLOAD_BYTES, runUpload } from './upload';
import { base64Of, sampleBytes, uploadWorld, type UploadWorld } from './upload.testing';

/**
 * feedback.sendWithScreenshots (owner, 2026-10-26): a request or bug report with up to three pictures sent as content. It runs feedback.uploadStart,
 * puts each picture to its signed link on the server side, then runs feedback.send with the upload IDs, all with the rights of the person.
 */

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const world = (person = 'usr_005', prepare?: (state: State) => void) => uploadWorld(seed, person, prepare);
const shot = (type = 'image/png', bytes: Uint8Array = PNG) => ({ name: 'screen.png', type, contentBase64: base64Of(bytes) });
const report = (extra: Record<string, unknown> = {}) => ({ kind: 'bug', message: 'The board does not scroll on my phone.', page: '/projects', screenshots: [shot()], ...extra });
const errorOf = (result: Record<string, any>) => result.structuredContent?.error as { code: string; message: string; details?: Record<string, any> } | undefined;
const noStoreWork = (w: UploadWorld) => {
  expect(w.files.calls).toEqual([]);
  expect(w.puts).toEqual([]);
  expect(w.filesDb.intents.size).toBe(0);
};

describe('feedback.sendWithScreenshots is a tool', () => {
  it('sits in the allowlist only, has no call of its own, and uses the AI switch ai.feedback', () => {
    expect(MCP_ALLOW).toContain('feedback.sendWithScreenshots');
    expect(MCP_DENY as readonly string[]).not.toContain('feedback.sendWithScreenshots');
    expect(NO_CALL_TOOLS.has('feedback.sendWithScreenshots')).toBe(true);
    expect(aiSwitchOf('feedback.sendWithScreenshots')).toBe('ai.feedback');
    // The two start calls and the send call of the screens stay on the deny list: the tool runs them inside.
    for (const name of ['feedback.uploadStart', 'feedback.send']) expect(MCP_DENY as readonly string[], name).toContain(name);
  });

  it('is a write that adds a record, takes a story, and takes one to three pictures', () => {
    const tool = mcpTools().find((t) => t.name === 'feedback.sendWithScreenshots')!;
    expect(tool.readOnly).toBe(false);
    expect(tool.takesStory).toBe(true);
    expect(tool.annotations.destructiveHint).toBe(false);
    expect(tool.input.safeParse(report()).success).toBe(true);
    expect(tool.input.safeParse(report({ screenshots: [] })).success).toBe(false);
    expect(tool.input.safeParse(report({ screenshots: [shot(), shot(), shot(), shot()] })).success).toBe(false);
    expect(tool.input.safeParse(report({ extra: 1 })).success).toBe(false);
  });

  it('has a doc of 600 characters or less that names the limit, the notice and the Undo, and INSTRUCTIONS names it', () => {
    const doc = TOOL_DOCS['feedback.sendWithScreenshots'].description;
    expect(doc.length).toBeLessThanOrEqual(600);
    for (const word of ['screenshots', 'contentBase64', '10 MB', 'Admins', 'No Undo', 'only when your person asks']) expect(doc, word).toContain(word);
    expect(doc).not.toMatch(/[–—]/);
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Requests and bugs: '))!;
    expect(line).toContain('feedback.sendWithScreenshots');
    expect(line).not.toMatch(/[–—]/);
  });
});

describe('feedback.sendWithScreenshots over MCP', () => {
  it('sends a report with two pictures: the record keeps both, the objects sit at their final keys, and the answer has no key and no link', async () => {
    const w = world();
    const second = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);
    const result = await call(w, 'feedback.sendWithScreenshots', report({ screenshots: [shot('image/png', PNG), shot('image/jpeg', second)] }));
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const out = result.structuredContent.output as { id: string; kind: string; page: string; status: string; screenshots: { type: string }[] };
    expect(out).toMatchObject({ kind: 'bug', page: '/projects', status: 'new', screenshots: [{ type: 'image/png' }, { type: 'image/jpeg' }] });
    const saved = w.mem.tables.state.feedback![out.id];
    expect(saved.screenshots.map((s) => s.type)).toEqual(['image/png', 'image/jpeg']);
    expect(saved.createdBy === 'usr_005' || saved.createdBy === w.agentId).toBe(true);
    for (const [at, bytes] of [PNG, second].entries()) {
      const key = saved.screenshots[at].blobKey;
      expect(key).toMatch(/^feedback\//);
      expect(new Uint8Array(await w.content.get(key)!.arrayBuffer())).toEqual(bytes);
    }
    expect([...w.files.objects.keys()].filter((key) => key.startsWith('up/'))).toEqual([]);
    expect(w.puts).toHaveLength(2);
    const text = JSON.stringify(result);
    for (const bad of ['blobKey', 'feedback/', 'files.test', 'https://', 'uploadId']) expect(text, bad).not.toContain(bad);
    expect(w.hits.count).toBe(1);
  });

  it('tells the Admin of the report by a notice', async () => {
    const w = world();
    const result = await call(w, 'feedback.sendWithScreenshots', report());
    const id = result.structuredContent.output.id as string;
    const notices = Object.values(w.mem.tables.state.notifications ?? {}).filter((n) => n.trigger === 'feedback_sent' && n.targetId === id);
    expect(notices.map((n) => n.userId)).toContain('usr_001');
  });

  it('refuses a picture that is not a safe picture type before any store work', async () => {
    const w = world();
    for (const type of ['text/plain', 'image/svg+xml', 'application/pdf']) {
      const result = await call(w, 'feedback.sendWithScreenshots', report({ screenshots: [shot(type)] }));
      expect(errorOf(result), type).toMatchObject({ code: 'invalid_input' });
    }
    noStoreWork(w);
  });

  it('refuses pictures that together are over 10 MB, and base64 text that is not base64, before any store work', async () => {
    const w = world();
    // The tool adds the sizes after it decodes them. (A body this large never reaches the tool over HTTP: the body limit answers 413 first.)
    const big = shot('image/png', sampleBytes(5.5 * 1024 * 1024));
    const ctx = { deps: w.deps, principal: { userId: w.agentId, agent: { clientId: 'cli' } }, office: await w.mem.data().office(), runCall: createRunCall({ data: () => w.mem.data() }) };
    const result = await runUpload('feedback.sendWithScreenshots', report({ screenshots: [big, big] }), ctx);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'file_too_large', limit: MAX_UPLOAD_BYTES } } });
    const bad = await call(w, 'feedback.sendWithScreenshots', report({ screenshots: [{ type: 'image/png', contentBase64: 'not base64!' }] }));
    expect(errorOf(bad)).toMatchObject({ code: 'invalid_input', details: { reason: 'not_base64' } });
    noStoreWork(w);
  });

  it('refuses a person who may not send a report, with the refusal of the screens, and stores nothing', async () => {
    const w = world('usr_005', (state) => void giveRole(state, 'usr_005', roleWithout(['feedback.send'])));
    const result = await call(w, 'feedback.sendWithScreenshots', report());
    expect(errorOf(result)).toMatchObject({ code: 'forbidden', details: { action: 'feedback.send' } });
    noStoreWork(w);
  });

  it('is closed by the AI switch ai.feedback: the call fails with ai_off', async () => {
    const w = world('usr_005', (state) => void giveRole(state, 'usr_005', roleWithout(['ai.feedback'])));
    const result = await call(w, 'feedback.sendWithScreenshots', report());
    expect(errorOf(result)).toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.feedback' } });
    noStoreWork(w);
  });

  it('answers failed when the store refuses a picture, and saves no report', async () => {
    const w = world();
    w.failPut.status = 500;
    const result = await call(w, 'feedback.sendWithScreenshots', report());
    expect(errorOf(result)).toMatchObject({ code: 'failed', details: { reason: 'upload_failed' } });
    expect(Object.keys(w.mem.tables.state.feedback ?? {})).toEqual([]);
  });
});
