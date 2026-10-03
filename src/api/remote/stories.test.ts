import { describe, expect, it } from 'vitest';
import { STORY_TTL_MS, StoryMap } from './stories';

describe('story placeholders (client map 2.4)', () => {
  it('sends a server story ID as it is', () => {
    const stories = new StoryMap();
    expect(stories.plan('sty_ABC', {})).toEqual({ story: { id: 'sty_ABC' } });
  });

  it('sends a new placeholder as a ref, then the server ID once it is known', () => {
    const stories = new StoryMap();
    const request = {};
    expect(stories.plan('cor_ui_one', request)).toEqual({ story: { ref: 'cor_ui_one' } });
    stories.settle('cor_ui_one', 'sty_ONE');
    expect(stories.plan('cor_ui_one', {})).toEqual({ story: { id: 'sty_ONE' } });
  });

  it('sends two calls with the same new placeholder in one request as the same ref', () => {
    const stories = new StoryMap();
    const request = {};
    expect(stories.plan('cor_ui_one', request)).toEqual({ story: { ref: 'cor_ui_one' } });
    expect(stories.plan('cor_ui_one', request)).toEqual({ story: { ref: 'cor_ui_one' } });
  });

  it('makes a call in a later request wait until the first request answers', async () => {
    const stories = new StoryMap();
    stories.plan('cor_ui_one', {});
    const second = stories.plan('cor_ui_one', {});
    expect('wait' in second).toBe(true);
    stories.settle('cor_ui_one', 'sty_ONE');
    await (second as { wait: Promise<void> }).wait;
    expect(stories.plan('cor_ui_one', {})).toEqual({ story: { id: 'sty_ONE' } });
  });

  it('lets a waiting call claim the placeholder again when the first call failed with no story', async () => {
    const stories = new StoryMap();
    stories.plan('cor_ui_one', {});
    const second = stories.plan('cor_ui_one', {}) as { wait: Promise<void> };
    stories.settle('cor_ui_one', undefined);
    await second.wait;
    expect(stories.plan('cor_ui_one', {})).toEqual({ story: { ref: 'cor_ui_one' } });
  });

  it('forgets a placeholder after 24 hours', () => {
    let now = 0;
    const stories = new StoryMap({ now: () => now });
    stories.plan('cor_ui_one', {});
    stories.settle('cor_ui_one', 'sty_ONE');
    now = STORY_TTL_MS - 1;
    expect(stories.plan('cor_ui_one', {})).toEqual({ story: { id: 'sty_ONE' } });
    now = STORY_TTL_MS + 1;
    expect(stories.plan('cor_ui_one', {})).toEqual({ story: { ref: 'cor_ui_one' } });
  });

  it('maps a server story ID back to itself, so run() can report it', () => {
    const stories = new StoryMap();
    stories.settle('cor_ui_one', 'sty_ONE');
    expect(stories.serverId('cor_ui_one')).toBe('sty_ONE');
    expect(stories.serverId('sty_TWO')).toBe('sty_TWO');
    expect(stories.serverId('cor_ui_unknown')).toBeUndefined();
  });
});
