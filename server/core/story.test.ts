import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { STORY_LIFE_MS, newStoryId, resolveStory, type StoryStore } from './story';

function memoryStories(): StoryStore & { rows: Map<string, { actorId: string; createdAt: Date }> } {
  const rows = new Map<string, { actorId: string; createdAt: Date }>();
  return {
    rows,
    async insert(id, actorId, at) {
      if (rows.has(id)) throw new Error(`duplicate story ${id}`);
      rows.set(id, { actorId, createdAt: at });
    },
    async get(id) {
      return rows.get(id);
    },
  };
}

const NOW = new Date('2026-10-04T06:00:00Z');

async function refusal(work: () => Promise<unknown>): Promise<ApiError> {
  const error = await work().then(() => null, (e: unknown) => e);
  if (!(error instanceof ApiError)) throw new Error(`Expected an ApiError, got ${String(error)}`);
  return error;
}

describe('story IDs from the server (plan 4.9)', () => {
  it('makes "sty_" and 22 random base32 characters, which fit the 80 characters of correlationId', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newStoryId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^sty_[a-z2-7]{22}$/);
  });

  it('mints and records a new story for a write with no story, under the actor and the time of the call', async () => {
    const stories = memoryStories();
    const got = await resolveStory(stories, undefined, new Map(), 'usr_001', NOW);
    expect(got.storyId).toMatch(/^sty_/);
    expect(got.ref).toBeUndefined();
    expect(stories.rows.get(got.storyId)).toEqual({ actorId: 'usr_001', createdAt: NOW });
  });

  it('accepts a story of the same actor that is younger than 24 hours, and records nothing', async () => {
    const stories = memoryStories();
    await stories.insert('sty_aaaaaaaaaaaaaaaaaaaaaa', 'usr_001', new Date(NOW.getTime() - STORY_LIFE_MS + 1000));
    const got = await resolveStory(stories, { id: 'sty_aaaaaaaaaaaaaaaaaaaaaa' }, new Map(), 'usr_001', NOW);
    expect(got).toEqual({ storyId: 'sty_aaaaaaaaaaaaaaaaaaaaaa' });
    expect(stories.rows.size).toBe(1);
  });

  it('refuses a story of another actor, an unknown story, and a story of 24 hours or more, with story_not_yours', async () => {
    const stories = memoryStories();
    await stories.insert('sty_other', 'usr_002', NOW);
    await stories.insert('sty_old', 'usr_001', new Date(NOW.getTime() - STORY_LIFE_MS));
    for (const id of ['sty_other', 'sty_missing', 'sty_old', 'cor_made_up_by_a_browser']) {
      const error = await refusal(() => resolveStory(stories, { id }, new Map(), 'usr_001', NOW));
      expect([error.code, error.details.reason], id).toEqual(['forbidden', 'story_not_yours']);
    }
  });

  it('mints one story for a browser placeholder, and gives the mapped story to a later call of the same batch', async () => {
    const stories = memoryStories();
    const refs = new Map<string, string>();
    const first = await resolveStory(stories, { ref: 'cor_ui_1' }, refs, 'usr_001', NOW);
    expect(first.ref).toBe('cor_ui_1');
    // runCall maps the ref only after the call commits, so a rolled-back first call leaves no map entry.
    refs.set('cor_ui_1', first.storyId);
    const second = await resolveStory(stories, { ref: 'cor_ui_1' }, refs, 'usr_001', NOW);
    expect(second).toEqual({ storyId: first.storyId });
    expect(stories.rows.size).toBe(1);
  });
});
