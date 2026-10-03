import { describe, expect, it } from 'vitest';
import { feedbackCalls } from './feedback';
import { testApi } from '../../test/factories';

const png = (text = 'shot') => new Blob([text], { type: 'image/png' });

describe('feature requests and bug reports (owner, 2026-10-01)', () => {
  it('lets anyone send one with screenshots; only the Admin reads them, opens a screenshot and marks it done', async () => {
    const t = testApi(feedbackCalls);
    t.as('usr_003');
    const sent = await t.api.call('feedback.send', { kind: 'bug', message: 'The board does not scroll on my phone.', page: '/projects/prj_001?tab=tasks', screenshots: [png('a'), png('b')] });
    expect(sent).toMatchObject({ kind: 'bug', status: 'new', createdBy: 'usr_003' });
    await expect(t.api.call('feedback.list', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('feedback.screenshot', { id: sent.id, index: 0 })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    const [row] = await t.api.call('feedback.list', {});
    expect(row).toMatchObject({ item: { id: sent.id, page: '/projects/prj_001?tab=tasks' }, sender: { id: 'usr_003' }, screenshots: 2 });
    const shot = await t.api.call('feedback.screenshot', { id: sent.id, index: 1 });
    expect(await shot.blob.text()).toBe('b');
    const done = await t.api.call('feedback.setStatus', { id: sent.id, status: 'done' });
    expect(done).toMatchObject({ status: 'done', doneBy: 'usr_001' });
  });

  it('accepts only an in-app screen path as the page (security review)', async () => {
    const t = testApi(feedbackCalls);
    t.as('usr_003');
    for (const page of ['javascript:alert(1)', '//evil.example', 'https://evil.example']) {
      await expect(t.api.call('feedback.send', { kind: 'bug', message: 'Broken', page, screenshots: [] })).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect((await t.api.call('feedback.send', { kind: 'bug', message: 'Broken', page: '/projects?status=active', screenshots: [] })).page).toBe('/projects?status=active');
  });

  it('refuses an empty message, a file that is not a picture, and more than three screenshots', async () => {
    const t = testApi(feedbackCalls);
    t.as('usr_003');
    await expect(t.api.call('feedback.send', { kind: 'feature', message: '  ', page: '/', screenshots: [] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('feedback.send', { kind: 'bug', message: 'Broken', page: '/', screenshots: [new Blob(['x'], { type: 'application/pdf' })] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('feedback.send', { kind: 'bug', message: 'Broken', page: '/', screenshots: [png(), png(), png(), png()] })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('takes screenshots or upload IDs, not both; the prototype has no uploads, so it refuses the IDs', async () => {
    const t = testApi(feedbackCalls);
    t.as('usr_003');
    await expect(t.api.call('feedback.send', { kind: 'bug', message: 'Broken', page: '/', screenshots: [png()], uploadIds: ['upl_001'] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('feedback.send', { kind: 'bug', message: 'Broken', page: '/', uploadIds: ['upl_001'] })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['uploadIds'] },
    });
    expect((await t.api.call('feedback.send', { kind: 'bug', message: 'Broken', page: '/', uploadIds: [] })).screenshots).toEqual([]);
  });

  it('sends upload IDs on the wire and gets a link back for a screenshot', () => {
    const send = feedbackCalls['feedback.send'].wire?.input;
    expect(send?.safeParse({ kind: 'bug', message: 'Broken', page: '/', uploadIds: ['upl_001', 'upl_002'] }).success).toBe(true);
    expect(send?.safeParse({ kind: 'bug', message: 'Broken', page: '/', uploadIds: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(send?.safeParse({ kind: 'bug', message: 'Broken', page: '/', screenshots: [png()] }).success).toBe(false);
    const shot = feedbackCalls['feedback.screenshot'].wire?.output;
    expect(shot?.parse({ url: 'https://files.example/x', expiresAt: '2026-10-03T09:10:00.000+03:00' })).toEqual({
      url: 'https://files.example/x', expiresAt: '2026-10-03T09:10:00.000+03:00',
    });
    expect(shot?.safeParse({ blob: png() }).success).toBe(false);
  });
});

