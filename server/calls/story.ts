import { STORY_INSERT_LITE, STORY_INSERT_SQL, newStoryId } from '../core/story';
import { sqlFor } from '../data/dialect';
import type { ServerCall } from '../core/types';

/**
 * story.start: a new server story ID for the actor (plan 4.9; task C3). An agent or a screen that groups several writes into one
 * story asks for one first, then sends it as { id } with each write. One statement of its own: the story row commits at once,
 * so the next request finds it. It changes no record, so it sends no change signal.
 */
export const storyStart: ServerCall<'story.start'> = async (_input, ctx) => {
  const storyId = newStoryId();
  await ctx.deps.db.statement('write', sqlFor(ctx.deps.db, STORY_INSERT_SQL, STORY_INSERT_LITE), [storyId, ctx.principal.userId, ctx.now.toISOString()]);
  return { output: { storyId }, storyId, changed: false };
};
