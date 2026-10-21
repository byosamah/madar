import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import type { TypingPort } from '../core/ports';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeDeps } from '../test/fakes/deps';
import { chatsTyping } from './typing';
import type { TypingSignal } from '../../src/api/remote/wire';

/**
 * chats.typing (chat presence design B, base B5) on the sample office. cnv_013 is the direct chat of Hala (usr_001, the Admin) and Faisal
 * (usr_002); cnv_001 is the project chat of prj_001 (Faisal leads, usr_005, usr_006 and usr_008 are the team; Hala is outside the team);
 * cnv_015 is a group of usr_002, usr_001, usr_005 and usr_003; usr_004 is in none of them; usr_009 is an agent.
 */

const NOW = new Date('2026-10-04T06:00:00Z');

function recordingTyping() {
  const sent: { people: string[]; signal: TypingSignal }[] = [];
  const port: TypingPort = { async send(people, signal) { sent.push({ people, signal }); } };
  return { port, sent };
}

async function ctxOf(userId: string, o: { port?: boolean; agent?: boolean; setup?: (office: Awaited<ReturnType<typeof buildSeed>>) => void } = {}) {
  const seed = await buildSeed('2026-10-04', async () => undefined);
  o.setup?.(seed);
  const typing = recordingTyping();
  const deps = fakeDeps();
  if (o.port !== false) deps.typing = typing.port;
  const principal = o.agent ? { userId, agent: { clientId: 'cli_test' } } : { userId };
  const ctx: ServerCallCtx = { deps, principal, office: snapshotOf(seed, 1), batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW };
  return { ctx, sent: typing.sent };
}

const hiddenText = (id: string) => `Conversation ${id} does not exist.`;

describe('chats.typing (server/calls/typing.ts)', () => {
  it("sends a direct chat's typing to the other member only, with the payload fields", async () => {
    const { ctx, sent } = await ctxOf('usr_001');
    const result = await chatsTyping({ conversationId: 'cnv_013', typing: true }, ctx);
    expect(result).toEqual({ output: { sent: 1 }, changed: false });
    expect(sent).toEqual([{ people: ['usr_002'], signal: { v: 1, conversationId: 'cnv_013', userId: 'usr_001', typing: true, at: '2026-10-04T06:00:00.000Z' } }]);
  });

  it('sends a stop with typing false', async () => {
    const { ctx, sent } = await ctxOf('usr_002');
    await chatsTyping({ conversationId: 'cnv_013', typing: false }, ctx);
    expect(sent[0].signal).toMatchObject({ typing: false, userId: 'usr_002' });
  });

  it("sends a project chat's typing to the team without the typist", async () => {
    const { ctx, sent } = await ctxOf('usr_005');
    const result = await chatsTyping({ conversationId: 'cnv_001', typing: true }, ctx);
    expect(result.output).toEqual({ sent: 3 });
    expect(sent).toHaveLength(1);
    expect([...sent[0].people].sort()).toEqual(['usr_002', 'usr_006', 'usr_008']);
    expect(sent[0].people).not.toContain('usr_005');
    expect(sent[0].people).not.toContain('usr_001');
  });

  it('sends nothing for an Admin outside the team, and answers sent 0', async () => {
    const { ctx, sent } = await ctxOf('usr_001');
    const result = await chatsTyping({ conversationId: 'cnv_001', typing: true }, ctx);
    expect(result.output).toEqual({ sent: 0 });
    expect(sent).toEqual([]);
  });

  it('answers an outsider and an unknown id with the same not_found text as chats.messages', async () => {
    const { ctx, sent } = await ctxOf('usr_004');
    for (const id of ['cnv_013', 'cnv_015', 'cnv_001', 'cnv_999']) {
      await expect(chatsTyping({ conversationId: id, typing: true }, ctx), id).rejects.toMatchObject({ code: 'not_found', message: hiddenText(id) });
    }
    expect(sent).toEqual([]);
  });

  it('sends nothing to a person who left the chat', async () => {
    const { ctx, sent } = await ctxOf('usr_005', { setup: (office) => { office.conversations.cnv_015.memberIds = office.conversations.cnv_015.memberIds.filter((id) => id !== 'usr_003'); } });
    const result = await chatsTyping({ conversationId: 'cnv_015', typing: true }, ctx);
    expect(result.output).toEqual({ sent: 2 });
    expect([...sent[0].people].sort()).toEqual(['usr_001', 'usr_002']);
    // The person who left learns nothing of the chat and cannot signal in it.
    const left = await ctxOf('usr_003', { setup: (office) => { office.conversations.cnv_015.memberIds = office.conversations.cnv_015.memberIds.filter((id) => id !== 'usr_003'); } });
    await expect(chatsTyping({ conversationId: 'cnv_015', typing: true }, left.ctx)).rejects.toMatchObject({ code: 'not_found' });
    expect(left.sent).toEqual([]);
  });

  it('refuses an agent', async () => {
    const { ctx, sent } = await ctxOf('usr_009', { agent: true });
    await expect(chatsTyping({ conversationId: 'cnv_013', typing: true }, ctx)).rejects.toMatchObject({ code: 'forbidden', details: { action: 'chats.typing' } });
    expect(sent).toEqual([]);
  });

  it('works with no typing port', async () => {
    const { ctx } = await ctxOf('usr_001', { port: false });
    const result = await chatsTyping({ conversationId: 'cnv_013', typing: true }, ctx);
    expect(result.output).toEqual({ sent: 1 });
  });

  it('refuses a person who is off', async () => {
    const { ctx } = await ctxOf('usr_001', { setup: (office) => { office.users.usr_001.active = false; } });
    await expect(chatsTyping({ conversationId: 'cnv_013', typing: true }, ctx)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
