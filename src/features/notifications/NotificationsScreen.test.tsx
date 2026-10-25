import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

type Notice = State['notifications'][string];

const notice = (id: string, trigger: Notice['trigger'], targetType: Notice['targetType'], targetId: string, createdAt: string, actorId: string | null = 'usr_002'): Notice => ({
  id, userId: '', trigger, actorId, targetType, targetId, read: false, createdAt, dedupeKey: null,
});

const withNotices = (userId: string, list: Notice[]) => (state: State) => {
  state.session.currentUserId = userId;
  for (const [id, n] of Object.entries(state.notifications)) if (n.userId === userId) delete state.notifications[id];
  for (const n of list) state.notifications[n.id] = { ...n, userId };
  // A report notice reads as gone when its report is gone, so each one gets its report row (review 2026-10-07).
  for (const n of list.filter((one) => one.targetType === 'feedback')) {
    state.feedback = {
      ...state.feedback,
      [n.targetId]: {
        id: n.targetId, kind: n.feedback?.kind ?? 'bug', message: n.feedback?.excerpt ?? 'A report', page: '/projects', screenshots: [],
        status: n.trigger === 'feedback_done' ? 'done' : 'new', createdBy: 'usr_003', createdAt: n.createdAt, doneBy: null, doneAt: null,
      },
    };
  }
};

const TODAY_8 = '2026-09-30T08:00:00.000+03:00';
const TODAY_7 = '2026-09-30T07:00:00.000+03:00';
const YESTERDAY = '2026-09-29T16:00:00.000+03:00';

const itemWith = (text: RegExp) => screen.getByText(text).closest('li') as HTMLElement;

describe('the notifications screen', () => {
  it('groups notices by day and writes one sentence for each', async () => {
    await renderApp('/notifications', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_902', 'mention', 'update', 'upd_001', TODAY_7),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi gave you “Civil Defense drawings”')).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi mentioned you in Corniche Office Tower')).toBeInTheDocument();
    expect(screen.getByText('“Toilet details” is past due')).toBeInTheDocument();
  });

  it('marks a notice read when it opens, and goes to the task', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_005', [notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8)]));
    await screen.findByText(/gave you/);
    await userEvent.click(within(itemWith(/gave you/)).getByRole('link', { name: /gave you/ }));
    await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(true));
    expect(window.location.hash).toContain('tab=tasks&task=tsk_012');
  });

  it('marks all read', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    // The toast says what happened, so the person knows what Undo puts back (audit 2026-10-03, V-26).
    expect(await screen.findByText('Marked 2 notifications as read.')).toBeInTheDocument();
    expect(Object.values(store.state.notifications).filter((n) => n.userId === 'usr_005').every((n) => n.read)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('offers Undo after Mark all read (audit 2026-10-03, SHL-16)', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('Marked 2 notifications as read.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(false));
    expect(store.state.notifications.ntf_903.read).toBe(false);
    expect(await screen.findByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
  });

  it('puts all notices back with Ctrl+Z after Mark all read (fbk_052)', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('Marked 2 notifications as read.')).toBeInTheDocument();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(false));
    expect(store.state.notifications.ntf_903.read).toBe(false);
  });

  it('counts every notice that Mark all read marked, also past 200, and Undo puts back all of them (audit 2026-10-03, V-26)', async () => {
    const many = Array.from({ length: 205 }, (_, i) => notice(`ntf_${9000 + i}`, 'task_assigned', 'task', 'tsk_012', TODAY_8));
    const { store } = await renderApp('/notifications', withNotices('usr_005', many));
    const unread = () => Object.values(store.state.notifications).filter((n) => n.userId === 'usr_005' && !n.read).length;
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('Marked 205 notifications as read.')).toBeInTheDocument();
    expect(unread()).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(unread()).toBe(205));
  }, 30000);

  it('lets the leader approve from the Inbox while the task waits', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve “Toilet details”' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('done'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve “Toilet details”' })).toBeNull());
  });

  it('keeps the notice unread when the approval fails (audit 2026-10-03, SHL-11)', async () => {
    const { store } = await renderApp(
      '/notifications',
      withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]),
      { failFirst: 'tasks.approve' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Approve “Toilet details”' }));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(store.state.notifications.ntf_904.read).toBe(false);
    expect(store.state.tasks.tsk_010.status).toBe('in_review');
    await userEvent.click(screen.getByRole('button', { name: 'Approve “Toilet details”' }));
    await waitFor(() => expect(store.state.notifications.ntf_904.read).toBe(true));
  });

  it('says "a direct message" for a mention in a direct chat (audit 2026-10-03, SHL-14)', async () => {
    await renderApp('/notifications', (state) => {
      const room = Object.values(state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'))!;
      withNotices('usr_001', [notice('ntf_901', 'mention', 'chat', room.id, TODAY_8, 'usr_002')])(state);
    });
    expect(await screen.findByText('Faisal Al-Harbi mentioned you in a direct message')).toBeInTheDocument();
  });

  it('offers Undo after Approve, and names the task in each Approve button (audit 2026-10-03, BRW-5)', async () => {
    const { store } = await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    const approve = await screen.findByRole('button', { name: 'Approve “Toilet details”' });
    expect(approve).toHaveTextContent(/^Approve$/);
    await userEvent.click(approve);
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('done'));
    expect(await screen.findByText('To-do approved.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('in_review'));
  });

  it('gives the notice its unread mark back when the person undoes Approve (audit 2026-10-03, V-16)', async () => {
    const { store, api } = await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    const before = await api.call('notifications.count', {});
    await userEvent.click(await screen.findByRole('button', { name: 'Approve “Toilet details”' }));
    await waitFor(() => expect(store.state.notifications.ntf_904.read).toBe(true));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('in_review'));
    await waitFor(() => expect(store.state.notifications.ntf_904.read).toBe(false));
    expect((await api.call('notifications.count', {})).badge).toBe(before.badge);
  });

  it('says when there is nothing', async () => {
    await renderApp('/notifications', withNotices('usr_005', []));
    expect(await screen.findByText('No notifications')).toBeInTheDocument();
  });

  it('keeps the sentence of a notice whose task was deleted, and says the task is gone', async () => {
    const { api } = await renderApp('/notifications', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    await screen.findByText(/sent “Toilet details” to review/);
    await api.call('tasks.delete', { id: 'tsk_010' });
    expect(await screen.findByText('This item does not exist anymore.')).toBeInTheDocument();
    const item = itemWith(/sent “Toilet details” to review/);
    expect(within(item).queryByRole('link')).toBeNull();
    expect(within(item).queryByRole('button', { name: 'Approve “Toilet details”' })).toBeNull();
  });

  it('marks a notice of a deleted item read once the list shows it (audit 2026-10-03, SHL-12)', async () => {
    const { store } = await renderApp('/notifications', (state) => {
      withNotices('usr_005', [notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8), notice('ntf_902', 'overdue', 'task', 'tsk_010', TODAY_7, null)])(state);
      delete state.tasks.tsk_012;
    });
    expect(await screen.findByText('This item does not exist anymore.')).toBeInTheDocument();
    await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(true));
    // A notice whose item is still here keeps its dot until the person opens it.
    expect(store.state.notifications.ntf_902.read).toBe(false);
  });

  describe('the notices of requests and bugs (owner, 2026-10-07)', () => {
    const EXCERPT = 'The board does not scroll on my phone.';
    // The sentence isolates the excerpt with FSI and PDI (review, 2026-10-07, S1).
    const QUOTED = `\u2068${EXCERPT}\u2069`;
    const report = (id: string, trigger: 'feedback_sent' | 'feedback_done', kind: 'bug' | 'feature', actorId: string): Notice => ({
      ...notice(id, trigger, 'feedback', 'fbk_001', TODAY_8, actorId), feedback: { kind, excerpt: EXCERPT },
    });

    it('shows the Admin a new bug report as a link to the reports, and a press marks it read', async () => {
      const { store } = await renderApp('/notifications', withNotices('usr_001', [report('ntf_901', 'feedback_sent', 'bug', 'usr_003')]));
      const sentence = `Reem Al-Ghamdi reported a bug: “${QUOTED}”`;
      expect(await screen.findByText(sentence)).toBeInTheDocument();
      const item = itemWith(/reported a bug/);
      const link = within(item).getByRole('link', { name: /reported a bug/ });
      expect(link).toHaveAttribute('href', '#/admin/feedback');
      expect(within(item).getByRole('img', { name: 'Reem Al-Ghamdi' })).toBeInTheDocument();
      await userEvent.click(link);
      await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(true));
      expect(window.location.hash).toBe('#/admin/feedback');
    });

    it('shows the sender a done request with no link and no Approve; its button only marks it read', async () => {
      const { store } = await renderApp('/notifications', withNotices('usr_003', [report('ntf_902', 'feedback_done', 'feature', 'usr_001')]));
      expect(await screen.findByText(`Your request is done: “${QUOTED}”`)).toBeInTheDocument();
      const item = itemWith(/Your request is done/);
      expect(within(item).queryByRole('link')).toBeNull();
      expect(within(item).queryByRole('button', { name: /Approve/ })).toBeNull();
      // The sentence names no person, so the row shows the bell, not the Admin.
      expect(within(item).queryByRole('img', { name: 'Hala Nasser' })).toBeNull();
      const button = within(item).getByRole('button', { name: /Your request is done/ });
      expect(button).toHaveAttribute('type', 'button');
      await userEvent.click(button);
      await waitFor(() => expect(store.state.notifications.ntf_902.read).toBe(true));
      expect(window.location.hash).toBe('#/notifications');
    });

    it('says that a bug is fixed', async () => {
      await renderApp('/notifications', withNotices('usr_003', [report('ntf_902', 'feedback_done', 'bug', 'usr_001')]));
      expect(await screen.findByText(`Your bug report is fixed: “${QUOTED}”`)).toBeInTheDocument();
    });

    it('uses the female Arabic verb for a woman who sends a request', async () => {
      await renderApp('/notifications', (state) => {
        state.users.usr_001.preferences.language = 'ar';
        withNotices('usr_001', [report('ntf_903', 'feedback_sent', 'feature', 'usr_003')])(state);
      });
      expect(await screen.findByText(`ريم الغامدي أرسلت طلب ميزة: «${QUOTED}»`)).toBeInTheDocument();
    });

    it('isolates an English excerpt in the Arabic sentence, so its "…" stays at its own end (review, 2026-10-07, S1)', async () => {
      const long = 'The board does not scroll on my phone when I open the tasks tab, and the…';
      await renderApp('/notifications', (state) => {
        state.users.usr_003.preferences.language = 'ar';
        withNotices('usr_003', [{ ...report('ntf_905', 'feedback_done', 'bug', 'usr_001'), feedback: { kind: 'bug', excerpt: long } }])(state);
      });
      expect(await screen.findByText(`أُصلح الخلل في بلاغك: «\u2068${long}\u2069»`)).toBeInTheDocument();
    });

    it('shows a former Admin the new report as gone, with no link and no words of the report', async () => {
      const { store } = await renderApp('/notifications', withNotices('usr_002', [report('ntf_904', 'feedback_sent', 'bug', 'usr_003')]));
      expect(await screen.findByText('A feature request or a bug report for the Admin')).toBeInTheDocument();
      const item = itemWith(/for the Admin/);
      expect(within(item).getByText('This item does not exist anymore.')).toBeInTheDocument();
      expect(within(item).queryByRole('link')).toBeNull();
      expect(within(item).queryByRole('button')).toBeNull();
      expect(document.body.textContent).not.toContain(EXCERPT);
      expect(document.body.textContent).not.toContain('Reem');
      await waitFor(() => expect(store.state.notifications.ntf_904.read).toBe(true));
    });
  });

  it('shows Retry when the Inbox cannot load', async () => {
    const { api } = await renderApp('/notifications', withNotices('usr_005', [notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8)]), { failFirst: 'notifications.list' });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/gave you/)).toBeInTheDocument();
    void api;
  });
});

// The notices of a meeting (fbk_022, owner 2026-10-19): a new, moved or cancelled meeting, and the reminder. The title sits between the
// isolate marks, and the notice names the day and the time. A meeting that the person no longer sees reads as gone and names nothing.
describe('the notices of a meeting', () => {
  const START = '2026-10-01T10:00:00.000+03:00';
  const meetingNotice = (id: string, trigger: 'meeting_invited' | 'meeting_soon', change: 'new' | 'moved' | 'cancelled' | undefined, actorId: string | null = 'usr_002'): Notice => ({
    ...notice(id, trigger, 'meeting', 'mtg_901', TODAY_8, actorId), ...(change ? { meeting: { change } } : {}),
  });
  /** Sara (usr_005) is an attendee of "Review the facade", planned by Faisal (usr_002) in prj_001. */
  const world = (list: Notice[], more: (state: State) => void = () => undefined) => (state: State) => {
    state.meetings = {
      mtg_901: {
        id: 'mtg_901', kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: START, endsAt: '2026-10-01T11:00:00.000+03:00', where: '', guests: '',
        notes: '', organizerId: 'usr_002', attendeeIds: ['usr_005'], status: 'scheduled', rev: 1, createdBy: 'usr_002', createdAt: TODAY_7,
      },
    };
    withNotices('usr_005', list)(state);
    more(state);
  };
  const plain = (element: HTMLElement) => element.textContent?.replace(/[\u2068\u2069]/g, '').replace(/^Unread: /, '');

  it('writes the sentence of a new, a moved and a cancelled meeting with the day and the time, and the reminder', async () => {
    await renderApp('/notifications', world([
      meetingNotice('ntf_911', 'meeting_invited', 'new'), meetingNotice('ntf_912', 'meeting_invited', 'moved'), meetingNotice('ntf_913', 'meeting_invited', 'cancelled'),
      meetingNotice('ntf_914', 'meeting_soon', undefined, null),
    ]));
    expect(plain(await screen.findByText(/invited you to/))).toBe('Faisal Al-Harbi invited you to Review the facade, Thu 1 Oct at 10:00 AM');
    expect(plain(screen.getByText(/moved .Review/))).toBe('Faisal Al-Harbi moved Review the facade to Thu 1 Oct at 10:00 AM');
    expect(plain(screen.getByText(/cancelled .Review/))).toBe('Faisal Al-Harbi cancelled Review the facade, which was planned for Thu 1 Oct at 10:00 AM');
    expect(plain(screen.getByText(/starts soon/))).toBe('Review the facade starts soon, at 10:00 AM');
  });

  it('puts the title between the isolate marks, so a title in another direction keeps its own end', async () => {
    await renderApp('/notifications', world([meetingNotice('ntf_911', 'meeting_invited', 'new')], (state) => {
      state.meetings!.mtg_901.title = 'Review (facade)?';
    }));
    expect((await screen.findByText(/invited you to/)).textContent).toContain('\u2068Review (facade)?\u2069');
  });

  it('opens the meeting from the row, names the project, and marks the notice read', async () => {
    const { store } = await renderApp('/notifications', world([meetingNotice('ntf_911', 'meeting_invited', 'new')]));
    await screen.findByText(/invited you to/);
    const item = itemWith(/invited you to/);
    expect(within(item).getByText('Corniche Office Tower')).toBeInTheDocument();
    await userEvent.click(within(item).getByRole('link', { name: /invited you to/ }));
    await waitFor(() => expect(store.state.notifications.ntf_911.read).toBe(true));
    expect(window.location.hash).toContain('/meetings?meeting=mtg_901');
  });

  it('reads a meeting that the person no longer sees as gone: no title, no day, no link', async () => {
    await renderApp('/notifications', world([meetingNotice('ntf_911', 'meeting_invited', 'new')], (state) => {
      state.meetings!.mtg_901.projectId = null;
      state.meetings!.mtg_901.attendeeIds = [];
    }));
    expect(await screen.findByText('A meeting that you can no longer see')).toBeInTheDocument();
    const item = itemWith(/no longer see/);
    expect(within(item).getByText('This item does not exist anymore.')).toBeInTheDocument();
    expect(within(item).queryByRole('link')).toBeNull();
    expect(document.body.textContent).not.toContain('Review the facade');
  });

  it('has the Arabic sentences, with the verb of a woman after her name', async () => {
    await renderApp('/notifications', world([meetingNotice('ntf_911', 'meeting_invited', 'new', 'usr_001'), meetingNotice('ntf_912', 'meeting_invited', 'moved'), meetingNotice('ntf_914', 'meeting_soon', undefined, null)], (state) => {
      state.users.usr_005.preferences.language = 'ar';
    }));
    expect(await screen.findByText(/دعتك إلى/)).toBeInTheDocument();
    expect(screen.getByText(/نقل .* إلى/)).toBeInTheDocument();
    expect(screen.getByText(/يبدأ قريبًا/)).toBeInTheDocument();
  });
});

