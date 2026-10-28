import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Feedback, FeedbackKind, FeedbackStatus, RejectReason } from '../contract/entities';
import { UserCard } from '../contract/views';
import { invalid, notFound } from '../errors';
import { applyPatch, recordCreate } from '../events';
import { MAX_SHOT_BYTES } from '../contract/server';
import { activeAdmins, notifyIn } from '../notify';
import { principalOf } from '../permissions';
import { feedbackOf, nextId } from '../store';
import { cardOf } from '../views';
import { excerptOf } from '../../lib/text';
import { assertCan } from './shared';

/**
 * A screen inside Madar: a path from the root, never another site or a script link (security review, 2026-10-01). A browser
 * drops a tab, a CR and an LF from a link, so "/\t/evil.com" opens evil.com: the path holds no control character, no DEL and
 * no backslash (review, 2026-10-07).
 */
export const isAppPath = (page: string): boolean => page.startsWith('/') && !page.startsWith('//') && !/[\\\u0000-\u001F\u007F]/.test(page);

/** One report as the Admin reads it: the sender and how many screenshots it carries. */
export const FeedbackRow = z.object({ item: Feedback, sender: UserCard, screenshots: z.number().int().min(0) });

/**
 * The id is a free string, and the reports are a plain object. Only an own key is a report: "__proto__" or "constructor" names a shared
 * object, and a write to it would change every object of the server (security review F3).
 */
function requireFeedback(ctx: Ctx, id: string): Feedback {
  const reports = feedbackOf(ctx.state);
  const item = Object.hasOwn(reports, id) ? reports[id] : undefined;
  if (!item) throw notFound('Report', id);
  return item;
}

const SendFields = z.object({
  kind: FeedbackKind,
  message: z.string().trim().min(1, 'Write what you need or what went wrong.').max(2000),
  page: z.string().max(300).default('').refine((page) => page === '' || isAppPath(page), 'Send the Madar screen you were on.'),
});
const UploadIds = z.array(z.string().min(1).max(80)).max(3, 'Add up to three screenshots.');

/** The stored screenshots that run() records. The real build makes them from the upload intents in its server prepare hook (plan 5.2). */
export type FeedbackPrepared = { shots: { blobKey: string; type: string }[] };

/** Anyone in the office sends a feature request or a bug report, with up to three screenshots (owner, 2026-10-01). */
const feedbackSend = defineCall({
  // The screens send the pictures (prototype) or upload IDs from feedback.uploadStart (real build), not both.
  input: SendFields.extend({
    screenshots: z.array(z.instanceof(Blob)).max(3, 'Add up to three screenshots.').default([]),
    uploadIds: UploadIds.optional(),
  }).refine((value) => value.uploadIds === undefined || value.screenshots.length === 0, { path: ['uploadIds'], message: 'Send the screenshots or their uploads, not both.' })
    .refine((value) => value.screenshots.every((shot) => shot.type.startsWith('image/')), { path: ['screenshots'], message: 'A screenshot must be a picture.' })
    .refine((value) => value.screenshots.every((shot) => shot.size <= MAX_SHOT_BYTES), { path: ['screenshots'], message: 'Each screenshot must be 10 MB or smaller.' }),
  output: Feedback,
  wire: { input: SendFields.extend({ uploadIds: UploadIds.default([]) }).strict() },
  async prepare(input, p): Promise<FeedbackPrepared> {
    // The prototype keeps the pictures in this browser, so it has no uploads to confirm.
    if (input.uploadIds !== undefined && input.uploadIds.length > 0) throw invalid('uploadIds', 'Send the screenshots themselves.');
    const shots: FeedbackPrepared['shots'] = [];
    for (const shot of input.screenshots) {
      const blobKey = `blob_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      await p.persister.putBlob(blobKey, shot);
      shots.push({ blobKey, type: shot.type });
    }
    return { shots };
  },
  run(input, ctx, prepared) {
    assertCan(ctx, 'feedback.send');
    if (!ctx.authority.active) throw invalid('message', 'Only an active person can send a report.');
    const id = nextId(ctx.state, 'fbk');
    const item: Feedback = {
      id, kind: input.kind, message: input.message, page: input.page,
      screenshots: prepared.shots.map((shot) => ({ blobKey: shot.blobKey, type: shot.type })),
      status: 'new', createdBy: ctx.actor.id, createdAt: ctx.stamp, doneBy: null, doneAt: null,
    };
    feedbackOf(ctx.state)[id] = item;
    recordCreate(ctx, { projectId: null, verb: 'feedback.sent', targetType: 'feedback', targetId: id, entity: item });
    // Each active person with the right to manage reports hears of the report in the app, never by email. notify skips the sender and the person of an agent (owner, 2026-10-07).
    notifyIn(ctx, {
      userIds: activeAdmins(ctx.state), trigger: 'feedback_sent', targetType: 'feedback', targetId: id, feedback: { kind: item.kind, excerpt: excerptOf(item.message) },
    });
    return item;
  },
});

/** The filter of feedback.list: one status, or "open" for new, in_review and in_progress (fbk_067). "new" still means only new. */
const ListStatus = z.enum([...FeedbackStatus.options, 'open']);
const OPEN_STATUSES: readonly FeedbackStatus[] = ['new', 'in_review', 'in_progress'];
/** The open reports come first, then the done ones, then the rejected ones (owner, 2026-10-07; fbk_067). */
const GROUP: Record<FeedbackStatus, number> = { new: 0, in_review: 0, in_progress: 0, done: 1, rejected: 2 };

/**
 * A person with the right to manage reports (the Admin, or a role with feedback.manage) reads every report, the open ones first, then the done ones,
 * then the rejected ones, newest first in each group. A status gives only the reports with that status, and "open" gives new, in_review and in_progress
 * (owner, 2026-10-07; fbk_067).
 */
const feedbackList = defineCall({
  input: z.object({ status: ListStatus.optional() }),
  output: z.array(FeedbackRow),
  readOnly: true,
  run(input, ctx) {
    assertCan(ctx, 'feedback.manage');
    const wanted = (item: Feedback) => input.status === undefined || (input.status === 'open' ? OPEN_STATUSES.includes(item.status) : item.status === input.status);
    return Object.values(feedbackOf(ctx.state))
      .filter(wanted)
      .sort((a, b) => GROUP[a.status] - GROUP[b.status] || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id, 'en', { numeric: true }))
      .map((item) => ({ item, sender: cardOf(ctx.state, item.createdBy), screenshots: item.screenshots.length }));
  },
});

/** The prototype reads the picture itself; the real build signs a link in its server prepare hook and answers with wire.output. */
export type ScreenshotPrepared = { blob: Blob | null } | { link: { url: string; expiresAt: string } };

/** One screenshot of a report, for a person with the right to manage reports only. */
const feedbackScreenshot = defineCall({
  input: z.object({ id: z.string(), index: z.number().int().min(0).max(2) }),
  output: z.object({ blob: z.instanceof(Blob) }),
  wire: { output: z.object({ url: z.string().min(1), expiresAt: z.string().min(1) }) },
  readOnly: true,
  async prepare(input, p): Promise<ScreenshotPrepared> {
    const shot = (p.state.feedback ?? {})[input.id]?.screenshots[input.index];
    return { blob: shot ? await p.persister.getBlob(shot.blobKey) : null };
  },
  run(input, ctx, prepared) {
    assertCan(ctx, 'feedback.manage');
    requireFeedback(ctx, input.id);
    if ('link' in prepared) return prepared.link as unknown as { blob: Blob };
    if (!prepared.blob) throw notFound('Screenshot', `${input.id}#${input.index}`);
    return { blob: prepared.blob };
  },
});

/**
 * A person with the right to manage reports sets the status of a report: new, in_review, in_progress, rejected or done (fbk_067). Rejected needs a
 * reason, and only rejected takes one. The sender hears in the app of two moves only: into done, and into rejected (with the reason, in the same
 * notice channel and under the same switch). In review, in progress and "Open again" send nothing, and a notice that the sender already has stays
 * (owner, 2026-10-07). A report that an agent sent goes back to the person of the agent.
 */
const feedbackSetStatus = defineCall({
  input: z.object({ id: z.string(), status: FeedbackStatus, reason: RejectReason.optional() })
    .refine((value) => value.status !== 'rejected' || value.reason !== undefined, { path: ['reason'], message: 'Write why you reject it.' })
    .refine((value) => value.status === 'rejected' || value.reason === undefined, { path: ['reason'], message: 'A reason goes only with the status rejected.' }),
  output: Feedback,
  run(input, ctx) {
    assertCan(ctx, 'feedback.manage');
    const item = requireFeedback(ctx, input.id);
    const was = item.status;
    const done = input.status === 'done';
    const rejected = input.status === 'rejected';
    const reason = input.status === 'rejected' ? input.reason ?? null : null;
    // A report from before fbk_067 has no reason field. A JSON event cannot hold a missing key, so the field gets its null first, and an Undo
    // restores the null, not nothing.
    if (item.rejectReason === undefined) item.rejectReason = null;
    applyPatch(ctx, item, { status: input.status, doneBy: done ? ctx.actor.id : null, doneAt: done ? ctx.stamp : null, rejectReason: reason }, {
      projectId: null, verb: 'feedback.status_changed', targetType: 'feedback', targetId: item.id,
    });
    if ((done && was !== 'done') || (rejected && was !== 'rejected')) {
      // The excerpt names the report. The reason sits only in the notice of the sender.
      notifyIn(ctx, {
        userIds: [principalOf(ctx.state, item.createdBy)], trigger: 'feedback_done', targetType: 'feedback', targetId: item.id,
        feedback: { kind: item.kind, excerpt: excerptOf(item.message), ...(rejected && reason !== null ? { reason } : {}) },
      });
    }
    return item;
  },
});

export const feedbackCalls = {
  'feedback.send': feedbackSend,
  'feedback.list': feedbackList,
  'feedback.screenshot': feedbackScreenshot,
  'feedback.setStatus': feedbackSetStatus,
};
