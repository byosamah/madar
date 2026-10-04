import { execFileSync } from 'node:child_process';
import { AwsClient } from 'aws4fetch';
import type { R2Env } from '../files/r2';

/**
 * A MinIO server in Docker that stands in for R2 in the integration tests (plan 7.3; test-map, suite 8). It listens only on
 * 127.0.0.1 and uses fixed local test keys. Docker Hub no longer serves minio/minio, so the default image is Chainguard's
 * build, pinned by digest. MADAR_MINIO_IMAGE names another image.
 * Take the Docker lock first (scripts/dev/docker-lock.sh); stopMinio removes the container.
 */

export const MINIO_IMAGE = process.env.MADAR_MINIO_IMAGE ?? 'cgr.dev/chainguard/minio@sha256:4cf4831a2bbcf13ddca09c1cbcc9faff716dd3c4247e0babc32864b8ee8e0034';
const CONTAINER = 'madar-minio-it';
const PORT = Number(process.env.MADAR_MINIO_PORT ?? 9100);
const ENDPOINT = `http://127.0.0.1:${PORT}`;
/** Local test values only. */
const ACCESS_KEY = 'madar-minio-it';
const SECRET_KEY = 'madar-minio-it-secret';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** The R2 env of the MinIO server, for r2FilesPort. */
export function minioEnv(bucket: string): R2Env & { endpoint: string } {
  return { accountId: 'local', accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY, bucket, endpoint: ENDPOINT };
}

/** A signing client of the MinIO server, for the steps that FilesPort does not have (make a bucket, read an object). */
export function minioClient(): AwsClient {
  return new AwsClient({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY, service: 's3', region: 'auto', retries: 0 });
}

export function minioUrl(bucket: string, key = ''): string {
  return `${ENDPOINT}/${bucket}${key ? `/${key}` : ''}`;
}

/** Starts a fresh MinIO server (a running test container goes first), waits until it answers, and makes the buckets. */
export async function startMinio(buckets: string[]): Promise<void> {
  stopMinio();
  docker([
    'run', '-d', '--rm', '--name', CONTAINER, '-p', `127.0.0.1:${PORT}:9000`,
    '-e', `MINIO_ROOT_USER=${ACCESS_KEY}`, '-e', `MINIO_ROOT_PASSWORD=${SECRET_KEY}`,
    MINIO_IMAGE, 'server', '/tmp/data',
  ]);
  const until = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${ENDPOINT}/minio/health/live`)).ok) break;
    } catch {
      // Not up yet.
    }
    if (Date.now() > until) throw new Error('MinIO did not answer in 60 s.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const client = minioClient();
  for (const bucket of buckets) {
    const response = await client.fetch(minioUrl(bucket), { method: 'PUT' });
    if (!response.ok) throw new Error(`MinIO did not make the bucket ${bucket}: ${response.status}.`);
  }
}

/** Removes the test container. Safe when it is not running. */
export function stopMinio(): void {
  try {
    docker(['rm', '-f', CONTAINER]);
  } catch {
    // Not running.
  }
}
