import { ApiError } from '../../src/api/errors';
import type { Query } from './ports';
import type { StoryRef } from './types';

/**
 * Story IDs from the server (plan 4.9; task C3). A story groups the events of one person's action, so Undo can take it back as
 * one. Only the server makes story IDs; a browser sends a server ID, a placeholder (cor_ui_...) or nothing.
 *
 * - No story: the write gets a new story in its own transaction.
 * - { id }: accepted only when the story exists, belongs to the same actor, and is younger than 24 hours. Otherwise forbidden
 *   with the reason story_not_yours (spec 2, 5.5). A made-up ID is never accepted.
 * - { ref }: the first call with that placeholder in a batch mints a story; BatchScope.storyRefs maps it for the rest of the
 *   batch. runCall writes the map only after that call commits, so a call that rolls back leaves no map to a lost story.
 *
 * The story time is the server clock (deps.clock), the same clock that the call runs on.
 */

export const STORY_LIFE_MS = 24 * 60 * 60 * 1000;
export const STORY_INSERT_SQL = 'insert into stories (id, actor_id, created_at) values ($1, $2, $3)';
export const STORY_SELECT_SQL = 'select actor_id, created_at from stories where id = $1';

export type StoryRow = { actorId: string; createdAt: Date };
export interface StoryStore {
  insert(id: string, actorId: string, at: Date): Promise<void>;
  get(id: string): Promise<StoryRow | undefined>;
}

export function sqlStories(q: Query): StoryStore {
  return {
    async insert(id, actorId, at) {
      await q(STORY_INSERT_SQL, [id, actorId, at.toISOString()]);
    },
    async get(id) {
      const [row] = await q<{ actor_id: string; created_at: Date | string }>(STORY_SELECT_SQL, [id]);
      return row ? { actorId: row.actor_id, createdAt: new Date(row.created_at) } : undefined;
    },
  };
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** "sty_" and 22 random base32 characters (110 bits). It fits the 80 characters of correlationId. */
export function newStoryId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  let id = 'sty_';
  for (const byte of bytes) id += BASE32[byte & 31];
  return id;
}

function notYours(): ApiError {
  return new ApiError('forbidden', 'This story does not belong to you, or it is too old. Start a new action.', { reason: 'story_not_yours' });
}

/** The story of one write. "ref" is set when the call minted a story for a placeholder: runCall maps it after the commit. */
export async function resolveStory(
  stories: StoryStore, story: StoryRef | undefined, refs: ReadonlyMap<string, string>, actorId: string, now: Date,
): Promise<{ storyId: string; ref?: string }> {
  if (story && 'id' in story) {
    const row = await stories.get(story.id);
    if (!row || row.actorId !== actorId || now.getTime() - row.createdAt.getTime() >= STORY_LIFE_MS) throw notYours();
    return { storyId: story.id };
  }
  if (story && 'ref' in story) {
    const mapped = refs.get(story.ref);
    if (mapped !== undefined) return { storyId: mapped };
  }
  const storyId = newStoryId();
  await stories.insert(storyId, actorId, now);
  return story && 'ref' in story ? { storyId, ref: story.ref } : { storyId };
}
