import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileStoreKind, FilesPort } from '../core/ports';
import { runCall } from '../core/runCall';
import { readOffice } from '../data/officeCache';
import { r2FilesPort } from '../files/r2';
import { supabaseStorageFilesPort } from '../files/supabaseStorage';
import { MAX_UPLOAD_BYTES, runUpload } from '../mcp/upload';
import { minioEnv, startMinio, stopMinio } from './minio';
import { startOffice, type ItOffice } from './runCallOffice';

/**
 * One real upload by content (files.uploadContent, owner decision of 2026-10-26) on the local stack, on both file stores: the local
 * Supabase Storage, then R2 through r2FilesPort on MinIO (server/it/minio.ts). The tool runs files.uploadStart, puts the bytes to the
 * signed link, and runs files.upload, with the rights of the person of the agent. The test checks that the object sits at its FINAL key
 * with the right size and type, that the staging object is gone, and that the answer of the tool holds no storage key and no signed link.
 * It needs the local stack, Docker and the Docker lock. It talks only to 127.0.0.1.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const SUPABASE_URL = 'http://127.0.0.1:54321';
const BUCKET = 'madar-files';
const AGENT = 'usr_091';
const PDF = new TextEncoder().encode('%PDF-1.4 a small plan from an agent, sent by content');

function secretKey(): string {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>;
  return status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
}

type Variant = { kind: FileStoreKind; title: string; office: string; start(): Promise<FilesPort>; stop(): void };

const VARIANTS: Variant[] = [
  {
    kind: 'supabase', title: 'the local Supabase Storage', office: 'upc',
    start: async () => supabaseStorageFilesPort({ supabaseUrl: SUPABASE_URL, secretKey: secretKey(), bucket: BUCKET }),
    stop: () => undefined,
  },
  {
    kind: 'r2', title: 'R2 (r2FilesPort on MinIO)', office: 'upc_r2',
    start: async () => {
      await startMinio([BUCKET]);
      return r2FilesPort(minioEnv(BUCKET));
    },
    stop: () => stopMinio(),
  },
];

const base64Of = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

for (const variant of VARIANTS) {
  describe(`files.uploadContent on ${variant.title}`, () => {
    let office: ItOffice;
    let deps: ReturnType<ItOffice['isolate']>;
    let store: FilesPort;
    let leader = '';

    beforeAll(async () => {
      office = await startOffice(variant.office);
      deps = office.isolate();
      store = await variant.start();
      deps.files = store as never;
      leader = office.seed.projects.prj_001.leaderId!;
      // An agent of the leader of prj_001. Its row carries the next office version, so the office cache reads it with the first call.
      const doc = { ...office.seed.users.usr_001, id: AGENT, name: 'Agent of the leader', email: 'agent.upload@madar.test', kind: 'agent', systemRole: 'member', discipline: 'Agent', ownerId: leader };
      await office.sql('insert into users (id, doc, chg) values ($1, $2, (select version + 1 from office_meta))', [AGENT, JSON.stringify(doc)]);
    }, 120_000);

    afterAll(async () => {
      try {
        if (!office) return;
        const rows = await office.sql<{ key: string; staging_key: string }>('select key, staging_key from upload_intents');
        if (rows.length > 0) await store.remove(rows.flatMap((r) => [r.key, r.staging_key])).catch(() => undefined);
        await office.close();
      } finally {
        variant.stop();
      }
    });

    it('puts the file at its final key with the right size and type, removes the staging object, and answers with the record only', async () => {
      const result = await runUpload(
        'files.uploadContent',
        { projectId: 'prj_001', name: 'Agent plan.pdf', type: 'application/pdf', contentBase64: base64Of(PDF) },
        { deps, principal: { userId: AGENT, agent: { clientId: 'it-upload' } }, office: await readOffice(deps), runCall },
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const answer = result.output as { id: string; name: string; version: string; size: number; type: string; place: Record<string, unknown> };
      expect(answer).toMatchObject({ name: 'Agent plan.pdf', size: PDF.length, type: 'application/pdf', place: { projectId: 'prj_001' } });

      // The version of the file holds the final key, and the store holds the object there with the size and type of the bytes.
      const [row] = await office.sql<{ doc: { versions: { blobKey: string; size: number; mimeType: string }[] } }>('select doc from files where id = $1', [answer.id]);
      expect(row.doc.versions).toHaveLength(1);
      const [version] = row.doc.versions;
      expect([version.size, version.mimeType]).toEqual([PDF.length, 'application/pdf']);
      const [intent] = await office.sql<{ key: string; staging_key: string; used_at: Date | null }>('select key, staging_key, used_at from upload_intents');
      expect(version.blobKey).toBe(intent.key);
      expect(intent.used_at).not.toBeNull();
      expect(intent.key).not.toBe(intent.staging_key);
      expect(await store.head(intent.key)).toEqual({ size: PDF.length, mimeType: 'application/pdf' });
      expect(await store.head(intent.staging_key)).toBeNull();

      // The bytes that come back are the bytes that went up.
      const link = await store.presignGet(intent.key, { disposition: 'inline', filename: 'Agent plan.pdf', mimeType: 'application/pdf' });
      const body = new Uint8Array(await (await fetch(link.url)).arrayBuffer());
      expect(Buffer.from(body).equals(Buffer.from(PDF))).toBe(true);

      // The agent never gets a storage key or a signed link.
      const text = JSON.stringify(result);
      for (const secret of [intent.key, intent.staging_key, version.blobKey, link.url, 'blobKey', 'stagingKey', 'http://', 'https://', 'X-Amz', 'token=', 'signature']) {
        expect(text, secret).not.toContain(secret);
      }
      expect(Object.keys(answer).sort()).toEqual(['id', 'name', 'place', 'size', 'type', 'uploadedAt', 'version']);
    }, 60_000);

    it('refuses a file over the limit before the store sees it', async () => {
      const before = Number((await office.sql<{ n: string }>('select count(*) as n from upload_intents'))[0].n);
      const result = await runUpload(
        'files.uploadContent',
        { projectId: 'prj_001', name: 'Huge.pdf', type: 'application/pdf', contentBase64: 'A'.repeat(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4) },
        { deps, principal: { userId: AGENT, agent: { clientId: 'it-upload' } }, office: await readOffice(deps), runCall },
      );
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(Number((await office.sql<{ n: string }>('select count(*) as n from upload_intents'))[0].n)).toBe(before);
    });
  });
}
