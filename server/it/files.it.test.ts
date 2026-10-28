import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FileView } from '../../src/api/contract/views';
import { LOCK_SQL } from '../core/lock';
import type { FileStoreKind, FilesPort } from '../core/ports';
import { runCall } from '../core/runCall';
import type { Principal, RunRequest, RunResult } from '../core/types';
import { stagingKey } from '../files/keys';
import { intentLifeSeconds } from '../files/links';
import { r2FilesPort } from '../files/r2';
import { supabaseStorageFilesPort } from '../files/supabaseStorage';
import { fakeFiles } from '../test/fakes/files';
import { minioEnv, startMinio, stopMinio } from './minio';
import { NOW, newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * Suite 8 of plan 5.2 on the local stack (task F2; plan 2b, points 1 and 7; proof.md, Z0a item 6): the file calls through runCall,
 * as madar_server with real commits. Each upload suite runs twice (owner, 2026-10-16): on the local Supabase Storage (bucket
 * madar-files), then on R2 through r2FilesPort on MinIO (server/it/minio.ts), each with an office of its own. The few rules that
 * differ between the stores are pinned for each store: the second PUT to a staging key, the type that the link signs, the life
 * of an intent and the file limit. It needs the local stack (`supabase start`, then `supabase db reset` from this worktree), Docker
 * and the Docker lock. It talks only to 127.0.0.1.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const SUPABASE_URL = 'http://127.0.0.1:54321';
const BUCKET = 'madar-files';
const ARABIC_NAME = 'مخطط الطابق الأرضي.pdf';
const ADMIN = 'usr_001';
const AGENT_OFF = 'usr_090';

function secretKey(): string {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>;
  return status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
}

const principal = (userId: string): Principal => (userId === AGENT_OFF ? { userId, agent: { clientId: 'cli-off' } } : { userId });

function okOf<T>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

async function put(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { method: 'PUT', headers, body });
  return { status: response.status, text: await response.text() };
}

type Start = { uploadId: string; put: { url: string; headers: Record<string, string> }; thumbPut?: { url: string; headers: Record<string, string> } };

/** One store of the suite: how to start it, and how to stop it after its office closes. */
type Variant = { kind: FileStoreKind; title: string; office: string; start(): Promise<FilesPort>; stop(): void };

const VARIANTS: Variant[] = [
  {
    kind: 'supabase', title: 'the local Supabase Storage', office: 'files',
    start: async () => supabaseStorageFilesPort({ supabaseUrl: SUPABASE_URL, secretKey: secretKey(), bucket: BUCKET }),
    stop: () => undefined,
  },
  {
    kind: 'r2', title: 'R2 (r2FilesPort on MinIO)', office: 'files_r2',
    start: async () => {
      await startMinio([BUCKET]);
      return r2FilesPort(minioEnv(BUCKET));
    },
    stop: () => stopMinio(),
  },
];

for (const variant of VARIANTS) describe(`files through runCall on ${variant.title}`, () => uploadSuites(variant));

function uploadSuites(v: Variant): void {
  let office: ItOffice;
  let deps: ReturnType<ItOffice['isolate']>;
  let store: FilesPort;
  /** The keys that each signing call of the store got, so a test sees that a refusal signed nothing. */
  const signed: string[] = [];
  let leader = '';
  /** A person whom the Admin turns off: a member who leads neither project of this suite (set in beforeAll). */
  let PERSON_OFF = '';
  /** The life of an upload intent on this store: 2 hours on Storage, 70 minutes on R2 (server/files/links.ts). */
  const intentMs = intentLifeSeconds(v.kind) * 1000;

  const call = (userId: string, name: string, input: unknown, more: Partial<RunRequest> = {}) =>
    runCall(deps, { principal: principal(userId), name, input, batch: newBatch(), ...more });

  beforeAll(async () => {
    office = await startOffice(v.office);
    deps = office.isolate();
    store = await v.start();
    deps.files = {
      ...store,
      kind: store.kind,
      maxFileBytes: store.maxFileBytes,
      presignPut: async (key: string, o: Parameters<FilesPort['presignPut']>[1]) => {
        signed.push(`put ${key}`);
        return store.presignPut(key, o);
      },
      presignGet: async (key: string, o: Parameters<FilesPort['presignGet']>[1]) => {
        signed.push(`get ${key}`);
        return store.presignGet(key, o);
      },
    } as never;
    leader = office.seed.projects.prj_001.leaderId!;
    const leaders = new Set(Object.values(office.seed.projects).map((p) => p.leaderId));
    PERSON_OFF = Object.values(office.seed.users).find((u) => u.kind === 'human' && u.systemRole === 'member' && !leaders.has(u.id) && u.id !== 'usr_005')!.id;
    // An agent of a person whom the Admin turns off below. Its row carries the next office version, so the office cache reads it
    // together with the change of users.deactivate.
    const doc = { ...office.seed.users[ADMIN], id: AGENT_OFF, name: 'Agent of an inactive person', email: 'agent.off@madar.test', kind: 'agent', systemRole: 'member', discipline: 'Agent', ownerId: PERSON_OFF };
    await office.sql('insert into users (id, doc, chg) values ($1, $2, (select version + 1 from office_meta))', [AGENT_OFF, JSON.stringify(doc)]);
  }, 120_000);

  afterEach(() => {
    deps.clock.set(NOW);
  });

  afterAll(async () => {
    try {
      // A beforeAll that failed (no local stack) leaves no office to clean.
      if (!office) return;
      const rows = await office.sql<{ key: string; thumb_key: string | null; staging_key: string }>('select key, thumb_key, staging_key from upload_intents');
      const keys = rows.flatMap((r) => [r.key, r.staging_key, ...(r.thumb_key ? [r.thumb_key, r.staging_key.replace(/\/file$/, '/thumb')] : [])]);
      if (keys.length > 0) await store.remove(keys).catch(() => undefined);
      await office.close();
    } finally {
      v.stop();
    }
  });

  async function start(userId: string, input: Record<string, unknown>): Promise<Start> {
    return okOf<Start>(await call(userId, 'files.uploadStart', { projectId: 'prj_001', name: 'plan.pdf', size: 14, mimeType: 'application/pdf', ...input }));
  }

  async function intentOf(uploadId: string) {
    const [row] = await office.sql<{ key: string; staging_key: string; used_at: Date | null; expires_at: Date }>('select key, staging_key, used_at, expires_at from upload_intents where id = $1', [uploadId]);
    return row;
  }

  describe(`files on ${v.title}, through runCall`, () => {
    it('a file goes up and comes down with its Arabic name: uploadStart, the browser PUT, files.upload, files.link', async () => {
      const begin = await start(leader, { name: ARABIC_NAME });
      expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 first')).status).toBe(200);
      const intent = await intentOf(begin.uploadId);
      expect(intent.expires_at.toISOString()).toBe(new Date(NOW.getTime() + intentMs).toISOString());
      const file = okOf<FileView>(await call(leader, 'files.upload', { projectId: 'prj_001', name: ARABIC_NAME, uploadId: begin.uploadId }));
      expect(file.latest).toMatchObject({ size: 14, mimeType: 'application/pdf' });
      const [row] = await office.sql<{ doc: { versions: { blobKey: string }[] } }>('select doc from files where id = $1', [file.file.id]);
      expect(row.doc.versions.map((version) => version.blobKey)).toEqual([intent.key]);
      expect((await intentOf(begin.uploadId)).used_at).not.toBeNull();
      expect(await store.head(intent.staging_key)).toBeNull();
      expect(await store.head(intent.key)).toEqual({ size: 14, mimeType: 'application/pdf' });

      const link = okOf<{ url: string; name: string; size: number }>(await call('usr_005', 'files.link', { id: file.file.id, variant: 'full', disposition: 'attachment' }));
      expect([link.name, link.size]).toEqual([ARABIC_NAME, 14]);
      const response = await fetch(link.url);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('%PDF-1.4 first');
      expect(decodeURIComponent(response.headers.get('content-disposition')?.split("UTF-8''")[1] ?? '')).toBe(ARABIC_NAME);
    });

    if (v.kind === 'supabase') {
      it('refuses a second PUT to up/<intentId> before files.upload (no upsert), and the upload keeps the first object', async () => {
        const begin = await start(leader, {});
        expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 first')).status).toBe(200);
        const second = await put(begin.put.url, begin.put.headers, '%PDF-1.4 other');
        expect(second.status, second.text).not.toBe(200);
        const forced = await put(begin.put.url, { ...begin.put.headers, 'x-upsert': 'true' }, '%PDF-1.4 other');
        expect(forced.status, forced.text).not.toBe(200);
        const file = okOf<FileView>(await call(leader, 'files.upload', { projectId: 'prj_001', name: 'second-put.pdf', uploadId: begin.uploadId }));
        const link = okOf<{ url: string }>(await call(leader, 'files.link', { id: file.file.id, variant: 'full', disposition: 'inline' }));
        expect(await (await fetch(link.url)).text()).toBe('%PDF-1.4 first');
      });
    } else {
      it('takes a second PUT to up/<intentId> before files.upload (no upsert rule on R2): the check after the copy is the guard', async () => {
        // The same size and type: R2 replaces the staged object, and the version holds the second body.
        const begin = await start(leader, {});
        expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 first')).status).toBe(200);
        expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 other')).status).toBe(200);
        const file = okOf<FileView>(await call(leader, 'files.upload', { projectId: 'prj_001', name: 'second-put.pdf', uploadId: begin.uploadId }));
        const link = okOf<{ url: string }>(await call(leader, 'files.link', { id: file.file.id, variant: 'full', disposition: 'inline' }));
        expect(await (await fetch(link.url)).text()).toBe('%PDF-1.4 other');

        // Another size: the check refuses the replaced object, removes it, and makes no version.
        const next = await start(leader, {});
        expect((await put(next.put.url, next.put.headers, '%PDF-1.4 first')).status).toBe(200);
        expect((await put(next.put.url, next.put.headers, '%PDF-1.4 a longer body')).status).toBe(200);
        const files = Number((await office.sql<{ n: string }>('select count(*) as n from files'))[0].n);
        expect(await call(leader, 'files.upload', { projectId: 'prj_001', name: 'second-put-2.pdf', uploadId: next.uploadId })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
        const intent = await intentOf(next.uploadId);
        expect([await store.head(intent.staging_key), await store.head(intent.key), intent.used_at]).toEqual([null, null, null]);
        expect(Number((await office.sql<{ n: string }>('select count(*) as n from files'))[0].n)).toBe(files);
      });
    }

    it('a second PUT after files.upload leaves the confirmed version unchanged', async () => {
      const begin = await start(leader, {});
      await put(begin.put.url, begin.put.headers, '%PDF-1.4 first');
      const file = okOf<FileView>(await call(leader, 'files.upload', { projectId: 'prj_001', name: 'late-put.pdf', uploadId: begin.uploadId }));
      // The link still takes a PUT (2 hours on Storage; on R2 a PUT that starts within 10 minutes): a late PUT makes a new
      // staging object, which the job deletes (N3), and nothing that a version uses.
      expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 late!')).status).toBe(200);
      const link = okOf<{ url: string }>(await call(leader, 'files.link', { id: file.file.id, variant: 'full', disposition: 'inline' }));
      expect(await (await fetch(link.url)).text()).toBe('%PDF-1.4 first');
      await expect(call(leader, 'files.upload', { projectId: 'prj_001', name: 'late-put.pdf', uploadId: begin.uploadId })).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
    });

    it('a retry after a busy lock and a second PUT confirms the first object: the check never copies onto the final key', async () => {
      const begin = await start(leader, {});
      expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 first')).status).toBe(200);
      const holder = await office.client();
      await holder.query('begin');
      await holder.query(LOCK_SQL, [office.lockKey]);
      try {
        const busy = await call(leader, 'files.upload', { projectId: 'prj_001', name: 'busy.pdf', uploadId: begin.uploadId });
        expect(busy).toMatchObject({ ok: false, error: { code: 'failed', details: { reason: 'busy' } } });
      } finally {
        await holder.query('rollback');
        await holder.end();
      }
      const intent = await intentOf(begin.uploadId);
      expect([await store.head(intent.staging_key), intent.used_at]).toEqual([null, null]);
      // The staging key is empty again, so the same link takes a second PUT; the final key holds the first object.
      expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 other')).status).toBe(200);
      const file = okOf<FileView>(await call(leader, 'files.upload', { projectId: 'prj_001', name: 'busy.pdf', uploadId: begin.uploadId }));
      const link = okOf<{ url: string }>(await call(leader, 'files.link', { id: file.file.id, variant: 'full', disposition: 'inline' }));
      expect(await (await fetch(link.url)).text()).toBe('%PDF-1.4 first');
      expect(await store.head(intent.staging_key)).toBeNull();
    }, 60_000);

    it('a retry of files.upload with the same key gets the stored answer and makes no second version; a new key gives conflict', async () => {
      const begin = await start(leader, {});
      await put(begin.put.url, begin.put.headers, '%PDF-1.4 first');
      const input = { projectId: 'prj_001', name: 'keyed.pdf', uploadId: begin.uploadId };
      const first = await call(leader, 'files.upload', input, { key: `it-files-upload-1-${v.kind}` });
      const file = okOf<FileView>(first);
      // The answer got lost: the Retry button sends the same entry with the same key, and a late PUT sits on the staging key.
      expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 late!')).status).toBe(200);
      const again = await call(leader, 'files.upload', input, { key: `it-files-upload-1-${v.kind}` });
      expect(again).toEqual({ ok: true, output: file, storyId: first.ok ? first.storyId : '', changed: true });
      const [row] = await office.sql<{ doc: { versions: unknown[] } }>('select doc from files where id = $1', [file.file.id]);
      expect(row.doc.versions).toHaveLength(1);
      expect(await call(leader, 'files.upload', input, { key: `it-files-upload-2-${v.kind}` })).toMatchObject({ ok: false, error: { code: 'conflict' } });
      expect(await call(leader, 'files.upload', input)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    });

    it('refuses a PUT of text/html under an application/pdf intent, removes the object, and makes no version, so it never gets a link', async () => {
      const begin = await start(leader, {});
      // Storage takes the PUT and the check refuses it; an R2 link signs the type, so R2 refuses the PUT itself.
      expect((await put(begin.put.url, { 'Content-Type': 'text/html' }, '<html>x</html>')).status).toBe(v.kind === 'r2' ? 403 : 200);
      const files = Number((await office.sql<{ n: string }>('select count(*) as n from files'))[0].n);
      const result = await call(leader, 'files.upload', { projectId: 'prj_001', name: 'trick.pdf', uploadId: begin.uploadId });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      const intent = await intentOf(begin.uploadId);
      expect([await store.head(intent.staging_key), await store.head(intent.key), intent.used_at]).toEqual([null, null, null]);
      expect(Number((await office.sql<{ n: string }>('select count(*) as n from files'))[0].n)).toBe(files);
    });

    it('refuses an object whose size differs from the intent, and removes it', async () => {
      const begin = await start(leader, { size: 10 });
      expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 first')).status).toBe(200);
      expect(await call(leader, 'files.upload', { projectId: 'prj_001', name: 'size.pdf', uploadId: begin.uploadId })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(await store.head(stagingKey(begin.uploadId))).toBeNull();
    });

    it('refuses an intent past expires_at (2 hours on Storage, 70 minutes on R2), and keeps it unused', async () => {
      const begin = await start(leader, {});
      await put(begin.put.url, begin.put.headers, '%PDF-1.4 first');
      deps.clock.set(new Date(NOW.getTime() + intentMs));
      const result = await call(leader, 'files.upload', { projectId: 'prj_001', name: 'late.pdf', uploadId: begin.uploadId });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'This upload has ended. Upload the file again.' } });
      expect((await intentOf(begin.uploadId)).used_at).toBeNull();
    });

    it('refuses an upload over the limit of the store (50 MB on Storage, 500 MB on R2) with file_too_large, before it signs', async () => {
      const limit = store.maxFileBytes;
      expect(limit).toBe(v.kind === 'r2' ? 500 * 1024 * 1024 : 50 * 1024 * 1024);
      const before = signed.length;
      expect(await call(leader, 'files.uploadStart', { projectId: 'prj_001', name: 'big.zip', size: limit + 1, mimeType: 'application/zip' })).toMatchObject({
        ok: false, error: { code: 'invalid_input', details: { reason: 'file_too_large', limit } },
      });
      expect(signed.length).toBe(before);
    });

    it('keeps a small picture beside the file, and links it', async () => {
      const begin = await start(leader, { name: 'photo.png', mimeType: 'image/png', size: 9, thumb: { size: 5, mimeType: 'image/webp' } });
      await put(begin.put.url, begin.put.headers, 'png-bytes');
      await put(begin.thumbPut!.url, begin.thumbPut!.headers, 'thumb');
      const file = okOf<FileView>(await call(leader, 'files.upload', { projectId: 'prj_001', name: 'photo.png', uploadId: begin.uploadId }));
      const link = okOf<{ url: string }>(await call(leader, 'files.link', { id: file.file.id, variant: 'thumb', disposition: 'inline' }));
      const response = await fetch(link.url);
      expect([response.status, await response.text(), response.headers.get('content-type')?.split(';')[0]]).toEqual([200, 'thumb', 'image/webp']);
    });
  });

  describe(`the files of an office task on ${v.title} (owner, 2026-10-06)`, () => {
    it('a file goes up under office/<task>, and only the people of the task get a link or an upload', async () => {
      const [maker, lead, outsider] = Object.values(office.seed.users)
        .filter((u) => u.kind === 'human' && u.active && u.systemRole === 'member' && u.id !== PERSON_OFF).map((u) => u.id);
      const made = okOf<{ task: { id: string } }>(await call(maker, 'tasks.create', { title: 'Renew the trade licence', ownerId: lead }));
      const taskId = made.task.id;
      const begin = okOf<Start>(await call(lead, 'files.uploadStart', { name: 'licence.pdf', size: 14, mimeType: 'application/pdf', taskId }));
      expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 licen')).status).toBe(200);
      const intent = await intentOf(begin.uploadId);
      expect(intent.key).toBe(`office/${taskId.replace('_', '-')}/${begin.uploadId.replace('_', '-')}/file`);
      const file = okOf<FileView>(await call(lead, 'files.upload', { name: 'licence.pdf', taskId, uploadId: begin.uploadId }));
      expect(file.file).toMatchObject({ projectId: null, taskId });
      expect(await store.head(intent.key)).toEqual({ size: 14, mimeType: 'application/pdf' });

      signed.length = 0;
      const link = await call(outsider, 'files.link', { id: file.file.id, variant: 'full', disposition: 'inline' });
      expect(link.ok ? 'signed' : link.error.code).toBe('not_found');
      const other = await call(outsider, 'files.uploadStart', { name: 'x.pdf', size: 1, mimeType: 'application/pdf', taskId });
      expect(other.ok ? 'signed' : other.error.code).toBe('not_found');
      const list = await call(outsider, 'files.list', { taskId });
      expect(list.ok ? 'listed' : list.error.code).toBe('not_found');
      expect(signed).toEqual([]);
      expect(okOf<{ name: string }>(await call(maker, 'files.link', { id: file.file.id, variant: 'full', disposition: 'attachment' })).name).toBe('licence.pdf');
      expect(okOf<FileView[]>(await call(ADMIN, 'files.list', { taskId })).map((view) => view.file.id)).toEqual([file.file.id]);
    });
  });

  describe(`the files of a direct chat on ${v.title} (owner, 2026-10-19)`, () => {
    it('a file goes up under chat/<chat>, the message carries it, and only the two people of the chat get a link or an upload', async () => {
      const [first, second, outsider] = Object.values(office.seed.users)
        .filter((u) => u.kind === 'human' && u.active && u.systemRole === 'member' && u.id !== PERSON_OFF).map((u) => u.id);
      const chat = okOf<{ id: string }>(await call(first, 'chats.openDirect', { userId: second }));
      const begin = okOf<Start>(await call(first, 'files.uploadStart', { name: 'site.pdf', size: 14, mimeType: 'application/pdf', conversationId: chat.id }));
      expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 licen')).status).toBe(200);
      const intent = await intentOf(begin.uploadId);
      expect(intent.key).toBe(`chat/${chat.id.replace('_', '-')}/${begin.uploadId.replace('_', '-')}/file`);
      const file = okOf<FileView>(await call(first, 'files.upload', { name: 'site.pdf', conversationId: chat.id, uploadId: begin.uploadId }));
      expect(file.file).toMatchObject({ projectId: null, taskId: null, stageId: null, conversationId: chat.id });
      expect(await store.head(intent.key)).toEqual({ size: 14, mimeType: 'application/pdf' });
      const sent = okOf<{ files: { id: string; name: string; mimeType: string }[] }>(await call(first, 'chats.send', { conversationId: chat.id, body: 'The site sheet.', fileIds: [file.file.id] }));
      expect(sent.files).toEqual([{ id: file.file.id, name: 'site.pdf', mimeType: 'application/pdf' }]);

      signed.length = 0;
      for (const userId of [outsider, ADMIN]) {
        const link = await call(userId, 'files.link', { id: file.file.id, variant: 'full', disposition: 'inline' });
        expect(link.ok ? 'signed' : link.error.code, userId).toBe('not_found');
        const other = await call(userId, 'files.uploadStart', { name: 'x.pdf', size: 1, mimeType: 'application/pdf', conversationId: chat.id });
        expect(other.ok ? 'signed' : other.error.code, userId).toBe('not_found');
        const read = await call(userId, 'chats.messages', { conversationId: chat.id });
        expect(read.ok ? 'read' : read.error.code, userId).not.toBe('read');
      }
      expect(signed).toEqual([]);
      expect(okOf<{ name: string }>(await call(second, 'files.link', { id: file.file.id, variant: 'full', disposition: 'attachment' })).name).toBe('site.pdf');
      const found = okOf<{ files: { id: string }[] }>(await call(first, 'search.query', { text: 'site' }));
      expect(found.files.map((hit) => hit.id)).not.toContain(file.file.id);
    });
  });

  describe(`the files of a meeting with no project on ${v.title} (wave 2, owner 2026-10-19)`, () => {
    it('a file goes up under meeting/<meeting> after the end, and only the two people of the meeting get a link or an upload', async () => {
      const [organizer, attendee, outsider] = Object.values(office.seed.users)
        .filter((u) => u.kind === 'human' && u.active && u.systemRole === 'member' && u.id !== PERSON_OFF).map((u) => u.id);
      // The clock of the suite is 2026-10-04 09:00 in Riyadh, so this meeting ended two days ago.
      const meeting = okOf<{ id: string }>(await call(organizer, 'meetings.create', { kind: 'meeting', title: 'Salary talk', startsAt: '2026-10-02T09:00:00+03:00', attendeeIds: [attendee] }));
      const begin = okOf<Start>(await call(attendee, 'files.uploadStart', { name: 'minutes.pdf', size: 14, mimeType: 'application/pdf', meetingId: meeting.id }));
      expect((await put(begin.put.url, begin.put.headers, '%PDF-1.4 minut')).status).toBe(200);
      const intent = await intentOf(begin.uploadId);
      expect(intent.key).toBe(`meeting/${meeting.id.replace('_', '-')}/${begin.uploadId.replace('_', '-')}/file`);
      const file = okOf<FileView>(await call(attendee, 'files.upload', { name: 'minutes.pdf', meetingId: meeting.id, uploadId: begin.uploadId }));
      expect(file.file).toMatchObject({ projectId: null, taskId: null, stageId: null, meetingId: meeting.id });
      expect(await store.head(intent.key)).toEqual({ size: 14, mimeType: 'application/pdf' });

      signed.length = 0;
      for (const userId of [outsider, ADMIN]) {
        const link = await call(userId, 'files.link', { id: file.file.id, variant: 'full', disposition: 'inline' });
        expect(link.ok ? 'signed' : link.error.code, userId).toBe('not_found');
        const other = await call(userId, 'files.uploadStart', { name: 'x.pdf', size: 1, mimeType: 'application/pdf', meetingId: meeting.id });
        expect(other.ok ? 'signed' : other.error.code, userId).toBe('not_found');
      }
      expect(signed).toEqual([]);
      expect(okOf<{ name: string }>(await call(organizer, 'files.link', { id: file.file.id, variant: 'full', disposition: 'attachment' })).name).toBe('minutes.pdf');
      const found = okOf<{ files: { id: string }[] }>(await call(attendee, 'search.query', { text: 'minutes' }));
      expect(found.files.map((hit) => hit.id)).not.toContain(file.file.id);
    });
  });

  describe(`no link for a person who may not see the file, on ${v.title} (plan 2b, point 7)`, () => {
    let fileId = '';

    beforeAll(async () => {
      const begin = await start(leader, {});
      await put(begin.put.url, begin.put.headers, '%PDF-1.4 first');
      fileId = okOf<FileView>(await call(leader, 'files.upload', { projectId: 'prj_001', name: 'seen.pdf', uploadId: begin.uploadId })).file.id;
      okOf(await call(ADMIN, 'users.deactivate', { id: PERSON_OFF }));
    }, 60_000);

    it('refuses files.link, files.uploadStart and feedback.uploadStart to an inactive person and to an agent whose person is off, and signs nothing', async () => {
      const before = signed.length;
      const intents = Number((await office.sql<{ n: string }>('select count(*) as n from upload_intents'))[0].n);
      for (const userId of [PERSON_OFF, AGENT_OFF]) {
        for (const [name, input] of [
          ['files.link', { id: fileId, variant: 'full', disposition: 'attachment' }],
          ['files.uploadStart', { projectId: 'prj_001', name: 'x.pdf', size: 1, mimeType: 'application/pdf' }],
          ['feedback.uploadStart', { screenshots: [{ size: 1, mimeType: 'image/png' }] }],
        ] as const) {
          expect(await call(userId, name, input), `${userId} ${name}`).toMatchObject({ ok: false, error: { code: 'unauthenticated', details: { reason: 'account_off' } } });
        }
      }
      expect(signed.length).toBe(before);
      expect(Number((await office.sql<{ n: string }>('select count(*) as n from upload_intents'))[0].n)).toBe(intents);
    });
  });

  describe(`feedback screenshots on ${v.title}`, () => {
    it('a screenshot goes up with feedback.send, and only the Admin gets its link', async () => {
      const begin = okOf<{ uploads: Start[] }>(await call('usr_005', 'feedback.uploadStart', { screenshots: [{ size: 8, mimeType: 'image/png' }] }));
      const [upload] = begin.uploads;
      expect((await put(upload.put.url, upload.put.headers, 'png-shot')).status).toBe(200);
      const report = okOf<{ id: string; screenshots: { blobKey: string }[] }>(await call('usr_005', 'feedback.send', { kind: 'feature', message: 'A clearer page', uploadIds: [upload.uploadId] }));
      expect(report.screenshots.map((s) => s.blobKey)).toEqual([`feedback/${upload.uploadId.replace('_', '-')}/file`]);
      const link = okOf<{ url: string }>(await call(ADMIN, 'feedback.screenshot', { id: report.id, index: 0 }));
      expect(await (await fetch(link.url)).text()).toBe('png-shot');
      const before = signed.length;
      expect(await call('usr_005', 'feedback.screenshot', { id: report.id, index: 0 })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(signed.length).toBe(before);
    });

    it('a retry of feedback.send with the same key gets the stored answer and makes no second report; a new key gives conflict', async () => {
      const begin = okOf<{ uploads: Start[] }>(await call('usr_005', 'feedback.uploadStart', { screenshots: [{ size: 8, mimeType: 'image/png' }] }));
      const [upload] = begin.uploads;
      await put(upload.put.url, upload.put.headers, 'png-shot');
      const input = { kind: 'bug', message: 'A keyed report', uploadIds: [upload.uploadId] };
      const first = await call('usr_005', 'feedback.send', input, { key: `it-feedback-send-1-${v.kind}` });
      const report = okOf(first);
      const reports = Number((await office.sql<{ n: string }>('select count(*) as n from feedback'))[0].n);
      expect(await call('usr_005', 'feedback.send', input, { key: `it-feedback-send-1-${v.kind}` })).toEqual({ ok: true, output: report, storyId: first.ok ? first.storyId : '', changed: true });
      expect(Number((await office.sql<{ n: string }>('select count(*) as n from feedback'))[0].n)).toBe(reports);
      expect(await call('usr_005', 'feedback.send', input, { key: `it-feedback-send-2-${v.kind}` })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    });
  });

  describe(`a project delete and its stored data, on ${v.title}`, () => {
    it('removes the data only after the commit, and keeps a key that another project uses', async () => {
      const keys: string[] = [];
      for (const name of ['delete-1.pdf', 'delete-2.pdf']) {
        const begin = await start(leader, { name });
        await put(begin.put.url, begin.put.headers, '%PDF-1.4 first');
        okOf(await call(leader, 'files.upload', { projectId: 'prj_001', name, uploadId: begin.uploadId }));
        keys.push((await intentOf(begin.uploadId)).key);
      }
      // A file of prj_002 uses the second key too (as an imported copy would).
      const shared = { id: 'fil_shared', projectId: 'prj_002', stageId: null, taskId: null, name: 'shared.pdf', versions: [{ letter: 'A', blobKey: keys[1], mimeType: 'application/pdf', size: 14, uploadedBy: ADMIN, uploadedAt: '2026-10-04T09:00:00+03:00' }] };
      await office.sql('insert into files (id, doc) values ($1, $2)', [shared.id, JSON.stringify(shared)]);

      // A refused delete rolls back: no outbox row, and the data stays.
      expect(await call(leader, 'projects.delete', { id: 'prj_001', confirm: true })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(Number((await office.sql<{ n: string }>("select count(*) as n from outbox where kind = 'r2.delete'"))[0].n)).toBe(0);
      for (const key of keys) expect(await store.head(key), key).not.toBeNull();

      // The removal runs after the commit: when it runs, another connection no longer sees the project's files.
      const seenAtRemoval: number[] = [];
      const remove = deps.files.remove;
      deps.files.remove = async (gone) => {
        seenAtRemoval.push(Number((await office.sql<{ n: string }>("select count(*) as n from files where project_id = 'prj_001'"))[0].n));
        return remove(gone);
      };
      try {
        okOf(await call(ADMIN, 'projects.delete', { id: 'prj_001', confirm: true }));
      } finally {
        deps.files.remove = remove;
      }
      expect(seenAtRemoval).toEqual([0]);
      expect(await store.head(keys[0])).toBeNull();
      expect(await store.head(keys[1])).not.toBeNull();
      const [row] = await office.sql<{ done_at: Date | null; payload: { keys: string[] } }>("select done_at, payload from outbox where kind = 'r2.delete'");
      expect(row.done_at).not.toBeNull();
      expect(row.payload.keys).toEqual(expect.arrayContaining(keys));
    }, 120_000);
  });

  // The fake store of this case is the same for both runs, so it runs once.
  if (v.kind === 'supabase') {
    describe('a slow store never holds the office lock', () => {
      it('with a FilesPort that waits 10 s in head, a parallel tasks.create still succeeds', async () => {
        const slow = office.isolate();
        slow.files = fakeFiles({ headDelayMs: 10_000 });
        const projectLeader = office.seed.projects.prj_002.leaderId!;
        const as = (name: string, input: unknown) => runCall(slow, { principal: { userId: projectLeader }, name, input, batch: newBatch() });
        const begin = okOf<Start>(await as('files.uploadStart', { projectId: 'prj_002', name: 'slow.pdf', size: 3, mimeType: 'application/pdf' }));
        slow.files.objects.set(stagingKey(begin.uploadId), { size: 3, mimeType: 'application/pdf' });
        let uploaded = 0;
        const uploading = as('files.upload', { projectId: 'prj_002', name: 'slow.pdf', uploadId: begin.uploadId }).then((result) => {
          uploaded = Date.now();
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const task = await call(projectLeader, 'tasks.create', { projectId: 'prj_002', title: 'Made while a file waits' });
        const created = Date.now();
        expect(task.ok).toBe(true);
        // The preflight waits in head three times (the final key, the staging object and its copy) before it asks for the lock.
        expect(okOf<FileView>(await uploading).file.name).toBe('slow.pdf');
        expect(created).toBeLessThan(uploaded);
      }, 90_000);
    });
  }
}
