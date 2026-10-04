import { defineCall } from '../registry';
import { MAX_FILE_BYTES, type FileVersion, type User } from '../contract/entities';
import { FREE_PLAN_LIMITS, UPLOAD_LIFE_MS, serverContracts as c, type SignedPut } from '../contract/server';
import { ApiError, forbidden, invalid, notFound } from '../errors';
import { applyPatch } from '../events';
import { can, projectRoleOf } from '../permissions';
import { nowStamp } from '../../lib/dates';
import { assertCan, requireProject, requireStage, roleIn } from './shared';

/**
 * Fake versions of the 9 server calls (plan 4.11), so the prototype screens can use the same calls as the real build.
 * The prototype keeps files in this browser: files.upload and feedback.send take the blob itself, so the upload links here go nowhere.
 */

const later = (now: Date, ms: number) => nowStamp(new Date(now.getTime() + ms));

function fakePut(uploadId: string, mimeType: string, now: Date): SignedPut {
  return { url: `madar-prototype://upload/${uploadId}`, headers: { 'Content-Type': mimeType }, expiresAt: later(now, UPLOAD_LIFE_MS) };
}

const uploadId = () => `upl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** One blob: URL for each stored key and type, kept for the life of the page, so a list of pictures never makes a URL for each draw. */
const blobUrls = new Map<string, string>();

/**
 * The only types that a link may show inline, as in the real stores (server/files/links.ts, INLINE_SAFE; a server test checks that
 * both rules agree). src/api never imports server code, so the list lives here too.
 */
const INLINE_SAFE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf', 'text/plain',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm',
]);

/**
 * The type of the data in a link. A blob: URL runs on the app's own origin, so only the short safe list shows inline; a page, a
 * drawing, every XML type, every other type and every download stay plain data (plan 5.2). A value with a comma stays whole, so it
 * is never one clean type.
 */
export function linkType(mimeType: string, disposition: 'inline' | 'attachment'): string {
  const lower = mimeType.trim().toLowerCase();
  const type = lower.includes(',') ? lower : lower.split(';')[0].trim();
  return disposition === 'inline' && INLINE_SAFE.has(type) ? type : 'application/octet-stream';
}

const storyStart = defineCall({
  ...c['story.start'],
  // The fake API makes its story ID for each call, so this call's own ID is the new story.
  run: (_input, ctx) => ({ storyId: ctx.correlationId }),
});

const filesUploadStart = defineCall({
  ...c['files.uploadStart'],
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, project.id) });
    if (input.stageId) requireStage(ctx, project.id, input.stageId);
    if (input.taskId && ctx.state.tasks[input.taskId]?.projectId !== project.id) throw invalid('taskId', 'This task is not in the project.');
    if (input.size > MAX_FILE_BYTES) {
      throw new ApiError('invalid_input', 'This file is larger than the limit.', { fields: ['size'], reason: 'file_too_large', limit: MAX_FILE_BYTES });
    }
    const id = uploadId();
    return {
      uploadId: id,
      put: fakePut(id, input.mimeType, ctx.now),
      ...(input.thumb ? { thumbPut: fakePut(`${id}_thumb`, input.thumb.mimeType, ctx.now) } : {}),
    };
  },
});

const filesLink = defineCall({
  ...c['files.link'],
  async prepare(input, p): Promise<{ url: string; version: FileVersion }> {
    const file = p.state.files[input.id];
    if (!file) throw notFound('File', input.id);
    // The same check as the real server (plan 2b.7), before any data is read. Every person views every project (spec 2.3).
    if (!can(p.actor, 'project.view', { projectRole: projectRoleOf(p.state, file.projectId, p.actor.id) })) throw forbidden('You cannot do this.', { action: 'project.view' });
    const version = input.letter ? file.versions.find((v) => v.letter === input.letter) : file.versions[file.versions.length - 1];
    if (!version) throw notFound('Version', input.letter ?? '');
    const key = input.variant === 'thumb' && version.thumbKey ? version.thumbKey : version.blobKey;
    const type = linkType(version.mimeType, input.disposition);
    let url = blobUrls.get(`${key}|${type}`);
    if (!url) {
      const blob = await p.persister.getBlob(key);
      if (!blob) throw notFound('File data', key);
      url = URL.createObjectURL(blob.type === type ? blob : new Blob([blob], { type }));
      blobUrls.set(`${key}|${type}`, url);
    }
    return { url, version };
  },
  run(input, ctx, prepared) {
    const file = ctx.state.files[input.id];
    if (!file) throw notFound('File', input.id);
    assertCan(ctx, 'project.view', { projectRole: roleIn(ctx, requireProject(ctx, file.projectId).id) });
    const { version } = prepared;
    return { url: prepared.url, expiresAt: later(ctx.now, UPLOAD_LIFE_MS), name: file.name, mimeType: version.mimeType, size: version.size };
  },
});

const feedbackUploadStart = defineCall({
  ...c['feedback.uploadStart'],
  run(input, ctx) {
    return { uploads: input.screenshots.map((shot) => {
      const id = uploadId();
      return { uploadId: id, put: fakePut(id, shot.mimeType, ctx.now) };
    }) };
  },
});

const usersInvites = defineCall({
  ...c['users.invites'],
  run(_input, ctx) {
    assertCan(ctx, 'people.manage');
    // The prototype has no sign-in, so nobody waits for an invitation.
    return [];
  },
});

const usersResendInvite = defineCall({
  ...c['users.resendInvite'],
  run(input, ctx) {
    assertCan(ctx, 'people.manage');
    const user = ctx.state.users[input.id];
    if (!user) throw notFound('Person', input.id);
    if (user.kind === 'agent') throw invalid('id', 'An agent gets no invitation.');
    return { sentAt: ctx.stamp };
  },
});

const agentRow = (agent: User) => ({
  agentId: agent.id, clientIds: [], name: agent.name, redirectHost: null, approvedAt: null, lastUsedAt: null, active: agent.active,
});

const agentsList = defineCall({
  ...c['agents.list'],
  run(_input, ctx) {
    return Object.values(ctx.state.users)
      .filter((u) => u.kind === 'agent' && u.ownerId === ctx.authority.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(agentRow);
  },
});

const agentsRemove = defineCall({
  ...c['agents.remove'],
  run(input, ctx) {
    const agent = ctx.state.users[input.agentId];
    if (!agent || agent.kind !== 'agent') throw notFound('Agent', input.agentId);
    if (agent.ownerId !== ctx.authority.id) throw forbidden('Only the person an agent acts for can remove it.');
    applyPatch(ctx, agent, { active: false }, { projectId: null, verb: 'user.deactivated', targetType: 'user', targetId: agent.id });
    return { removed: true as const };
  },
});

const usageGet = defineCall({
  ...c['usage.get'],
  run(_input, ctx) {
    assertCan(ctx, 'admin.manage');
    const meter = (limit: number) => ({ used: 0, limit });
    return {
      month: ctx.today.slice(0, 7),
      calls: meter(FREE_PLAN_LIMITS.calls),
      database: meter(FREE_PLAN_LIMITS.databaseBytes),
      files: meter(FREE_PLAN_LIMITS.filesBytes),
      backupCopy: meter(FREE_PLAN_LIMITS.backupCopyBytes),
      emails: meter(FREE_PLAN_LIMITS.emailsPerDay),
      emailsMonth: meter(FREE_PLAN_LIMITS.emailsPerMonth),
      egress: meter(FREE_PLAN_LIMITS.egressBytes),
      failedEffects: [],
      jobsLastRun: null,
    };
  },
});

/** The prototype has no outbox, so no effect fails and none waits for a Retry. */
const usageRetryEffect = defineCall({
  ...c['usage.retryEffect'],
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    throw notFound('Failed effect', input.id);
  },
});

export const serverFakes = {
  'story.start': storyStart,
  'files.uploadStart': filesUploadStart,
  'files.link': filesLink,
  'feedback.uploadStart': feedbackUploadStart,
  'users.invites': usersInvites,
  'users.resendInvite': usersResendInvite,
  'agents.list': agentsList,
  'agents.remove': agentsRemove,
  'usage.get': usageGet,
  'usage.retryEffect': usageRetryEffect,
};
