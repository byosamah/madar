import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';
import { storedMimeType } from '../../server/files/links';
import { r2Endpoint, r2FilesPort, type R2Env } from '../../server/files/r2';
import type { Target } from '../deploy/secrets';
import { secretKeyFromApi } from '../first-admin';
import { accessToken, askLine, confirmProduction, copyEnv, envArg, readLocalEnv, readSecretsText } from './env';

/**
 * The move of the files from Supabase Storage to R2 (plan 2b, point 1; owner, 2026-10-16): every object goes to R2 with the same
 * key, and with the type that an upload gets (storedMimeType, so a download-only type lands as application/octet-stream).
 * A full copy first, then a second pass for the objects that changed or came during the first. Then every key on R2 that the
 * source no longer has goes, also one from an earlier run (a project delete between two runs). Last, a size check of each
 * object on R2. The source stays as it is. After a clean run the switch is one setting: MADAR_FILE_STORE=r2 plus the R2 secrets.
 * The full move refuses to start after the switch (MADAR_FILE_STORE=r2): R2 then holds files that Storage never had, and the
 * clean-up step would remove them.
 *
 * --copy-only is the pass for after the switch (scripts/deploy/CLAUDE.md, "Switch the files to R2"): it copies only the keys
 * that R2 lacks (an upload that people confirmed on Storage just before the switch), never removes a key, and never writes a key
 * that R2 holds. It runs before and after the switch.
 *
 * Run for one copy (the screens keep working during the run, so run it once more right before the switch):
 *   npx tsx scripts/storage/move-to-r2.ts --env test|production [--copy-only]
 * The project comes from the fixed ref, the Storage secret key from the Management API with SUPABASE_ACCESS_TOKEN (the
 * environment, else .env.local), and MADAR_FILE_STORE, FILES_BUCKET and the four R2 values from secrets/<env>.env only. It
 * refuses an R2_BUCKET that is not the bucket of that copy (madar-files-test, madar-files). Production asks for the typed word
 * production on stdin (echo production | ...) and refuses under CI. Network calls need the sandbox off.
 *
 * The old form takes every value from the shell (the integration test runs it on MinIO):
 *   set -a; . <values>; set +a; npx tsx scripts/storage/move-to-r2.ts [--copy-only]
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

export type CopyReport = {
  /** The objects on the source. */
  objects: number;
  /** Source keys that R2 holds already: R2 keeps its object. */
  alreadyOnTarget: number;
  copied: number;
  /** Keys that went from the source between the list and the read. */
  goneFromSource: number;
  /** Copied keys whose size on R2 differs from the source. */
  mismatched: string[];
};

/**
 * The copy-only pass: every source key that R2 lacks goes to R2. It never removes a key and never writes a key that R2 holds,
 * so it is safe after the switch, when R2 holds files that Storage never had. A new upload never takes an old key (each upload
 * has a new intent), but a head right before each write keeps that rule also when a key reaches R2 after the list.
 */
export async function copyMissing(source: MoveSource, target: MoveTarget, o: { log?: (line: string) => void } = {}): Promise<CopyReport> {
  const log = o.log ?? ((line: string) => console.error(line));
  const objects = await source.list();
  const present = new Set(await target.list());
  const missing = objects.filter((object) => !present.has(object.key));
  let late = 0;
  let gone = 0;
  const copied: SourceObject[] = [];
  for (const object of missing) {
    if (await target.head(object.key)) {
      late += 1;
      continue;
    }
    const read = await source.read(object.key);
    if (!read) {
      gone += 1;
      continue;
    }
    await target.write(object.key, read.body, storedMimeType(object.mimeType || read.mimeType));
    copied.push(object);
    if (copied.length % 100 === 0) log(`copied ${copied.length} of ${missing.length}`);
  }
  log(`copy-only: ${copied.length} of ${objects.length} objects were missing on R2`);
  const mismatched: string[] = [];
  for (const object of copied) {
    const head = await target.head(object.key);
    if (!head || head.size !== object.size) mismatched.push(object.key);
  }
  return { objects: objects.length, alreadyOnTarget: objects.length - missing.length + late, copied: copied.length, goneFromSource: gone, mismatched };
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
  // A signed request through the fetch of the env (the tests watch it), else through aws4fetch with its retries.
  const send = async (url: string, init: RequestInit = {}): Promise<Response> => (env.fetch ? env.fetch(await client.sign(url, init)) : client.fetch(url, init));
  return {
    async write(key, body, mimeType) {
      const response = await send(`${endpoint}/${env.bucket}/${key}`, { method: 'PUT', headers: { 'content-type': mimeType }, body });
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
        const response = await send(url.toString());
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
    throw new Error('MADAR_FILE_STORE is r2: the full move runs only before the switch, never after the switch. After it, use --copy-only.');
  }
}

export type MoveArgs = { env?: Target; copyOnly: boolean };

export function parseMoveArgs(argv: string[]): MoveArgs {
  const env = envArg(argv);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--env') i += 1;
    else if (argv[i] !== '--copy-only') throw new Error(`${argv[i]} is not an option. Use --env test|production and --copy-only.`);
  }
  return { ...(env ? { env } : {}), copyOnly: argv.includes('--copy-only') };
}

export type MovePlan = { target?: Target; ref?: string; supabaseUrl: string; sourceBucket: string; r2: R2Env };

/**
 * The plan of --env: the source from the fixed project, the target from secrets/<env>.env only (never a shell value, never
 * another endpoint). The full move refuses after the switch, by the file or by the shell. No network call.
 */
export function envPlan(args: { env: Target; copyOnly: boolean }, secretsText: string, shell: Record<string, string | undefined>): Required<MovePlan> {
  const copy = copyEnv(args.env, secretsText);
  if (!args.copyOnly) {
    assertBeforeSwitch({ MADAR_FILE_STORE: copy.fileStore });
    assertBeforeSwitch(shell);
  }
  return { target: copy.target, ref: copy.ref, supabaseUrl: copy.supabaseUrl, sourceBucket: copy.filesBucket, r2: copy.r2 };
}

function needIn(values: Record<string, string | undefined>, name: string): string {
  const value = values[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/** The plan of the old form: every value from the shell. */
export function shellPlan(args: { copyOnly: boolean }, shell: Record<string, string | undefined>): MovePlan & { secretKey: string } {
  if (!args.copyOnly) assertBeforeSwitch(shell);
  return {
    supabaseUrl: needIn(shell, 'SUPABASE_URL'), secretKey: needIn(shell, 'MADAR_SECRET_KEY'), sourceBucket: shell.FILES_BUCKET || 'madar-files',
    r2: {
      accountId: needIn(shell, 'R2_ACCOUNT_ID'), accessKeyId: needIn(shell, 'R2_ACCESS_KEY_ID'), secretAccessKey: needIn(shell, 'R2_SECRET_ACCESS_KEY'),
      bucket: needIn(shell, 'R2_BUCKET'), ...(shell.R2_ENDPOINT ? { endpoint: shell.R2_ENDPOINT } : {}),
    },
  };
}

async function main(argv: string[]): Promise<number> {
  const args = parseMoveArgs(argv);
  let plan: MovePlan;
  let secretKey: string;
  if (args.env) {
    const envForm = envPlan({ env: args.env, copyOnly: args.copyOnly }, readSecretsText(args.env), process.env);
    await confirmProduction(args.env, process.env, askLine);
    secretKey = await secretKeyFromApi(envForm.ref, accessToken(process.env, readLocalEnv));
    plan = envForm;
  } else {
    const shellForm = shellPlan(args, process.env);
    secretKey = shellForm.secretKey;
    plan = shellForm;
  }
  const mode = args.copyOnly ? 'copy-only' : 'move';
  console.error(`${mode}: Storage bucket ${plan.sourceBucket}${plan.ref ? ` of ${plan.ref}` : ''} to the R2 bucket ${plan.r2.bucket}.`);
  const source = storageSource({ supabaseUrl: plan.supabaseUrl, secretKey, bucket: plan.sourceBucket });
  const target = r2Target(plan.r2);
  const report = args.copyOnly ? await copyMissing(source, target) : await moveToR2(source, target);
  console.log(JSON.stringify({ ...(plan.target ? { env: plan.target } : {}), bucket: plan.r2.bucket, mode, ...report }, null, 2));
  return report.mismatched.length > 0 ? 1 : 0;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
