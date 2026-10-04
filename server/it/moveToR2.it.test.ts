import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moveToR2, r2Target, storageSource } from '../../scripts/storage/move-to-r2';
import { storedMimeType } from '../files/links';
import { supabaseStorageFilesPort } from '../files/supabaseStorage';
import { minioClient, minioEnv, minioUrl, startMinio, stopMinio } from './minio';

/**
 * scripts/storage/move-to-r2.ts from the local Supabase Storage to MinIO (plan 2b, point 1). It needs the local stack, Docker
 * and the Docker lock. The bucket on the local stack is a bucket of its own, so the run moves only the objects of this test.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SOURCE_BUCKET = 'madar-move-it';
const TARGET_BUCKET = 'madar-files';

let secret = '';

function secretKey(): string {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, string>;
  return status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
}

async function storage(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/storage/v1${path}`, { ...init, headers: { apikey: secret, authorization: `Bearer ${secret}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

async function dropSourceBucket(): Promise<void> {
  await (await storage(`/bucket/${SOURCE_BUCKET}/empty`, { method: 'POST' })).arrayBuffer();
  for (let i = 0; i < 20; i += 1) {
    const response = await storage(`/bucket/${SOURCE_BUCKET}`, { method: 'DELETE' });
    await response.arrayBuffer();
    if (response.ok || response.status === 404 || response.status === 400) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const OBJECTS: [string, string, string][] = [
  ['prj-001/fil-001/1/file', 'application/pdf', '%PDF-1.4 a plan'],
  ['prj-001/fil-001/1/thumb', 'image/webp', 'RIFF thumb'],
  ['prj-002/fil-009/3/file', 'text/html', '<p>a page</p>'],
  ['feedback/upl-1/file', 'image/png', 'PNG shot'],
];

beforeAll(async () => {
  secret = secretKey();
  await dropSourceBucket();
  const made = await storage('/bucket', { method: 'POST', body: JSON.stringify({ id: SOURCE_BUCKET, name: SOURCE_BUCKET, public: false }) });
  expect(made.status, await made.text()).toBe(200);
  const source = supabaseStorageFilesPort({ supabaseUrl: SUPABASE_URL, secretKey: secret, bucket: SOURCE_BUCKET });
  for (const [key, type, body] of OBJECTS) {
    const link = await source.presignPut(key, { mimeType: type });
    const response = await fetch(link.url, { method: 'PUT', headers: { 'Content-Type': type }, body });
    expect(response.status, await response.text()).toBe(200);
  }
  await startMinio([TARGET_BUCKET]);
}, 120_000);

afterAll(async () => {
  stopMinio();
  await dropSourceBucket();
});

describe('move-to-r2 from the local Storage to MinIO', () => {
  it('copies every object with the same key, bytes and stored type, and finds no difference', async () => {
    const report = await moveToR2(storageSource({ supabaseUrl: SUPABASE_URL, secretKey: secret, bucket: SOURCE_BUCKET }), r2Target(minioEnv(TARGET_BUCKET)), { log: () => {} });
    expect(report).toEqual({ objects: 4, bytes: OBJECTS.reduce((n, [, , body]) => n + body.length, 0), firstPass: 4, secondPass: 0, removedFromTarget: 0, mismatched: [] });
    const client = minioClient();
    for (const [key, type, body] of OBJECTS) {
      const response = await client.fetch(minioUrl(TARGET_BUCKET, key));
      expect(response.status, key).toBe(200);
      expect(await response.text(), key).toBe(body);
      expect(response.headers.get('content-type')?.split(';')[0], key).toBe(storedMimeType(type));
    }
  });

  it('a second run copies nothing new and still finds no difference', async () => {
    const report = await moveToR2(storageSource({ supabaseUrl: SUPABASE_URL, secretKey: secret, bucket: SOURCE_BUCKET }), r2Target(minioEnv(TARGET_BUCKET)), { log: () => {} });
    expect(report).toMatchObject({ objects: 4, firstPass: 4, secondPass: 0, mismatched: [] });
  });

  it('a run after a delete on the source removes that object from the target', async () => {
    const [key] = OBJECTS[1];
    const removed = await storage(`/object/${SOURCE_BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: [key] }) });
    expect(removed.status, await removed.text()).toBe(200);
    const report = await moveToR2(storageSource({ supabaseUrl: SUPABASE_URL, secretKey: secret, bucket: SOURCE_BUCKET }), r2Target(minioEnv(TARGET_BUCKET)), { log: () => {} });
    expect(report).toMatchObject({ objects: 3, removedFromTarget: 1, mismatched: [] });
    const gone = await minioClient().fetch(minioUrl(TARGET_BUCKET, key));
    await gone.arrayBuffer();
    expect(gone.status).toBe(404);
    expect((await r2Target(minioEnv(TARGET_BUCKET)).list()).sort()).toEqual(OBJECTS.map(([k]) => k).filter((k) => k !== key).sort());
  });
});
