import { describe, expect, it } from 'vitest';
import { feedbackCalls, isAppPath } from './feedback';
import { testApi } from '../../test/factories';

/**
 * A browser drops a tab, a CR and an LF from a link, so "/\t/evil.com" becomes "//evil.com", a link to another site.
 * The page field refuses every control character, DEL and the backslash (review, 2026-10-07, L-F1).
 */
const BAD = ['/\t/evil.com', '/\n/evil.com', '/\r\n/x', '/\u0000x', '/\u001F/evil.com', '/\u007F/evil.com', '/\\evil.com'];
const GOOD = ['/settings', '/projects/prj_001?tab=files', '/'];

describe('the page of a report is a Madar screen (review, 2026-10-07, L-F1)', () => {
  it('isAppPath refuses a control character, DEL and the backslash', () => {
    for (const page of BAD) expect(isAppPath(page), JSON.stringify(page)).toBe(false);
  });

  it('isAppPath accepts a path of the app, with its query', () => {
    for (const page of GOOD) expect(isAppPath(page), page).toBe(true);
  });

  it('feedback.send refuses such a page with invalid_input', async () => {
    const t = testApi(feedbackCalls);
    t.as('usr_003');
    for (const page of BAD) {
      await expect(t.api.call('feedback.send', { kind: 'bug', message: 'Broken', page, screenshots: [] }), JSON.stringify(page)).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect((await t.api.call('feedback.send', { kind: 'bug', message: 'Broken', page: '/settings', screenshots: [] })).page).toBe('/settings');
  });

  it('the wire input of feedback.send refuses such a page too', () => {
    const send = feedbackCalls['feedback.send'].wire?.input;
    expect(send).toBeDefined();
    for (const page of BAD) expect(send?.safeParse({ kind: 'bug', message: 'Broken', page, uploadIds: [] }).success, JSON.stringify(page)).toBe(false);
    expect(send?.safeParse({ kind: 'bug', message: 'Broken', page: '/projects/prj_001?tab=files', uploadIds: [] }).success).toBe(true);
  });
});
