import { describe, expect, it } from 'vitest';
import { feedbackCalls } from './feedback';
import { calls } from '../calls';
import { excerptOf } from '../../lib/text';
import { makeUser, testApi } from '../../test/factories';

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

/**
 * The notices of requests and bugs (owner, 2026-10-07, rules B1 to B19). Hala (usr_001) and Faisal (usr_002) are Admins, Omar
 * (usr_004) is an Admin who left, Sara (usr_003) is a member, and usr_009 is the agent of Hala.
 */
describe('the notices of requests and bugs', () => {
  const MESSAGE = 'The board does not scroll on my phone.';

  function world() {
    const t = testApi(calls);
    const s = t.store.state;
    s.users.usr_002.systemRole = 'admin';
    s.users.usr_004.systemRole = 'admin';
    s.users.usr_004.active = false;
    s.users.usr_009 = makeUser('usr_009', { name: 'Hala Assistant', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
    s.counters.usr = 9;
    return t;
  }
  type T = ReturnType<typeof world>;
  const send = async (t: T, userId: string, input: { kind?: 'bug' | 'feature'; message?: string } = {}, correlationId?: string) => {
    t.as(userId);
    return t.api.call('feedback.send', { kind: input.kind ?? 'bug', message: input.message ?? MESSAGE, page: '/projects', screenshots: [] }, correlationId ? { correlationId } : {});
  };
  const mark = async (t: T, userId: string, id: string, status: 'new' | 'done', correlationId?: string) => {
    t.as(userId);
    return t.api.call('feedback.setStatus', { id, status }, correlationId ? { correlationId } : {});
  };
  const notices = (t: T, trigger: 'feedback_sent' | 'feedback_done') => Object.values(t.store.state.notifications).filter((n) => n.trigger === trigger);

  describe('who gets the notice of a new report (B1 to B3)', () => {
    it('gives each other active Admin one notice with the kind and the excerpt, and nobody else', async () => {
      const t = world();
      const report = await send(t, 'usr_003');
      const made = notices(t, 'feedback_sent');
      expect(made.map((n) => n.userId).sort()).toEqual(['usr_001', 'usr_002']);
      for (const n of made) {
        expect(n).toMatchObject({
          targetType: 'feedback', targetId: report.id, actorId: 'usr_003', dedupeKey: null, read: false, feedback: { kind: 'bug', excerpt: MESSAGE },
        });
        expect(n.correlationId).toBeTruthy();
      }
    });

    it('gives an Admin who sends a report no notice of it', async () => {
      const t = world();
      await send(t, 'usr_001');
      expect(notices(t, 'feedback_sent').map((n) => n.userId)).toEqual(['usr_002']);
    });

    it('sends nothing to an Admin whose switch is off', async () => {
      const t = world();
      t.store.state.users.usr_002.preferences.notifications.feedback_sent = false;
      await send(t, 'usr_003');
      expect(notices(t, 'feedback_sent').map((n) => n.userId)).toEqual(['usr_001']);
    });

    it('keeps a long message to its excerpt in the notice', async () => {
      const t = world();
      const message = 'The board does not scroll on my phone when I open it. '.repeat(4);
      await send(t, 'usr_003', { kind: 'feature', message });
      const [n] = notices(t, 'feedback_sent');
      expect(n.feedback).toEqual({ kind: 'feature', excerpt: excerptOf(message) });
      expect(Array.from(n.feedback!.excerpt).length).toBeLessThanOrEqual(80);
      expect(n.feedback!.excerpt.endsWith('…')).toBe(true);
    });
  });

  describe('who gets the notice of a done report (B4 to B11)', () => {
    it('gives the sender exactly one done notice when an Admin marks the report done', async () => {
      const t = world();
      const report = await send(t, 'usr_003');
      await mark(t, 'usr_001', report.id, 'done');
      const made = notices(t, 'feedback_done');
      expect(made).toHaveLength(1);
      expect(made[0]).toMatchObject({ userId: 'usr_003', actorId: 'usr_001', targetType: 'feedback', targetId: report.id, dedupeKey: null, feedback: { kind: 'bug', excerpt: MESSAGE } });
    });

    it('adds no notice for done on a report that is already done, but still writes the change', async () => {
      const t = world();
      const report = await send(t, 'usr_003');
      await mark(t, 'usr_001', report.id, 'done');
      const events = Object.keys(t.store.state.events).length;
      await mark(t, 'usr_002', report.id, 'done');
      expect(notices(t, 'feedback_done')).toHaveLength(1);
      expect(Object.keys(t.store.state.events)).toHaveLength(events + 1);
    });

    it('adds no notice when the report opens again, and keeps the done notice', async () => {
      const t = world();
      const report = await send(t, 'usr_003');
      await mark(t, 'usr_001', report.id, 'done');
      const [done] = notices(t, 'feedback_done');
      const all = Object.keys(t.store.state.notifications).length;
      await mark(t, 'usr_001', report.id, 'new');
      expect(Object.keys(t.store.state.notifications)).toHaveLength(all);
      expect(t.store.state.notifications[done.id]).toBeDefined();
    });

    it('gives a second done notice when a report opens again and is done again', async () => {
      const t = world();
      const report = await send(t, 'usr_003');
      await mark(t, 'usr_001', report.id, 'done');
      await mark(t, 'usr_001', report.id, 'new');
      await mark(t, 'usr_001', report.id, 'done');
      expect(notices(t, 'feedback_done').map((n) => n.userId)).toEqual(['usr_003', 'usr_003']);
    });

    it('gives no notice when an Admin marks their own report done', async () => {
      const t = world();
      const report = await send(t, 'usr_001');
      await mark(t, 'usr_001', report.id, 'done');
      expect(notices(t, 'feedback_done')).toEqual([]);
    });

    it('gives no notice when the agent of the Admin marks the report of that Admin done', async () => {
      const t = world();
      const report = await send(t, 'usr_001');
      await mark(t, 'usr_009', report.id, 'done');
      expect(notices(t, 'feedback_done')).toEqual([]);
    });

    it('names the agent as the actor when the agent of an Admin marks a report done', async () => {
      const t = world();
      const report = await send(t, 'usr_003');
      await mark(t, 'usr_009', report.id, 'done');
      expect(notices(t, 'feedback_done')).toEqual([expect.objectContaining({ userId: 'usr_003', actorId: 'usr_009' })]);
    });

    it('gives nothing to a sender who left, also after the sender comes back, or whose switch is off', async () => {
      const t = world();
      const report = await send(t, 'usr_003');
      t.store.state.users.usr_003.active = false;
      await mark(t, 'usr_001', report.id, 'done');
      t.store.state.users.usr_003.active = true;
      await mark(t, 'usr_001', report.id, 'done');
      expect(notices(t, 'feedback_done')).toEqual([]);
      const second = await send(t, 'usr_003', { message: 'A second report.' });
      t.store.state.users.usr_003.preferences.notifications.feedback_done = false;
      await mark(t, 'usr_001', second.id, 'done');
      expect(notices(t, 'feedback_done')).toEqual([]);
    });

    it('sends the done notice of a report that an agent sent to the person of the agent', async () => {
      const t = world();
      const report = await send(t, 'usr_009');
      expect(report.createdBy).toBe('usr_009');
      // The agent acts for Hala, so only Faisal hears of the new report.
      expect(notices(t, 'feedback_sent').map((n) => n.userId)).toEqual(['usr_002']);
      await mark(t, 'usr_002', report.id, 'done');
      expect(notices(t, 'feedback_done')).toEqual([expect.objectContaining({ userId: 'usr_001', actorId: 'usr_002' })]);
    });

    it('never gives either notice to an agent', async () => {
      const t = world();
      const report = await send(t, 'usr_005');
      await mark(t, 'usr_001', report.id, 'done');
      const agents = new Set(['usr_005', 'usr_009']);
      expect(Object.values(t.store.state.notifications).filter((n) => agents.has(n.userId))).toEqual([]);
      expect(notices(t, 'feedback_done').map((n) => n.userId)).toEqual(['usr_003']);
    });
  });

  it('filters the list by status and keeps the old order without a filter (B19)', async () => {
    const t = world();
    const first = await send(t, 'usr_003', { message: 'First' });
    const second = await send(t, 'usr_003', { message: 'Second' });
    const third = await send(t, 'usr_003', { message: 'Third' });
    await mark(t, 'usr_001', second.id, 'done');
    t.as('usr_001');
    const open = await t.api.call('feedback.list', { status: 'new' });
    expect(open.map((row) => row.item.id).sort()).toEqual([first.id, third.id].sort());
    expect((await t.api.call('feedback.list', { status: 'done' })).map((row) => row.item.id)).toEqual([second.id]);
    const all = await t.api.call('feedback.list', {});
    expect(all.map((row) => row.item.status)).toEqual(['new', 'new', 'done']);
    expect(all.map((row) => row.item.id)).toEqual([...open.map((row) => row.item.id), second.id]);
  });

  describe('an Undo takes back only the notices of its own change (B15)', () => {
    it('takes back the done notice with the done story, and the report is open again', async () => {
      const t = world();
      const report = await send(t, 'usr_003');
      await mark(t, 'usr_001', report.id, 'done', 'cor_done');
      expect(notices(t, 'feedback_done')).toHaveLength(1);
      await t.api.call('events.undoStory', { correlationId: 'cor_done' });
      expect(notices(t, 'feedback_done')).toEqual([]);
      expect(t.store.state.feedback?.[report.id]?.status).toBe('new');
      // The notices of the send belong to another story, so they stay.
      expect(notices(t, 'feedback_sent').map((n) => n.userId).sort()).toEqual(['usr_001', 'usr_002']);
    });

    it('with two done changes in one story, an Undo of the first takes back only the notice of the first report', async () => {
      const t = world();
      const first = await send(t, 'usr_003', { message: 'First' });
      const second = await send(t, 'usr_003', { message: 'Second' });
      await mark(t, 'usr_001', first.id, 'done', 'cor_two');
      await mark(t, 'usr_001', second.id, 'done', 'cor_two');
      const change = Object.values(t.store.state.events).find((e) => e.correlationId === 'cor_two' && e.targetId === first.id)!;
      await t.api.call('events.undo', { eventId: change.id });
      expect(notices(t, 'feedback_done').map((n) => n.targetId)).toEqual([second.id]);
      expect(t.store.state.feedback?.[first.id]?.status).toBe('new');
      expect(t.store.state.feedback?.[second.id]?.status).toBe('done');
    });

    it('keeps one done notice for each move to done that stands in the story: done, open, done, then an Undo of the last done', async () => {
      const t = world();
      const report = await send(t, 'usr_003');
      await mark(t, 'usr_009', report.id, 'done', 'cor_s');
      const [first] = notices(t, 'feedback_done');
      await mark(t, 'usr_009', report.id, 'new', 'cor_s');
      await mark(t, 'usr_009', report.id, 'done', 'cor_s');
      expect(notices(t, 'feedback_done')).toHaveLength(2);
      const last = Object.values(t.store.state.events).filter((e) => e.correlationId === 'cor_s').sort((a, b) => b.seq - a.seq)[0];
      expect(last.after).toMatchObject({ status: 'done' });
      await t.api.call('events.undo', { eventId: last.id });
      expect(t.store.state.feedback?.[report.id]?.status).toBe('new');
      // The first move to done still stands, so its notice stays. The notice of the move that the Undo took back goes.
      expect(notices(t, 'feedback_done').map((n) => n.id)).toEqual([first.id]);
      await t.api.call('events.undoStory', { correlationId: 'cor_s' });
      expect(t.store.state.feedback?.[report.id]?.status).toBe('new');
      expect(notices(t, 'feedback_done')).toEqual([]);
    });

    it('takes back the notice of the other Admin with the Undo of the send of an Admin', async () => {
      const t = world();
      await send(t, 'usr_001', {}, 'cor_send');
      expect(notices(t, 'feedback_sent').map((n) => n.userId)).toEqual(['usr_002']);
      t.as('usr_001');
      await t.api.call('events.undoStory', { correlationId: 'cor_send' });
      expect(notices(t, 'feedback_sent')).toEqual([]);
    });
  });
});

