/**
 * The object keys of both stores (plan 5.2). A key holds only [a-z0-9/-], so it needs no encoding in a URL path and never
 * climbs out of its folder. Each upload is a folder with "file" and, for a picture, "thumb" beside it:
 *
 *   <project>/<file>/<n>/file     one file version        <project>/<file>/<n>/thumb    its picture
 *   <project>/<intent>/file       one confirmed upload    <project>/<intent>/thumb      its picture
 *   up/<intent>/file              a staging upload        up/<intent>/thumb             its staging picture
 *   feedback/<intent>/file        a feedback screenshot
 *   office/<task>/<intent>/file   a confirmed upload of an office task (owner, 2026-10-06), with office/<task>/<intent>/thumb
 *   chat/<chat>/<intent>/file     a confirmed upload of a direct chat or a group (owner, 2026-10-19), with chat/<chat>/<intent>/thumb
 *   meeting/<meeting>/<intent>/file  a confirmed upload of a meeting with no project (wave 2), with meeting/<meeting>/<intent>/thumb
 *   resources/<intent>/file       a confirmed upload of the Resources page (fbk_078), with resources/<intent>/thumb
 *
 * The server names a confirmed upload by its intent (task F2): the preflight copies the object before the lock, and the file id
 * and the version letter come later, from run() inside the lock. An intent id is unique, so the key is too.
 *
 * Only staging keys sit under "up/", so the job can delete every old object there (proof.md, Z0a item 6).
 * An id turns into a key part in lower case with "_" as "-" (prj_001 becomes prj-001).
 *
 * Madar enterprises (design 5.11): a record id such as prj_001 repeats in every enterprise, so every key of an enterprise except
 * ENT_VADO starts with e/<ent>/ (ent_002 gives e/ent-002/). ENT_VADO keeps its keys with no prefix, because its files exist under those
 * keys, and no key of ENT_VADO starts with "e/" (no first part of a key is "e"). keysOf(ent) gives the key functions of one enterprise.
 * The module functions below are keysOf(ENT_VADO).
 */

import { ENT_VADO, isEnterpriseId, type EnterpriseId } from '../enterprise/ids';

const KEY = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const STAGING = 'up';
/** The first folder of the keys of every enterprise except ENT_VADO. */
const ENTERPRISE_FOLDER = 'e';

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

/** The folder that starts every key of an enterprise: "" for ENT_VADO, else "e/ent-002/" for ent_002. */
export function enterpriseKeyPrefix(ent: EnterpriseId): string {
  // The strict form only: part() would also turn "ENT_002" into the folder of ent_002.
  if (!isEnterpriseId(ent)) throw new Error('The enterprise id is not valid.');
  return ent === ENT_VADO ? '' : `${ENTERPRISE_FOLDER}/${part(ent)}/`;
}

/** True when the key may belong to the enterprise: its prefix, or for ENT_VADO no prefix of another enterprise. */
export function keyBelongsTo(ent: EnterpriseId, key: string): boolean {
  if (!KEY.test(key)) return false;
  if (ent === ENT_VADO) return !key.startsWith(`${ENTERPRISE_FOLDER}/`);
  const prefix = enterpriseKeyPrefix(ent);
  return key.startsWith(prefix) && key.length > prefix.length;
}

function makeKeys(ent: EnterpriseId) {
  const root = enterpriseKeyPrefix(ent);
  /**
   * The folder of the uploads of one office task. An office task has no project, so its files sit under "office", which is never
   * the key part of a project id (prj-...). The task part keeps the files of two tasks apart.
   */
  const officeUploadPrefix = (taskId: string): string => `${root}office/${part(taskId)}/`;
  /**
   * The folder of the uploads of one direct chat or group. A chat file belongs to no project and no task, so its files sit under "chat",
   * which is never the key part of a project id (prj-...) and never "office". The chat part keeps the files of two chats apart.
   */
  const chatUploadPrefix = (conversationId: string): string => `${root}chat/${part(conversationId)}/`;
  /**
   * The folder of the uploads of one meeting with no project (fbk_022, wave 2). Such a file belongs to no project, no task and no chat, so
   * its files sit under "meeting", which is never the key part of a project id (prj-...), "office" or "chat". The meeting part keeps the
   * files of two meetings apart.
   */
  const meetingUploadPrefix = (meetingId: string): string => `${root}meeting/${part(meetingId)}/`;
  /**
   * The folder of the uploads of the Resources page (fbk_078). A resource file belongs to no project, task, chat or meeting, so its files sit
   * under "resources", which is never the key part of a project id (prj-...), "office", "chat" or "meeting". Resources is one place, so it
   * has no id part.
   */
  const resourcesUploadPrefix = `${root}resources/`;
  const stagingPrefix = `${root}${STAGING}/`;
  return {
    ent,
    prefix: root,
    objectKey: (projectId: string, fileId: string, n: number): string => `${root}${part(projectId)}/${part(fileId)}/${version(n)}/file`,
    thumbKey: (projectId: string, fileId: string, n: number): string => `${root}${part(projectId)}/${part(fileId)}/${version(n)}/thumb`,
    uploadKey: (projectId: string, intentId: string): string => `${root}${part(projectId)}/${part(intentId)}/file`,
    uploadThumbKey: (projectId: string, intentId: string): string => `${root}${part(projectId)}/${part(intentId)}/thumb`,
    stagingKey: (intentId: string): string => `${stagingPrefix}${part(intentId)}/file`,
    stagingThumbKey: (intentId: string): string => `${stagingPrefix}${part(intentId)}/thumb`,
    officeUploadPrefix,
    officeUploadKey: (taskId: string, intentId: string): string => `${officeUploadPrefix(taskId)}${part(intentId)}/file`,
    officeUploadThumbKey: (taskId: string, intentId: string): string => `${officeUploadPrefix(taskId)}${part(intentId)}/thumb`,
    chatUploadPrefix,
    chatUploadKey: (conversationId: string, intentId: string): string => `${chatUploadPrefix(conversationId)}${part(intentId)}/file`,
    chatUploadThumbKey: (conversationId: string, intentId: string): string => `${chatUploadPrefix(conversationId)}${part(intentId)}/thumb`,
    meetingUploadPrefix,
    meetingUploadKey: (meetingId: string, intentId: string): string => `${meetingUploadPrefix(meetingId)}${part(intentId)}/file`,
    meetingUploadThumbKey: (meetingId: string, intentId: string): string => `${meetingUploadPrefix(meetingId)}${part(intentId)}/thumb`,
    resourcesUploadPrefix,
    resourcesUploadKey: (intentId: string): string => `${resourcesUploadPrefix}${part(intentId)}/file`,
    resourcesUploadThumbKey: (intentId: string): string => `${resourcesUploadPrefix}${part(intentId)}/thumb`,
    /** The folder of the feedback screenshots; a screenshot key starts with it. */
    screenshotPrefix: `${root}feedback/`,
    screenshotKey: (intentId: string): string => `${root}feedback/${part(intentId)}/file`,
    isStagingKey: (key: string): boolean => KEY.test(key) && key.startsWith(stagingPrefix),
  };
}

/** The key functions of one enterprise. Each key starts with enterpriseKeyPrefix(ent). */
export type KeyBook = ReturnType<typeof makeKeys>;

export function keysOf(ent: EnterpriseId): KeyBook {
  return makeKeys(ent);
}

// The functions of ENT_VADO, under the names that the code and the tests used before Madar enterprises.
const VADO = keysOf(ENT_VADO);
export const objectKey = VADO.objectKey;
export const thumbKey = VADO.thumbKey;
export const uploadKey = VADO.uploadKey;
export const uploadThumbKey = VADO.uploadThumbKey;
export const stagingKey = VADO.stagingKey;
export const stagingThumbKey = VADO.stagingThumbKey;
export const officeUploadPrefix = VADO.officeUploadPrefix;
export const officeUploadKey = VADO.officeUploadKey;
export const officeUploadThumbKey = VADO.officeUploadThumbKey;
export const chatUploadPrefix = VADO.chatUploadPrefix;
export const chatUploadKey = VADO.chatUploadKey;
export const chatUploadThumbKey = VADO.chatUploadThumbKey;
export const meetingUploadPrefix = VADO.meetingUploadPrefix;
export const meetingUploadKey = VADO.meetingUploadKey;
export const meetingUploadThumbKey = VADO.meetingUploadThumbKey;
export const RESOURCES_UPLOAD_PREFIX = VADO.resourcesUploadPrefix;
export const resourcesUploadKey = VADO.resourcesUploadKey;
export const resourcesUploadThumbKey = VADO.resourcesUploadThumbKey;
export const screenshotKey = VADO.screenshotKey;
export const isStagingKey = VADO.isStagingKey;
