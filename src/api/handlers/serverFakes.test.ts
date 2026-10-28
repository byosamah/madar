import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addGroupConversation } from '../chatState';
import { fileCalls } from './files';
import { serverFakes } from './serverFakes';
import { MAX_FILE_BYTES } from '../contract/entities';
import { SERVER_CALL_NAMES, serverContracts } from '../contract/server';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));
const CALLS = { ...fileCalls, ...serverFakes };
const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });
const TEN_MINUTES_LATER = '2026-09-30T09:10:00.000+03:00';

describe('the server call contracts', () => {
  it('name the 18 server calls, and the fakes follow the same contracts', () => {
    expect([...SERVER_CALL_NAMES].sort()).toEqual([
      'agents.list', 'agents.remove', 'chats.typing', 'daftra.findClients', 'daftra.matchClient', 'daftra.paymentLink', 'daftra.status', 'feedback.uploadStart', 'files.link', 'files.uploadStart', 'google.connect', 'google.connectStart', 'google.disconnect', 'google.status',
      'live.ticket', 'story.start', 'users.invites', 'users.resendInvite',
    ]);
    expect(Object.keys(serverFakes).sort()).toEqual([...SERVER_CALL_NAMES].sort());
    for (const name of SERVER_CALL_NAMES) {
      expect(serverFakes[name].input).toBe(serverContracts[name].input);
      expect(serverFakes[name].output).toBe(serverContracts[name].output);
      expect(Boolean(serverFakes[name].readOnly)).toBe(serverContracts[name].readOnly);
    }
  });
});

describe('the fake server calls', () => {
  it('story.start gives a story ID that later calls can share', async () => {
    const t = testApi(CALLS);
    t.as('usr_003');
    const { storyId } = await t.api.call('story.start', {});
    expect(storyId).toMatch(/^cor_/);
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf('x') }, { correlationId: storyId });
    expect(Object.values(t.store.state.events).filter((e) => e.correlationId === storyId).map((e) => e.targetId)).toEqual([file.file.id]);
  });

  it('files.uploadStart checks the project rights and the size, and gives a signed upload for 10 minutes', async () => {
    const t = testApi(CALLS);
    t.as('usr_003');
    const start = await t.api.call('files.uploadStart', { projectId: 'prj_001', name: 'plan.pdf', size: 1200, mimeType: 'application/pdf', thumb: { size: 30, mimeType: 'image/webp' } });
    expect(start.uploadId).toMatch(/^upl_/);
    expect(start.put).toMatchObject({ headers: { 'Content-Type': 'application/pdf' }, expiresAt: TEN_MINUTES_LATER });
    expect(start.thumbPut?.headers['Content-Type']).toBe('image/webp');
    await expect(t.api.call('files.uploadStart', { projectId: 'prj_001', name: 'big.zip', size: MAX_FILE_BYTES + 1, mimeType: 'application/zip' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['size'], reason: 'file_too_large', limit: MAX_FILE_BYTES },
    });
    await expect(t.api.call('files.uploadStart', { projectId: 'prj_404', name: 'a.pdf', size: 1, mimeType: 'application/pdf' })).rejects.toMatchObject({ code: 'not_found' });
    t.as('usr_004');
    await expect(t.api.call('files.uploadStart', { projectId: 'prj_001', name: 'a.pdf', size: 1, mimeType: 'application/pdf' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('files.uploadStart takes 500 MB for a project and 250 MB for a chat (fbk_070)', async () => {
    const t = testApi(CALLS);
    t.as('usr_003');
    const MB = 1024 * 1024;
    await expect(t.api.call('files.uploadStart', { projectId: 'prj_001', name: 'a.dwg', size: 500 * MB, mimeType: 'application/octet-stream' })).resolves.toBeDefined();
    const group = addGroupConversation(t.store.state, 'Team', 'usr_003', ['usr_003', 'usr_002', 'usr_006'], '2026-09-30T09:00:00.000+03:00');
    await expect(t.api.call('files.uploadStart', { conversationId: group.id, name: 'a.dwg', size: 250 * MB + 1, mimeType: 'application/octet-stream' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['size'], reason: 'file_too_large', limit: 250 * MB },
    });
  });

  it('files.link gives one cached blob: URL for each stored file, with the name, type and size', async () => {
    const make = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:madar-test/${make.mock.calls.length}`);
    const t = testApi(CALLS);
    t.as('usr_003');
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'plan.pdf', blob: pdf('rev A') });
    const first = await t.api.call('files.link', { id: file.file.id, variant: 'full', disposition: 'inline' });
    expect(first).toMatchObject({ name: 'plan.pdf', mimeType: 'application/pdf', size: 5, expiresAt: TEN_MINUTES_LATER });
    expect(first.url).toMatch(/^blob:/);
    const again = await t.api.call('files.link', { id: file.file.id, letter: 'A', variant: 'thumb', disposition: 'inline' });
    expect(again.url).toBe(first.url);
    expect(make).toHaveBeenCalledTimes(1);
    await expect(t.api.call('files.link', { id: 'fil_404', variant: 'full', disposition: 'inline' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.api.call('files.link', { id: file.file.id, letter: 'Z', variant: 'full', disposition: 'inline' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('files.link never opens a page or a drawing that can run a script: those types and every attachment link are download-only data (plan 5.2)', async () => {
    const types: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      types.push((blob as Blob).type);
      return `blob:madar-test/${types.length}`;
    });
    const t = testApi(CALLS);
    t.as('usr_003');
    const link = async (name: string, type: string, disposition: 'inline' | 'attachment') => {
      const stored = await t.api.call('files.upload', { projectId: 'prj_001', name, blob: new Blob(['<x/>'], { type }) });
      return t.api.call('files.link', { id: stored.file.id, variant: 'full', disposition });
    };
    const risky = [
      ['page.html', 'text/html'], ['page2.html', 'TEXT/HTML; charset=utf-8'], ['logo.svg', 'image/svg+xml'],
      ['page.xhtml', 'application/xhtml+xml'], ['data.xml', 'text/xml'], ['data2.xml', 'application/xml'], ['feed.atom', 'application/atom+xml'],
    ];
    for (const [name, type] of risky) {
      const out = await link(name, type, 'inline');
      // The screen still learns the stored type; only the data in the link cannot render.
      expect(out.mimeType).toBe(type.toLowerCase());
    }
    expect(types).toEqual(risky.map(() => 'application/octet-stream'));

    types.length = 0;
    const plan = await t.api.call('files.upload', { projectId: 'prj_001', name: 'plan.pdf', blob: pdf('rev A') });
    const view = await t.api.call('files.link', { id: plan.file.id, variant: 'full', disposition: 'inline' });
    const save = await t.api.call('files.link', { id: plan.file.id, variant: 'full', disposition: 'attachment' });
    expect(types).toEqual(['application/pdf', 'application/octet-stream']);
    expect(save.url).not.toBe(view.url);
  });

  it('files.link shows inline only a short safe list (pictures, PDF, plain text, video, audio), as the real stores do: every other type is plain data', async () => {
    const types: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      types.push((blob as Blob).type);
      return `blob:madar-test/${types.length}`;
    });
    const t = testApi(CALLS);
    t.as('usr_003');
    const inline = async (name: string, type: string) => {
      const stored = await t.api.call('files.upload', { projectId: 'prj_001', name, blob: new Blob(['x'], { type }) });
      await t.api.call('files.link', { id: stored.file.id, variant: 'full', disposition: 'inline' });
    };
    for (const [name, type] of [['sheet.xsl', 'text/xsl'], ['archive.zip', 'application/zip'], ['odd.img', 'image/x-unknown'], ['doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
      await inline(name, type);
    }
    expect(types).toEqual(['application/octet-stream', 'application/octet-stream', 'application/octet-stream', 'application/octet-stream']);
    types.length = 0;
    for (const [name, type] of [['photo.png', 'image/png'], ['notes.txt', 'text/plain'], ['walk.mp4', 'video/mp4']]) await inline(name, type);
    expect(types).toEqual(['image/png', 'text/plain', 'video/mp4']);
  });

  it('feedback.uploadStart gives one upload for each screenshot, up to three pictures of 10 MB', async () => {
    const t = testApi(CALLS);
    t.as('usr_003');
    const out = await t.api.call('feedback.uploadStart', { screenshots: [{ size: 100, mimeType: 'image/png' }, { size: 200, mimeType: 'image/jpeg' }] });
    expect(out.uploads).toHaveLength(2);
    expect(out.uploads[1].put.headers['Content-Type']).toBe('image/jpeg');
    const shot = { size: 100, mimeType: 'image/png' };
    await expect(t.api.call('feedback.uploadStart', { screenshots: [shot, shot, shot, shot] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('feedback.uploadStart', { screenshots: [{ size: 11 * 1024 * 1024, mimeType: 'image/png' }] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('feedback.uploadStart', { screenshots: [{ size: 10, mimeType: 'application/pdf' }] })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('users.invites lists no invitations in the prototype, and only for the Admin and Management', async () => {
    const t = testApi(CALLS);
    t.as('usr_001');
    expect(await t.api.call('users.invites', {})).toEqual([]);
    t.store.state.users.usr_002.systemRole = 'management';
    t.as('usr_002');
    expect(await t.api.call('users.invites', {})).toEqual([]);
    t.as('usr_003');
    await expect(t.api.call('users.invites', {})).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('users.resendInvite answers with the time, for a person who exists, for the Admin and Management only', async () => {
    const t = testApi(CALLS);
    t.as('usr_001');
    expect(await t.api.call('users.resendInvite', { id: 'usr_003' })).toEqual({ sentAt: '2026-09-30T09:00:00.000+03:00' });
    await expect(t.api.call('users.resendInvite', { id: 'usr_404' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.api.call('users.resendInvite', { id: 'usr_005' })).rejects.toMatchObject({ code: 'invalid_input' });
    t.as('usr_003');
    await expect(t.api.call('users.resendInvite', { id: 'usr_002' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('agents.list gives the agents of the person who asks', async () => {
    const t = testApi(CALLS);
    t.as('usr_003');
    expect(await t.api.call('agents.list', {})).toEqual([
      { agentId: 'usr_005', clientIds: [], name: 'Madar Assistant', redirectHost: null, approvedAt: null, lastUsedAt: null, active: true },
    ]);
    t.as('usr_002');
    expect(await t.api.call('agents.list', {})).toEqual([]);
  });

  it('agents.remove turns the agent off with an event, and only its person can do it', async () => {
    const t = testApi(CALLS);
    t.as('usr_002');
    await expect(t.api.call('agents.remove', { agentId: 'usr_005' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('agents.remove', { agentId: 'usr_003' })).rejects.toMatchObject({ code: 'not_found' });
    t.as('usr_003');
    expect(await t.api.call('agents.remove', { agentId: 'usr_005' })).toEqual({ removed: true });
    expect(t.store.state.users.usr_005.active).toBe(false);
    expect(Object.values(t.store.state.events).map((e) => [e.verb, e.targetId])).toEqual([['user.deactivated', 'usr_005']]);
    expect((await t.api.call('agents.list', {}))[0].active).toBe(false);
  });

  it('live.ticket gives a ticket of 60 seconds that opens nothing: the prototype has no server and no socket (exit wave 3)', async () => {
    const t = testApi(CALLS);
    t.as('usr_005');
    expect(await t.api.call('live.ticket', {})).toEqual({ ticket: '0'.repeat(64), expiresAt: '2026-09-30T09:01:00.000+03:00' });
  });

  it('google.status says the prototype is not ready, and the other three google calls refuse with google_not_ready (fbk_022)', async () => {
    const t = testApi(CALLS);
    t.as('usr_003');
    expect(await t.api.call('google.status', {})).toEqual({ ready: false, state: 'none', connectedAt: null });
    for (const [name, input] of [['google.connectStart', {}], ['google.connect', { code: 'c', state: 's' }], ['google.disconnect', {}]] as const) {
      await expect(t.api.call(name, input), name).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'google_not_ready' } });
    }
  });

  it('the google calls give an agent forbidden, as the server does (fbk_022)', async () => {
    const t = testApi(CALLS);
    t.as('usr_005');
    for (const [name, input] of [['google.status', {}], ['google.connectStart', {}], ['google.connect', { code: 'c', state: 's' }], ['google.disconnect', {}]] as const) {
      await expect(t.api.call(name, input), name).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('google.connect takes a code with no space and a state, nothing else', async () => {
    const t = testApi(CALLS);
    t.as('usr_003');
    await expect(t.api.call('google.connect', { code: 'has space', state: 's' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('google.connect', { code: '', state: 's' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('google.connect', { code: 'c', state: 'x'.repeat(1025) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('google.connect', { code: 'c'.repeat(513), state: 's' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('daftra.status says the prototype is not ready, and the other three daftra calls refuse with daftra_not_ready (the Daftra link, 2026-10-26)', async () => {
    const t = testApi(CALLS);
    t.as('usr_001');
    expect(await t.api.call('daftra.status', {})).toEqual({ ready: false, accounts: [] });
    for (const [name, input] of [
      ['daftra.paymentLink', { paymentId: 'pay_001' }], ['daftra.findClients', { paymentId: 'pay_001', query: 'noor' }], ['daftra.matchClient', { paymentId: 'pay_001', daftraClientId: '842' }],
    ] as const) {
      await expect(t.api.call(name, input), name).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'daftra_not_ready' } });
    }
  });

  it('the daftra calls give a person without the switch, and an agent, forbidden: also in the prototype', async () => {
    const t = testApi(CALLS);
    for (const who of ['usr_003', 'usr_005']) {
      t.as(who);
      for (const [name, input] of [
        ['daftra.status', {}], ['daftra.paymentLink', { paymentId: 'pay_001' }], ['daftra.findClients', { paymentId: 'pay_001', query: 'noor' }], ['daftra.matchClient', { paymentId: 'pay_001', daftraClientId: '842' }],
      ] as const) {
        await expect(t.api.call(name, input), `${who} ${name}`).rejects.toMatchObject({ code: 'forbidden' });
      }
    }
  });

  it('the daftra calls take only a short search, a number for the Daftra client, and a payment id', async () => {
    const t = testApi(CALLS);
    t.as('usr_001');
    await expect(t.api.call('daftra.findClients', { paymentId: 'pay_001', query: '   ' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('daftra.findClients', { paymentId: 'pay_001', query: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('daftra.matchClient', { paymentId: 'pay_001', daftraClientId: '12a' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('daftra.matchClient', { paymentId: 'pay_001', daftraClientId: '1'.repeat(21) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('daftra.paymentLink', { paymentId: 'prj_001' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
