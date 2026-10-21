import { defineCall } from '../registry';
import { MAX_FILE_BYTES, type FileVersion, type User } from '../contract/entities';
import { UPLOAD_LIFE_MS, serverContracts as c, type SignedPut } from '../contract/server';
import { ApiError, forbidden, invalid, notFound } from '../errors';
import { applyPatch } from '../events';
import { principalOf } from '../permissions';
import { withRights } from '../rights';
import { chatForUpload } from '../chatState';
import { mayOpenFile } from '../views';
import { officeTaskOfCall } from './files';
import { minutesRefusal, requireMeeting } from './meetings';
import { nowStamp } from '../../lib/dates';
import { assertAnyPeopleRight, assertCan, requireProject, requireStage, roleIn, taskRole } from './shared';

/**
 * Fake versions of the 15 server calls (plan 4.11), so the prototype screens can use the same calls as the real build.
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
    if (input.meetingId !== undefined) {
      // A file of a meeting with no project: a person who may write its minutes adds it, after the end (wave 2).
      if (input.projectId !== undefined || input.conversationId !== undefined) throw invalid('meetingId', 'Name the project, the chat or the meeting of the file, only one.', 'file_meeting');
      const meeting = requireMeeting(ctx, input.meetingId);
      if (meeting.projectId !== null) throw invalid('meetingId', 'A meeting with a project uses the files of its project. Name the project.', 'file_meeting');
      const refusal = minutesRefusal(ctx.state, meeting, ctx.authority, ctx.now);
      if (refusal) throw refusal;
      if (input.stageId || input.taskId) throw invalid(input.stageId ? 'stageId' : 'taskId', 'A file of a meeting belongs to no stage and no task. It stays with its meeting.', 'file_meeting');
    } else if (input.conversationId !== undefined) {
      // A file of a direct chat or a group: a member who may send in that chat adds it (owner, 2026-10-19).
      if (input.projectId !== undefined) throw invalid('conversationId', 'Name the project, or the chat of the file, not both.', 'file_chat');
      chatForUpload(ctx.state, input.conversationId, ctx.authority, ctx.actor);
      if (input.stageId || input.taskId) throw invalid(input.stageId ? 'stageId' : 'taskId', 'A file of a chat belongs to no stage and no task. It stays in its chat.', 'file_chat');
    } else if (input.projectId === undefined) {
      // A file of an office task: a person who sees the task adds it (owner, 2026-10-06).
      const task = officeTaskOfCall(ctx, input.taskId);
      assertCan(ctx, 'file.upload', taskRole(ctx, task));
      if (input.stageId) throw invalid('stageId', 'An office task belongs to no project, so it has no stage.', 'office_no_stage');
    } else {
      const project = requireProject(ctx, input.projectId);
      assertCan(ctx, 'file.upload', { projectRole: roleIn(ctx, project.id) });
      if (input.stageId) requireStage(ctx, project.id, input.stageId);
      if (input.taskId && ctx.state.tasks[input.taskId]?.projectId !== project.id) throw invalid('taskId', 'This task is not in the project.');
    }
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
    // The same check as the real server (plan 2b.7), before any data is read. Every person views every project (spec 2.3). A file of
    // an office task shows only to the people of that task (owner, 2026-10-06).
    // The person carries the office rights, so a holder of task.officeAll opens a file of any office to-do (role rights version 2).
    const viewer = withRights(p.state, p.state.users[principalOf(p.state, p.actor.id)] ?? p.actor);
    // A file of an office task that the person does not see reads as missing (review 2026-10-06). So does a file of a chat, and for an
    // agent, which never opens one (owner, 2026-10-19).
    if (!mayOpenFile(p.state, viewer, p.actor, file)) throw file.projectId === null ? notFound('File', input.id) : forbidden('You cannot do this.', { action: 'project.view' });
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
    if (file.projectId === null) {
      if (!mayOpenFile(ctx.state, ctx.authority, ctx.actor, file)) throw notFound('File', input.id);
    } else assertCan(ctx, 'project.view', { projectRole: roleIn(ctx, requireProject(ctx, file.projectId).id) });
    const { version } = prepared;
    return { url: prepared.url, expiresAt: later(ctx.now, UPLOAD_LIFE_MS), name: file.name, mimeType: version.mimeType, size: version.size };
  },
});

const feedbackUploadStart = defineCall({
  ...c['feedback.uploadStart'],
  run(input, ctx) {
    assertCan(ctx, 'feedback.send');
    return { uploads: input.screenshots.map((shot) => {
      const id = uploadId();
      return { uploadId: id, put: fakePut(id, shot.mimeType, ctx.now) };
    }) };
  },
});

const usersInvites = defineCall({
  ...c['users.invites'],
  run(_input, ctx) {
    assertAnyPeopleRight(ctx);
    // The prototype has no sign-in, so nobody waits for an invitation.
    return [];
  },
});

const usersResendInvite = defineCall({
  ...c['users.resendInvite'],
  run(input, ctx) {
    assertCan(ctx, 'people.invite');
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

/** The prototype has no server and no socket: its changes come from the store (src/app/signals.ts). This ticket opens nothing. */
const liveTicket = defineCall({
  ...c['live.ticket'],
  run: (_input, ctx) => ({ ticket: '0'.repeat(64), expiresAt: later(ctx.now, 60_000) }),
});

/**
 * The prototype has no Google (fbk_022): google.status says it is not ready, and the other three refuse with google_not_ready, so the
 * Settings section shows its line for the prototype. An agent gets forbidden, as on the server.
 */
function googleForPerson(ctx: { actor: { kind: string } }): void {
  if (ctx.actor.kind === 'agent') throw forbidden('An agent does not connect Google Calendar.', { action: 'google.connect' });
}
const googleNotReady = () => invalid('google', 'Google Calendar works in the real Madar only.', 'google_not_ready');

const googleStatus = defineCall({
  ...c['google.status'],
  run(_input, ctx) {
    googleForPerson(ctx);
    return { ready: false, state: 'none' as const, connectedAt: null };
  },
});

const googleConnectStart = defineCall({
  ...c['google.connectStart'],
  run(_input, ctx) {
    googleForPerson(ctx);
    throw googleNotReady();
  },
});

const googleConnect = defineCall({
  ...c['google.connect'],
  run(_input, ctx) {
    googleForPerson(ctx);
    throw googleNotReady();
  },
});

const googleDisconnect = defineCall({
  ...c['google.disconnect'],
  run(_input, ctx) {
    googleForPerson(ctx);
    throw googleNotReady();
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
  'live.ticket': liveTicket,
  'google.status': googleStatus,
  'google.connectStart': googleConnectStart,
  'google.connect': googleConnect,
  'google.disconnect': googleDisconnect,
};
