import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Feedback, FeedbackKind } from '../contract/entities';
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

/** A screen inside Madar: a path from the root, never another site or a script link (security review, 2026-10-01). */
export const isAppPath = (page: string): boolean => page.startsWith('/') && !page.startsWith('//') && !page.includes('\\');

/** One report as the Admin reads it: the sender and how many screenshots it carries. */
export const FeedbackRow = z.object({ item: Feedback, sender: UserCard, screenshots: z.number().int().min(0) });

function requireFeedback(ctx: Ctx, id: string): Feedback {
  const item = feedbackOf(ctx.state)[id];
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
    if (!ctx.authority.active) throw invalid('message', 'Only an active person can send a report.');
    const id = nextId(ctx.state, 'fbk');
    const item: Feedback = {
      id, kind: input.kind, message: input.message, page: input.page,
      screenshots: prepared.shots.map((shot) => ({ blobKey: shot.blobKey, type: shot.type })),
      status: 'new', createdBy: ctx.actor.id, createdAt: ctx.stamp, doneBy: null, doneAt: null,
    };
    feedbackOf(ctx.state)[id] = item;
    recordCreate(ctx, { projectId: null, verb: 'feedback.sent', targetType: 'feedback', targetId: id, entity: item });
    // Each active Admin hears of the report in the app, never by email. notify skips the sender and the person of an agent (owner, 2026-10-07).
    notifyIn(ctx, {
      userIds: activeAdmins(ctx.state), trigger: 'feedback_sent', targetType: 'feedback', targetId: id, feedback: { kind: item.kind, excerpt: excerptOf(item.message) },
    });
    return item;
  },
});

/** The Admin reads every report, newest first, open ones before done ones. A status gives only the reports with that status (owner, 2026-10-07). */
const feedbackList = defineCall({
  input: z.object({ status: z.enum(['new', 'done']).optional() }),
  output: z.array(FeedbackRow),
  readOnly: true,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    return Object.values(feedbackOf(ctx.state))
      .filter((item) => input.status === undefined || item.status === input.status)
      .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'new' ? -1 : 1))
      .map((item) => ({ item, sender: cardOf(ctx.state, item.createdBy), screenshots: item.screenshots.length }));
  },
});

/** The prototype reads the picture itself; the real build signs a link in its server prepare hook and answers with wire.output. */
export type ScreenshotPrepared = { blob: Blob | null } | { link: { url: string; expiresAt: string } };

/** One screenshot of a report, for the Admin only. */
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
    assertCan(ctx, 'admin.manage');
    requireFeedback(ctx, input.id);
    if ('link' in prepared) return prepared.link as unknown as { blob: Blob };
    if (!prepared.blob) throw notFound('Screenshot', `${input.id}#${input.index}`);
    return { blob: prepared.blob };
  },
});

/**
 * The Admin marks a report done, or opens it again. Only the move from open to done tells the sender, in the app. Open again
 * sends nothing, and the done notice that the sender has stays (owner, 2026-10-07).
 */
const feedbackSetStatus = defineCall({
  input: z.object({ id: z.string(), status: z.enum(['new', 'done']) }),
  output: Feedback,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const item = requireFeedback(ctx, input.id);
    const wasDone = item.status === 'done';
    const done = input.status === 'done';
    applyPatch(ctx, item, { status: input.status, doneBy: done ? ctx.actor.id : null, doneAt: done ? ctx.stamp : null }, {
      projectId: null, verb: 'feedback.status_changed', targetType: 'feedback', targetId: item.id,
    });
    if (!wasDone && done) {
      // A report that an agent sent goes back to the person of the agent.
      notifyIn(ctx, {
        userIds: [principalOf(ctx.state, item.createdBy)], trigger: 'feedback_done', targetType: 'feedback', targetId: item.id,
        feedback: { kind: item.kind, excerpt: excerptOf(item.message) },
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
