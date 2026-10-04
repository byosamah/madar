import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';
import { storedMimeType } from '../../server/files/links';
import { r2Endpoint, r2FilesPort, type R2Env } from '../../server/files/r2';

/**
 * The move of the files from Supabase Storage to R2 (plan 2b, point 1): every object goes to R2 with the same key, and with
 * the type that an upload gets (storedMimeType, so a download-only type lands as application/octet-stream).
 * A full copy first, then a second pass for the objects that changed or came during the first. Then every key on R2 that the
 * source no longer has goes, also one from an earlier run (a project delete between two runs). Last, a size check of each
 * object on R2. The source stays as it is. After a clean run the switch is one setting: MADAR_FILE_STORE=r2 plus the R2 secrets.
 * The run refuses to start after the switch (MADAR_FILE_STORE=r2): R2 then holds files that Storage never had, and the
 * clean-up step would remove them.
 *
 * Run (the screens keep working during the run, so run it once more right before the switch):
 *   set -a; . <secrets file>; set +a; npx tsx scripts/storage/move-to-r2.ts
 * Values: SUPABASE_URL, MADAR_SECRET_KEY (the Storage secret key), FILES_BUCKET (default madar-files),
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_ENDPOINT only for a test target (MinIO).
 * It prints one JSON report with no secret and no link, and exits 1 when an object differs on R2.
 */

export type SourceObject = { key: string; size: number; etag: string; mimeType: string };

export interface MoveSource {
  list(): Promise<SourceObject[]>;
  /** The bytes and the type of one object, or null when it went. */
  read(key: string): Promise<{ body: ArrayBuffer; mimeType: string } | null>;
}

export interface MoveTarget {
  write(key: string, body: ArrayBuffer, mimeType: string): Promise<void>;
  head(key: string): Promise<{ size: number } | null>;
  remove(keys: string[]): Promise<void>;
  /** Every key in the target bucket. */
  list(): Promise<string[]>;
}

export type MoveReport = {
  /** The objects on the source after the second pass, and their bytes. */
  objects: number;
  bytes: number;
  firstPass: number;
  secondPass: number;
  /** Keys on the target that the source no longer has: from this run or from an earlier one. */
  removedFromTarget: number;
  /** Keys whose size on R2 differs from the source. The switch must wait until this is empty. */
  mismatched: string[];
};

async function copyAll(source: MoveSource, target: MoveTarget, objects: SourceObject[], log: (line: string) => void): Promise<Map<string, SourceObject>> {
  const copied = new Map<string, SourceObject>();
  for (const object of objects) {
    const read = await source.read(object.key);
    if (!read) continue;
    // The type from the object list is the stored type. The download answer can differ: Storage serves HTML as text/plain.
    // storedMimeType then gives it the same type as an upload, so R2 never keeps a type that a browser renders as a page.
    await target.write(object.key, read.body, storedMimeType(object.mimeType || read.mimeType));
    copied.set(object.key, object);
    if (copied.size % 100 === 0) log(`copied ${copied.size} of ${objects.length}`);
  }
  return copied;
}

export async function moveToR2(source: MoveSource, target: MoveTarget, o: { log?: (line: string) => void } = {}): Promise<MoveReport> {
  const log = o.log ?? ((line: string) => console.error(line));

  const first = await copyAll(source, target, await source.list(), log);
  log(`first pass: ${first.size} objects`);

  const now = await source.list();
  const changed = now.filter((object) => {
    const before = first.get(object.key);
    return !before || before.etag !== object.etag || before.size !== object.size;
  });
  const second = await copyAll(source, target, changed, log);
  const present = new Set(now.map((object) => object.key));
  const gone = (await target.list()).filter((key) => !present.has(key));
  if (gone.length > 0) await target.remove(gone);
  log(`second pass: ${second.size} objects, ${gone.length} removed`);

  const mismatched: string[] = [];
  for (const object of now) {
    const head = await target.head(object.key);
    if (!head || head.size !== object.size) mismatched.push(object.key);
  }
  return {
    objects: now.length,
    bytes: now.reduce((sum, object) => sum + object.size, 0),
    firstPass: first.size,
    secondPass: second.size,
    removedFromTarget: gone.length,
    mismatched,
  };
}

/** The objects of a Supabase Storage bucket, through the raw Storage API with the secret key. */
export function storageSource(env: { supabaseUrl: string; secretKey: string; bucket: string }): MoveSource {
  const storage = `${env.supabaseUrl.replace(/\/+$/, '')}/storage/v1`;
  const headers = { apikey: env.secretKey, authorization: `Bearer ${env.secretKey}` };
  const PAGE = 1000;

  type Entry = { name: string; id: string | null; metadata?: { size?: number; mimetype?: string; eTag?: string } | null; updated_at?: string };

  async function folder(prefix: string, out: SourceObject[]): Promise<void> {
    for (let offset = 0; ; offset += PAGE) {
      const response = await fetch(`${storage}/object/list/${env.bucket}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!response.ok) throw new Error(`Storage list failed with ${response.status}.`);
      const entries = (await response.json()) as Entry[];
      for (const entry of entries) {
        const key = `${prefix}${entry.name}`;
        // A folder has no id and no metadata.
        if (entry.id === null) await folder(`${key}/`, out);
        else out.push({ key, size: Number(entry.metadata?.size ?? 0), etag: String(entry.metadata?.eTag ?? entry.updated_at ?? ''), mimeType: entry.metadata?.mimetype ?? 'application/octet-stream' });
      }
      if (entries.length < PAGE) return;
    }
  }

  return {
    async list() {
      const out: SourceObject[] = [];
      await folder('', out);
      return out;
    },
    async read(key) {
      const response = await fetch(`${storage}/object/${env.bucket}/${key}`, { headers });
      if (response.status === 404 || response.status === 400) {
        await response.arrayBuffer();
        return null;
      }
      if (!response.ok) throw new Error(`Storage read failed with ${response.status}.`);
      return { body: await response.arrayBuffer(), mimeType: response.headers.get('content-type') ?? 'application/octet-stream' };
    },
  };
}

/** The text of an XML element value: the five XML entities and the number forms. */
function xmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, name: string) => {
    if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()];
  });
}

/** The R2 bucket (or a test S3 server) as the target. */
export function r2Target(env: R2Env): MoveTarget {
  const port = r2FilesPort(env);
  const client = new AwsClient({ accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey, service: 's3', region: 'auto', retries: 2 });
  const endpoint = r2Endpoint(env);
  return {
    async write(key, body, mimeType) {
      const response = await client.fetch(`${endpoint}/${env.bucket}/${key}`, { method: 'PUT', headers: { 'content-type': mimeType }, body });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`R2 write failed with ${response.status}.`);
    },
    head: (key) => port.head(key, { timeoutMs: 30_000 }),
    remove: (keys) => port.remove(keys),
    async list() {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const url = new URL(`${endpoint}/${env.bucket}`);
        url.searchParams.set('list-type', '2');
        if (token) url.searchParams.set('continuation-token', token);
        const response = await client.fetch(url.toString());
        const body = await response.text();
        if (!response.ok) throw new Error(`R2 list failed with ${response.status}.`);
        for (const match of body.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlText(match[1]));
        const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(body)?.[1];
        token = /<IsTruncated>true<\/IsTruncated>/.test(body) && next ? xmlText(next) : undefined;
      } while (token);
      return keys;
    },
  };
}

/** Stops the run after the switch: R2 is then the store of the screens, and the clean-up step would remove its new files. */
export function assertBeforeSwitch(values: Record<string, string | undefined>): void {
  if ((values.MADAR_FILE_STORE ?? '').trim().toLowerCase() === 'r2') {
    throw new Error('MADAR_FILE_STORE is r2: the move runs only before the switch, never after the switch.');
  }
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  assertBeforeSwitch(process.env);
  const source = storageSource({ supabaseUrl: need('SUPABASE_URL'), secretKey: need('MADAR_SECRET_KEY'), bucket: process.env.FILES_BUCKET || 'madar-files' });
  const target = r2Target({
    accountId: need('R2_ACCOUNT_ID'), accessKeyId: need('R2_ACCESS_KEY_ID'), secretAccessKey: need('R2_SECRET_ACCESS_KEY'), bucket: need('R2_BUCKET'),
    ...(process.env.R2_ENDPOINT ? { endpoint: process.env.R2_ENDPOINT } : {}),
  });
  const report = await moveToR2(source, target);
  console.log(JSON.stringify(report, null, 2));
  if (report.mismatched.length > 0) process.exit(1);
}
