import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Feedback, FeedbackKind } from '../contract/entities';
import { UserCard } from '../contract/views';
import { invalid, notFound } from '../errors';
import { applyPatch, recordCreate } from '../events';
import { feedbackOf, nextId } from '../store';
import { cardOf } from '../views';
import { assertCan } from './shared';

const MAX_SHOT_BYTES = 10 * 1024 * 1024;

/** A screen inside Madar: a path from the root, never another site or a script link (security review, 2026-10-01). */
export const isAppPath = (page: string): boolean => page.startsWith('/') && !page.startsWith('//') && !page.includes('\\');

/** One report as the Admin reads it: the sender and how many screenshots it carries. */
export const FeedbackRow = z.object({ item: Feedback, sender: UserCard, screenshots: z.number().int().min(0) });

function requireFeedback(ctx: Ctx, id: string): Feedback {
  const item = feedbackOf(ctx.state)[id];
  if (!item) throw notFound('Report', id);
  return item;
}

/** Anyone in the office sends a feature request or a bug report, with up to three screenshots (owner, 2026-10-01). */
const feedbackSend = defineCall({
  input: z.object({
    kind: FeedbackKind,
    message: z.string().trim().min(1, 'Write what you need or what went wrong.').max(2000),
    page: z.string().max(300).default('').refine((page) => page === '' || isAppPath(page), 'Send the Madar screen you were on.'),
    screenshots: z.array(z.instanceof(Blob)).max(3, 'Add up to three screenshots.').default([]),
  }).refine((value) => value.screenshots.every((shot) => shot.type.startsWith('image/')), { path: ['screenshots'], message: 'A screenshot must be a picture.' })
    .refine((value) => value.screenshots.every((shot) => shot.size <= MAX_SHOT_BYTES), { path: ['screenshots'], message: 'Each screenshot must be 10 MB or smaller.' }),
  output: Feedback,
  async prepare(input, p) {
    const keys: string[] = [];
    for (const shot of input.screenshots) {
      const blobKey = `blob_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      await p.persister.putBlob(blobKey, shot);
      keys.push(blobKey);
    }
    return { keys };
  },
  run(input, ctx, prepared) {
    if (!ctx.authority.active) throw invalid('message', 'Only an active person can send a report.');
    const id = nextId(ctx.state, 'fbk');
    const item: Feedback = {
      id, kind: input.kind, message: input.message, page: input.page,
      screenshots: prepared.keys.map((blobKey, i) => ({ blobKey, type: input.screenshots[i].type })),
      status: 'new', createdBy: ctx.actor.id, createdAt: ctx.stamp, doneBy: null, doneAt: null,
    };
    feedbackOf(ctx.state)[id] = item;
    recordCreate(ctx, { projectId: null, verb: 'feedback.sent', targetType: 'feedback', targetId: id, entity: item });
    return item;
  },
});

/** The Admin reads every report, newest first, open ones before done ones. */
const feedbackList = defineCall({
  input: z.object({}),
  output: z.array(FeedbackRow),
  readOnly: true,
  run(_input, ctx) {
    assertCan(ctx, 'admin.manage');
    return Object.values(feedbackOf(ctx.state))
      .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'new' ? -1 : 1))
      .map((item) => ({ item, sender: cardOf(ctx.state, item.createdBy), screenshots: item.screenshots.length }));
  },
});

/** One screenshot of a report, for the Admin only. */
const feedbackScreenshot = defineCall({
  input: z.object({ id: z.string(), index: z.number().int().min(0).max(2) }),
  output: z.object({ blob: z.instanceof(Blob) }),
  readOnly: true,
  async prepare(input, p) {
    const shot = (p.state.feedback ?? {})[input.id]?.screenshots[input.index];
    return { blob: shot ? await p.persister.getBlob(shot.blobKey) : null };
  },
  run(input, ctx, prepared) {
    assertCan(ctx, 'admin.manage');
    requireFeedback(ctx, input.id);
    if (!prepared.blob) throw notFound('Screenshot', `${input.id}#${input.index}`);
    return { blob: prepared.blob };
  },
});

/** The Admin marks a report done, or opens it again. */
const feedbackSetStatus = defineCall({
  input: z.object({ id: z.string(), status: z.enum(['new', 'done']) }),
  output: Feedback,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const item = requireFeedback(ctx, input.id);
    const done = input.status === 'done';
    applyPatch(ctx, item, { status: input.status, doneBy: done ? ctx.actor.id : null, doneAt: done ? ctx.stamp : null }, {
      projectId: null, verb: 'feedback.status_changed', targetType: 'feedback', targetId: item.id,
    });
    return item;
  },
});

export const feedbackCalls = {
  'feedback.send': feedbackSend,
  'feedback.list': feedbackList,
  'feedback.screenshot': feedbackScreenshot,
  'feedback.setStatus': feedbackSetStatus,
};
