/**
 * The object keys of both stores (plan 5.2). A key holds only [a-z0-9/-], so it needs no encoding in a URL path and never
 * climbs out of its folder. Each upload is a folder with "file" and, for a picture, "thumb" beside it:
 *
 *   <project>/<file>/<n>/file     one file version        <project>/<file>/<n>/thumb    its picture
 *   <project>/<intent>/file       one confirmed upload    <project>/<intent>/thumb      its picture
 *   up/<intent>/file              a staging upload        up/<intent>/thumb             its staging picture
 *   feedback/<intent>/file        a feedback screenshot
 *
 * The server names a confirmed upload by its intent (task F2): the preflight copies the object before the lock, and the file id
 * and the version letter come later, from run() inside the lock. An intent id is unique, so the key is too.
 *
 * Only staging keys sit under "up/", so the job can delete every old object there (proof.md, Z0a item 6).
 * An id turns into a key part in lower case with "_" as "-" (prj_001 becomes prj-001).
 */

const KEY = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const STAGING = 'up';

function part(id: string): string {
  const value = id.toLowerCase().replace(/_/g, '-');
  if (!/^[a-z0-9-]+$/.test(value)) throw new Error(`"${id}" is not a valid id for an object key.`);
  return value;
}

function version(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`The version of an object key must be a whole number from 1, not ${n}.`);
  return String(n);
}

/** True when the value has the key form. A prototype key (blob_...) never has it, so no store holds it. */
export function isObjectKey(key: string): boolean {
  return KEY.test(key);
}

/** Throws unless the key has the key form. Every store checks each key with this before it signs or calls. */
export function assertObjectKey(key: string): void {
  if (!KEY.test(key)) throw new Error(`"${key}" is not a valid object key.`);
}

export function objectKey(projectId: string, fileId: string, n: number): string {
  return `${part(projectId)}/${part(fileId)}/${version(n)}/file`;
}

export function thumbKey(projectId: string, fileId: string, n: number): string {
  return `${part(projectId)}/${part(fileId)}/${version(n)}/thumb`;
}

export function uploadKey(projectId: string, intentId: string): string {
  return `${part(projectId)}/${part(intentId)}/file`;
}

export function uploadThumbKey(projectId: string, intentId: string): string {
  return `${part(projectId)}/${part(intentId)}/thumb`;
}

export function stagingKey(intentId: string): string {
  return `${STAGING}/${part(intentId)}/file`;
}

export function stagingThumbKey(intentId: string): string {
  return `${STAGING}/${part(intentId)}/thumb`;
}

export function screenshotKey(intentId: string): string {
  return `feedback/${part(intentId)}/file`;
}

export function isStagingKey(key: string): boolean {
  return KEY.test(key) && key.startsWith(`${STAGING}/`);
}
