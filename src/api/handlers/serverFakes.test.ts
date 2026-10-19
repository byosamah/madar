import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  it('name the 15 server calls, and the fakes follow the same contracts', () => {
    expect([...SERVER_CALL_NAMES].sort()).toEqual([
      'agents.list', 'agents.remove', 'feedback.uploadStart', 'files.link', 'files.uploadStart', 'google.connect', 'google.connectStart', 'google.disconnect', 'google.status',
      'live.ticket', 'story.start', 'usage.get', 'usage.retryEffect', 'users.invites', 'users.resendInvite',
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

  it('usage.get gives zeros, the plan limits, no failed effects and no job run, for the Admin only', async () => {
    const t = testApi(CALLS);
    t.as('usr_001');
    const usage = await t.api.call('usage.get', {});
    expect(usage).toMatchObject({ month: '2026-09', failedEffects: [], jobsLastRun: null, calls: { used: 0, limit: 500_000 } });
    for (const meter of [usage.calls, usage.database, usage.files, usage.backupCopy, usage.emails, usage.emailsMonth, usage.egress]) expect(meter.used).toBe(0);
    t.as('usr_002');
    await expect(t.api.call('usage.get', {})).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('usage.retryEffect finds no failed effect in the prototype (it has no outbox), and refuses everyone but the Admin', async () => {
    const t = testApi(CALLS);
    t.as('usr_001');
    await expect(t.api.call('usage.retryEffect', { id: '17' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.api.call('usage.retryEffect', { id: 'x' })).rejects.toMatchObject({ code: 'invalid_input' });
    t.as('usr_002');
    await expect(t.api.call('usage.retryEffect', { id: '17' })).rejects.toMatchObject({ code: 'forbidden' });
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
});
