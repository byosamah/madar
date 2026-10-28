import { describe, expect, it } from 'vitest';
import { fakeAuthAdmin } from './authAdmin';
import { fixedClock } from './clock';
import { noDb } from './db-none';
import { fakeDeps } from './deps';
import { fakeFiles } from './files';
import { fakeMail } from './mail';
import { recordingSignals } from './signal';

describe('the test fakes of the server ports', () => {
  it('noDb refuses every use, so a unit test never reaches a database by mistake', async () => {
    await expect(noDb.tx('read', async () => 1)).rejects.toThrow(/no database/);
    await expect(noDb.statement('read', 'select 1')).rejects.toThrow(/no database/);
    await expect(noDb.savepoint((async () => []) as never, async () => 1)).rejects.toThrow(/no database/);
  });

  it('fixedClock gives the set time and moves only when asked', () => {
    const clock = fixedClock('2026-10-03T06:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-10-03T06:00:00.000Z');
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe('2026-10-03T06:01:00.000Z');
    clock.set('2026-10-04T00:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });

  it('fakeFiles keeps objects in memory, signs links, copies, removes and can wait in head', async () => {
    const files = fakeFiles({ kind: 'supabase' });
    expect(files.maxFileBytes).toBe(50 * 1024 * 1024);
    const put = await files.presignPut('up/int_1', { mimeType: 'application/pdf' });
    expect(put.headers['Content-Type']).toBe('application/pdf');
    expect(await files.head('up/int_1')).toBeNull();
    files.objects.set('up/int_1', { size: 10, mimeType: 'application/pdf' });
    await files.copy('up/int_1', 'prj-001/fil-001/1');
    await files.remove(['up/int_1']);
    expect(await files.head('prj-001/fil-001/1')).toEqual({ size: 10, mimeType: 'application/pdf' });
    expect(await files.head('up/int_1')).toBeNull();
    expect((await files.presignGet('prj-001/fil-001/1', { disposition: 'attachment', filename: 'a.pdf', mimeType: 'application/pdf' })).url).toContain('prj-001/fil-001/1');
    expect(files.calls.map((c) => c.op)).toEqual(['presignPut', 'head', 'copy', 'remove', 'head', 'head', 'presignGet']);
    const slow = fakeFiles({ headDelayMs: 30 });
    const started = Date.now();
    await slow.head('x');
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect(fakeFiles({ kind: 'r2' }).maxFileBytes).toBe(500 * 1024 * 1024);
  });

  it('fakeFiles refuses a copy onto a key that holds an object, as Storage does', async () => {
    const files = fakeFiles();
    files.objects.set('up/a', { size: 1, mimeType: 'application/pdf' });
    files.objects.set('up/b', { size: 2, mimeType: 'application/pdf' });
    await files.copy('up/a', 'prj-001/a/file');
    await expect(files.copy('up/b', 'prj-001/a/file')).rejects.toThrow(/already/);
    expect(await files.head('prj-001/a/file')).toEqual({ size: 1, mimeType: 'application/pdf' });
  });

  it('fakeFiles signs an upload with the stored type, as both stores do (server/files/links.ts, storedMimeType)', async () => {
    const files = fakeFiles();
    expect((await files.presignPut('up/a', { mimeType: 'image/svg+xml', size: 1 })).headers['Content-Type']).toBe('application/octet-stream');
    expect((await files.presignPut('up/b', { mimeType: 'image/png', size: 1 })).headers['Content-Type']).toBe('image/png');
  });

  it('fakeMail records the mail and fails on request', async () => {
    const mail = fakeMail();
    const sent = await mail.send({ to: 'a@madar.test', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi', tag: 'invite', idempotencyKey: 'k1' });
    expect(sent.id).toMatch(/^mail_/);
    expect(mail.sent.map((m) => m.to)).toEqual(['a@madar.test']);
    mail.failNext(new Error('down'));
    await expect(mail.send({ to: 'b@madar.test', subject: 'x', html: '', text: '', tag: 'notice', idempotencyKey: 'k2' })).rejects.toThrow('down');
    expect(mail.sent).toHaveLength(1);
  });

  it('recordingSignals keeps the signals of each save', async () => {
    const signals = recordingSignals();
    const q = (async () => []) as never;
    await signals.send(q, [{ v: 1, id: 's1', channel: 'office', seq: 1, projects: [], office: true, kinds: ['tasks'], people: [], storyId: 'sty_1', actorId: 'usr_001' }]);
    expect(signals.sent.map((s) => s.channel)).toEqual(['office']);
  });

  it('fakeAuthAdmin makes users, links, bans and email changes in memory', async () => {
    const auth = fakeAuthAdmin();
    const link = await auth.generateLink('invite', 'new@madar.test');
    expect(link.tokenHash).toMatch(/^hash_/);
    const again = await auth.generateLink('recovery', 'new@madar.test');
    expect(again.authUserId).toBe(link.authUserId);
    const made = await auth.createUser('admin@madar.test', 'pw-123456');
    await auth.setBanned(made.authUserId, true);
    await auth.updateEmail(made.authUserId, 'boss@madar.test');
    expect(auth.users.get(made.authUserId)).toMatchObject({ email: 'boss@madar.test', banned: true });
    expect(auth.links.map((l) => l.type)).toEqual(['invite', 'recovery']);
    await expect(auth.setBanned('nobody', true)).rejects.toThrow();
  });

  it('fakeDeps gives a full set of fakes with a test config, and takes overrides', () => {
    const deps = fakeDeps({ config: { lockKey: 42 } });
    expect(deps.config).toMatchObject({ lockKey: 42, fileStore: 'supabase', limits: { maxFileBytes: 50 * 1024 * 1024 }, region: 'eu-central-1' });
    expect(deps.db).toBe(noDb);
    deps.log.warn('slow', { ms: 600 });
    expect(deps.logs).toEqual([{ level: 'warn', message: 'slow', fields: { ms: 600 } }]);
  });
});
