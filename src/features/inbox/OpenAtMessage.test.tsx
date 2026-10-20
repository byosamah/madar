import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyReactions } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * A link with a message opens the chat at that message (chat design 2026-10-19, item 17): `/inbox/<id>?at=<msg_ or cmt_>`. A window of
 * an old message ends with a plain "Show newer messages" button. The tower chat of prj_001 gets 600 messages "Line 1" to "Line 600"
 * after its sample messages, one minute apart.
 */
const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!.id;
const idOf = (n: number) => `msg_${1000 + n}`;

/** A stamp in the Riyadh shape of the sample messages, so the order of the texts is the order of the times. */
function stampAfter(state: State, minutes: number): string {
  const newest = Math.max(...Object.values(state.messages).map((m) => Date.parse(m.createdAt)));
  return new Date(newest + minutes * 60_000 + 3 * 3_600_000).toISOString().replace('Z', '+03:00');
}

function lines(count: number) {
  return (state: State) => {
    const room = roomOf(state);
    for (let n = 1; n <= count; n += 1) {
      state.messages[idOf(n)] = {
        id: idOf(n), conversationId: room, authorId: 'usr_002', actingForId: 'usr_002', body: `Line ${n}`, mentions: [], fileIds: [], createdAt: stampAfter(state, n), editedAt: null,
      };
    }
  };
}

/** Sends a message from the composer: a change event and a submit, not key presses over a log of 500 bubbles. */
function send(text: string) {
  const field = screen.getByLabelText('Message');
  fireEvent.change(field, { target: { value: text } });
  fireEvent.submit(field.closest('form')!);
}

/** The messages of the open chat. The chat list holds the newest line as a preview too, so a text query must stay inside the log. */
async function inLog(name = 'Messages') {
  return within(await screen.findByRole('log', { name }, { timeout: 10_000 }));
}

/** Waits for a text in the log that is open now. The log of the old pane goes when a new pane takes its place, so it is asked again each time. */
async function expectInLog(text: string, name = 'Messages') {
  await waitFor(() => expect(within(screen.getByRole('log', { name })).getByText(text)).toBeInTheDocument(), { timeout: 10_000 });
}

describe('the Inbox opens at one message', () => {
  it('opens a chat at a message older than the first page, and offers the newer messages', async () => {
    const { store } = await renderApp(`/inbox/cnv_001?at=${idOf(50)}`, lines(600));
    expect(roomOf(store.state)).toBe('cnv_001');
    const log = await inLog();
    expect(await log.findByText('Line 50')).toBeInTheDocument();
    expect(log.queryByText('Line 600')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show newer messages' }));
    await waitFor(() => expect(window.location.hash).toBe('#/inbox/cnv_001'));
    await expectInLog('Line 600');
    expect(screen.queryByRole('button', { name: 'Show newer messages' })).toBeNull();
  }, 30_000);

  it('shows no Show newer messages button when the page reaches the newest message', async () => {
    await renderApp(`/inbox/cnv_001?at=${idOf(500)}`, lines(600));
    const log = await inLog();
    expect(await log.findByText('Line 501')).toBeInTheDocument();
    expect(log.getByText('Line 600')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show newer messages' })).toBeNull();
  }, 30_000);

  it('goes to the newest messages after a send in a window', async () => {
    const { store } = await renderApp(`/inbox/cnv_001?at=${idOf(50)}`, lines(600));
    await (await inLog()).findByText('Line 50');
    send('Back at the top of the talk');
    await waitFor(() => expect(window.location.hash).toBe('#/inbox/cnv_001'));
    await expectInLog('Line 600');
    expect(Object.values(store.state.messages).some((m) => m.body === 'Back at the top of the talk')).toBe(true);
  }, 30_000);

  it('offers the earlier messages above a window, and loads them', async () => {
    // 8 sample messages and 300 lines: Line 90 is not in the newest page of 200, so the window starts 20 messages before it.
    await renderApp(`/inbox/cnv_001?at=${idOf(90)}`, lines(300));
    const log = await inLog();
    expect(await log.findByText('Line 90')).toBeInTheDocument();
    expect(log.queryByText('Line 60')).toBeNull();
    expect(log.getByText('Line 300')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show newer messages' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Earlier messages' }));
    expect(await log.findByText('Line 60')).toBeInTheDocument();
  }, 30_000);

  it('opens an Inbox task thread with an at mark, with its Open task button', async () => {
    let taskId = '';
    await renderApp('/inbox/tsk_001?at=cmt_990', (state) => {
      taskId = Object.values(state.tasks).find((t) => t.projectId === 'prj_001')!.id;
      state.comments.cmt_990 = {
        id: 'cmt_990', targetType: 'task', targetId: taskId, authorId: 'usr_002', body: 'Check the manhole spacing', reactions: emptyReactions(), fileIds: [],
        createdAt: stampAfter(state, 1), editedAt: null,
      };
    });
    expect(window.location.hash).toContain('?at=cmt_990');
    expect(await screen.findByText('Check the manhole spacing', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open task' })).toBeInTheDocument();
  }, 30_000);

  it('ignores an at mark that is no message id, and opens the chat as before', async () => {
    await renderApp('/inbox/cnv_001?at=%3Cb%3E', lines(10));
    expect(await (await inLog()).findByText('Line 10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show newer messages' })).toBeNull();
  });

  it('offers the newer messages in Arabic', async () => {
    await renderApp(`/inbox/cnv_001?at=${idOf(50)}`, (state) => { lines(600)(state); state.users.usr_001.preferences.language = 'ar'; });
    expect(await screen.findByRole('button', { name: 'اعرض الرسائل الأحدث' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect((await inLog('الرسائل')).getByText('Line 50')).toBeInTheDocument();
  }, 30_000);
});

describe('the frame on the opened message (chat design 2026-10-19, items 10 and 17)', () => {
  it('frames the message of the link once', async () => {
    await renderApp(`/inbox/cnv_001?at=${idOf(50)}`, lines(600));
    const row = (await screen.findByText('Line 50', {}, { timeout: 10_000 })).closest('li')!;
    expect(row).toHaveAttribute('data-framed');
    await waitFor(() => expect(row).not.toHaveAttribute('data-framed'), { timeout: 2000 });
    // The frame does not come back, also when the chat loads its messages again.
    await waitFor(() => expect(document.querySelectorAll('[data-framed]')).toHaveLength(0));
  }, 30_000);

  it('frames the comment of a task thread link', async () => {
    await renderApp('/inbox/tsk_001?at=cmt_990', (state) => {
      const taskId = Object.values(state.tasks).find((t) => t.projectId === 'prj_001')!.id;
      state.comments.cmt_990 = {
        id: 'cmt_990', targetType: 'task', targetId: taskId, authorId: 'usr_002', body: 'Check the manhole spacing', reactions: emptyReactions(), fileIds: [],
        createdAt: stampAfter(state, 1), editedAt: null,
      };
    });
    const row = (await screen.findByText('Check the manhole spacing', {}, { timeout: 10_000 })).closest('li')!;
    expect(row).toHaveAttribute('data-framed');
    await waitFor(() => expect(row).not.toHaveAttribute('data-framed'), { timeout: 2000 });
  }, 30_000);

  it('frames nothing when the chat opens with no message mark', async () => {
    await renderApp('/inbox/cnv_001', lines(10));
    expect(await (await inLog()).findByText('Line 10')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-framed]')).toHaveLength(0);
  });

  it('opens the page of an old message when a reply strip points to it', async () => {
    await renderApp('/inbox/cnv_001', (state) => {
      lines(600)(state);
      // A reply at the end of the chat answers Line 10, which is far older than the newest page of 200 messages.
      state.messages.msg_1700 = {
        id: 'msg_1700', conversationId: roomOf(state), authorId: 'usr_003', actingForId: 'usr_003', body: 'Back to the first lines', mentions: [], fileIds: [],
        replyToId: idOf(10), createdAt: stampAfter(state, 1), editedAt: null,
      };
    });
    const first = await inLog();
    expect(await first.findByText('Back to the first lines')).toBeInTheDocument();
    expect(first.queryByText('Line 11')).toBeNull();
    await userEvent.click(first.getByRole('button', { name: /Line 10$/ }));
    await waitFor(() => expect(window.location.hash).toBe(`#/inbox/cnv_001?at=${idOf(10)}`));
    await expectInLog('Line 11');
    const row = within(screen.getByRole('log', { name: 'Messages' })).getByText('Line 10').closest('li')!;
    expect(row).toHaveAttribute('data-framed');
    expect(screen.getByRole('button', { name: 'Show newer messages' })).toBeInTheDocument();
  }, 30_000);

  it('goes to a message that is already in the log with no new page', async () => {
    await renderApp('/inbox/cnv_001', (state) => {
      lines(30)(state);
      state.messages.msg_1700 = {
        id: 'msg_1700', conversationId: roomOf(state), authorId: 'usr_003', actingForId: 'usr_003', body: 'Back to line 5', mentions: [], fileIds: [],
        replyToId: idOf(5), createdAt: stampAfter(state, 1), editedAt: null,
      };
    });
    const log = await inLog();
    expect(await log.findByText('Back to line 5')).toBeInTheDocument();
    await userEvent.click(log.getByRole('button', { name: /Line 5$/ }));
    await waitFor(() => expect(document.querySelector(`[data-message-id="${idOf(5)}"]`)).toHaveAttribute('data-framed'));
    // The link stays as it was: the old message is in the page already.
    expect(window.location.hash).toBe('#/inbox/cnv_001');
  }, 30_000);
});
