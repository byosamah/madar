import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGroupConversation } from '../../api/chatState';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

// Render counters for the performance tests (audit 2026-10-07, RND-5). The wrappers call the real parts, so every other test of
// this file sees the same screen. A project chat row renders one ProjectTile, a bubble one RichText, and an Age calls ageOf once.
const renders = vi.hoisted(() => ({ tiles: [] as string[], bodies: [] as string[], ages: [] as string[] }));
vi.mock('../../components/ProjectTile', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/ProjectTile')>();
  return { ...real, ProjectTile: (props: Parameters<typeof real.ProjectTile>[0]) => { renders.tiles.push(props.id); return <real.ProjectTile {...props} />; } };
});
vi.mock('../../components/RichText', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/RichText')>();
  return { ...real, RichText: (props: Parameters<typeof real.RichText>[0]) => { renders.bodies.push(props.body); return <real.RichText {...props} />; } };
});
vi.mock('../../lib/age', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/age')>();
  return { ...real, ageOf: (stamp: string, at: Date) => { renders.ages.push(stamp); return real.ageOf(stamp, at); } };
});
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });

const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });
const PICKED = 'Files to send';

// Hala is the Admin and leads the clinic project. The sample talk leaves two unread messages in the tower chat and one in Faisal's chat.
const withTaskTalk = (state: State) => {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006');
  if (!task) throw new Error('The sample has no task in the clinic project.');
  task.title = 'Room finish schedule';
  for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === task.id) delete state.comments[id];
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
};

describe('the Inbox chat', () => {
  it('lists project chats, direct chats and task threads', async () => {
    await renderApp('/inbox', withTaskTalk);
    expect(await rowLink(/Corniche Office Tower/)).toHaveAttribute('href', expect.stringMatching(/#?\/inbox\/cnv_\d+/));
    expect(await rowLink(/Faisal Al-Harbi/)).toBeInTheDocument();
    expect(await rowLink(/Reem Al-Ghamdi/)).toBeInTheDocument();
    const thread = await rowLink(/Room finish schedule/);
    expect(thread).toHaveAttribute('href', expect.stringMatching(/#?\/inbox\/tsk_\d+/));
    expect(within(thread).getByText(/The finish codes are ready/)).toBeInTheDocument();
  });

  it('filters the list by title', async () => {
    await renderApp('/inbox', withTaskTalk);
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search chats' }), 'faisal');
    const chats = await list();
    expect(chats.getByRole('link', { name: /Faisal Al-Harbi/ })).toBeInTheDocument();
    expect(chats.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull();
  });

  it('shows the unread count of a chat and clears it when the chat opens', async () => {
    const { store } = await renderApp('/inbox');
    const row = await rowLink(/Corniche Office Tower/);
    expect(within(row).getByText('Unread: 2')).toBeInTheDocument();
    await userEvent.click(row);
    const log = await screen.findByRole('log', { name: 'Messages' });
    expect(within(log).getByText(/The sprinkler riser clashes with beam B14/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Chats' })).queryByText('Unread: 2')).toBeNull());
    expect(Object.values(store.state.chatReads).find((r) => r.userId === 'usr_001' && store.state.conversations[r.conversationId].projectId === 'prj_001')?.lastReadAt)
      .toBeDefined();
  });

  it('attaches a file in a project chat (it joins the files of the project), in a direct chat and in a group (it stays in its chat)', async () => {
    const { store } = await renderApp('/inbox', (state) => {
      addGroupConversation(state, 'Tower team', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], '2026-09-30T09:00:00.000+03:00');
    });
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Beam B14.pdf', { type: 'application/pdf' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'The beam sheet.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'Download Beam B14.pdf' })).toBeInTheDocument();
    const file = Object.values(store.state.files).find((f) => f.name === 'Beam B14.pdf');
    expect(file?.projectId).toBe('prj_001');
    expect(file?.conversationId).toBeUndefined();
    // A direct chat takes a file and a picture (owner, 2026-10-19). The file stays in that chat: no project, no task.
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Level 2.pdf', { type: 'application/pdf' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'The level plan.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'Download Level 2.pdf' })).toBeInTheDocument();
    const direct = Object.values(store.state.files).find((f) => f.name === 'Level 2.pdf');
    expect(direct).toMatchObject({ projectId: null, taskId: null, stageId: null });
    expect(store.state.conversations[direct!.conversationId!].kind).toBe('direct');
    // A group takes the same, and a picture shows in its bubble as a preview (owner, 2026-10-19).
    await userEvent.click(await rowLink(/Tower team/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Site photo.jpg', { type: 'image/jpeg' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'View Site photo.jpg' })).toBeInTheDocument();
    const photo = Object.values(store.state.files).find((f) => f.name === 'Site photo.jpg');
    expect(photo).toMatchObject({ projectId: null, taskId: null, stageId: null });
    expect(store.state.conversations[photo!.conversationId!]).toMatchObject({ kind: 'group', name: 'Tower team' });
    expect(Object.values(store.state.messages).find((m) => m.fileIds?.includes(photo!.id))?.body).toBe('Site photo.jpg');
  });

  it('shows a picture of a chat as a preview in its bubble; a press opens the viewer with Close and Download (owner, 2026-10-19)', async () => {
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await userEvent.upload(
      await screen.findByLabelText('Attach files'),
      [new File(['x'], 'Site photo.jpg', { type: 'image/jpeg' }), new File(['y'], 'Brief.pdf', { type: 'application/pdf' })],
    );
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Photo and brief.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const log = within(await screen.findByRole('log', { name: 'Messages' }));
    const preview = await log.findByRole('button', { name: 'View Site photo.jpg' });
    await waitFor(() => expect(preview.querySelector('img')).toHaveAttribute('src', 'blob:madar-test'));
    // The picture is no chip. The PDF stays one.
    expect(log.queryByRole('button', { name: 'Download Site photo.jpg' })).toBeNull();
    expect(log.getByRole('button', { name: 'Download Brief.pdf' })).toBeInTheDocument();
    await userEvent.click(preview);
    const viewer = await screen.findByRole('dialog', { name: 'Site photo.jpg' });
    await userEvent.click(within(viewer).getByRole('button', { name: 'Download Site photo.jpg' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    await userEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Site photo.jpg' })).toBeNull());
    save.mockRestore();
  });

  it('shows a picture of a task thread as a preview, like a chat (owner, 2026-10-19)', async () => {
    await renderApp('/inbox', withTaskTalk);
    await userEvent.click(await rowLink(/Room finish schedule/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Finish board.png', { type: 'image/png' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'The finish board.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const log = within(await screen.findByRole('log', { name: 'Messages' }));
    const preview = await log.findByRole('button', { name: 'View Finish board.png' });
    await userEvent.click(preview);
    expect(await screen.findByRole('dialog', { name: 'Finish board.png' })).toBeInTheDocument();
  });

  it('leaves out the file name that a photo with no words gets as its words, and keeps words that a person wrote', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Only photo.jpg', { type: 'image/jpeg' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const log = within(await screen.findByRole('log', { name: 'Messages' }));
    await log.findByRole('button', { name: 'View Only photo.jpg' });
    expect(log.queryByText('Only photo.jpg')).toBeNull();
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Second photo.jpg', { type: 'image/jpeg' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'The east side.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await log.findByRole('button', { name: 'View Second photo.jpg' });
    expect(log.getByText('The east side.')).toBeInTheDocument();
  });

  it('sends a message with the Send button and with Enter, and keeps a new line for Shift+Enter', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(box).toHaveFocus());
    await userEvent.type(box, 'Please send the new section.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const log = screen.getByRole('log', { name: 'Messages' });
    expect(await within(log).findByText('Please send the new section.')).toBeInTheDocument();
    expect(box).toHaveValue('');
    await userEvent.type(box, 'First line{Shift>}{Enter}{/Shift}Second line');
    expect(box).toHaveValue('First line\nSecond line');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(Object.values(store.state.messages).some((m) => m.body === 'First line\nSecond line')).toBe(true));
    expect(box).toHaveValue('');
  });

  it('opens a task thread, posts a task comment, and links to the task', async () => {
    const { store } = await renderApp('/inbox', withTaskTalk);
    await userEvent.click(await rowLink(/Room finish schedule/));
    expect(await within(await screen.findByRole('log', { name: 'Messages' })).findByText('The finish codes are ready.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open task' })).toHaveAttribute('href', expect.stringMatching(/\/projects\/prj_006\?tab=tasks&task=tsk_\d+/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Thanks, I will check them.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Thanks, I will check them.')).toBe(true));
    expect(await within(screen.getByRole('log', { name: 'Messages' })).findByText('Thanks, I will check them.')).toBeInTheDocument();
  });

  it('starts a direct chat with a person', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    await userEvent.click(await screen.findByRole('button', { name: /Omar Haddad/ }));
    await waitFor(() => expect(window.location.hash).toMatch(/#\/inbox\/cnv_\d+/));
    expect(Object.values(store.state.conversations).some((c) => c.kind === 'direct' && c.memberIds.includes('usr_004'))).toBe(true);
    expect(await screen.findByRole('heading', { level: 2, name: 'Omar Haddad' })).toBeInTheDocument();
  });

  it('shows a message from another person that arrives while the chat is open', async () => {
    const { api, store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    expect(await within(await screen.findByRole('log', { name: 'Messages' })).findByText('I will bring the new stage dates.')).toBeInTheDocument();
    store.state.session.currentUserId = 'usr_002';
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'));
    await api.call('chats.send', { conversationId: room?.id ?? '', body: 'One more thing.' });
    store.state.session.currentUserId = 'usr_001';
    // The short change of person can start the screen again (V-22), so the test asks for the message log again each time.
    await waitFor(() => expect(within(screen.getByRole('log', { name: 'Messages' })).getByText('One more thing.')).toBeInTheDocument());
  });
});

describe('the Inbox chat after the audit of 2026-10-03', () => {
  it('empties the box after a Retry of a failed send, so the next Send does not post it twice (SHL-10)', async () => {
    const { store } = await renderApp('/inbox', undefined, { failFirst: 'chats.send' });
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'Please check beam B14.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(Object.values(store.state.messages).filter((m) => m.body === 'Please check beam B14.')).toHaveLength(1));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('sends a file with no words, with its name as the words, as Share does (SHL-21)', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), new File(['x'], 'Drawing.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.messages).some((m) => m.body === 'Drawing.pdf' && (m.fileIds ?? []).length === 1)).toBe(true));
    expect(await screen.findByRole('button', { name: 'Download Drawing.pdf' })).toBeInTheDocument();
    // With no file and no words, Send stays off.
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('closes a direct chat with an inactive person (SHL-15)', async () => {
    await renderApp('/inbox', (state) => {
      state.users.usr_002.active = false;
    });
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await screen.findByRole('heading', { level: 2, name: 'Faisal Al-Harbi' });
    // The chat uses the same word as Admin for this state (audit 2026-10-03, V-25).
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('This person is inactive. This chat takes no new messages.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('marks a task thread with a new comment as unread, and reads it when it opens (SHL-5)', async () => {
    const { store } = await renderApp('/inbox', withTaskTalk);
    const row = await rowLink(/Room finish schedule/);
    expect(within(row).getByText('Unread: 1')).toBeInTheDocument();
    await userEvent.click(row);
    expect(await within(await screen.findByRole('log', { name: 'Messages' })).findByText('The finish codes are ready.')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Chats' })).getByRole('link', { name: /Room finish schedule/ })).not.toHaveTextContent('Unread'));
    const taskId = Object.values(store.state.tasks).find((t) => t.title === 'Room finish schedule')?.id ?? '';
    expect(Object.values(store.state.chatReads).some((r) => r.conversationId === taskId && r.userId === 'usr_001')).toBe(true);
  });

  it('keeps an English preview whole in an Arabic chat list (BRW-17)', async () => {
    await renderApp('/inbox', (state) => {
      state.users.usr_001.preferences.language = 'ar';
      const room = Object.values(state.conversations).find((c) => c.projectId === 'prj_001')!;
      state.messages.msg_999 = {
        id: 'msg_999', conversationId: room.id, authorId: 'usr_001', actingForId: 'usr_001', body: 'Client moved the site visit.',
        mentions: [], fileIds: [], createdAt: '2026-09-30T08:30:00.000+03:00', editedAt: null,
      };
    });
    const preview = await screen.findByText('Client moved the site visit.');
    expect(preview.tagName).toBe('BDI');
    // The row follows the side of the page (owner, 2026-10-05); only the preview has its own direction.
    expect(preview).toHaveAttribute('dir', 'auto');
    expect(preview.parentElement).not.toHaveAttribute('dir');
  });

  it('keeps an English sender name and its colon together in an Arabic chat list, so it reads "Faisal:", not ":Faisal"', async () => {
    await renderApp('/inbox', (state) => {
      state.users.usr_001.preferences.language = 'ar';
      // A person with an English name only, so the Arabic screen shows the English name (owner item 12).
      state.users.usr_002.nameAr = undefined;
    });
    const sender = await screen.findByText('Faisal:');
    expect(sender.tagName).toBe('BDI');
  });

  it('keeps a half-typed message and its picked file for each chat (SHL-4)', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Half a thought about the riser');
    await userEvent.upload(screen.getByLabelText('Attach files'), new File(['x'], 'Riser.pdf', { type: 'application/pdf' }));
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await screen.findByRole('heading', { level: 2, name: 'Faisal Al-Harbi' });
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await screen.findByRole('heading', { level: 2, name: 'Corniche Office Tower' });
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Half a thought about the riser');
    expect(within(screen.getByRole('list', { name: PICKED })).getByText('Riser.pdf')).toBeInTheDocument();
    // Another tab and back keeps it too.
    await userEvent.click(within(await screen.findByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Projects' }));
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    window.location.hash = '#/inbox';
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Half a thought about the riser');
    // A sent message leaves no draft behind.
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await screen.findByRole('heading', { level: 2, name: 'Faisal Al-Harbi' });
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await screen.findByRole('heading', { level: 2, name: 'Corniche Office Tower' });
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(screen.queryByRole('list', { name: PICKED })).toBeNull();
    // Many steps, so the test gets more time than the default on a busy machine.
  }, 20000);

  // A draft belongs to the person who typed it, not to the browser tab (audit 2026-10-03, V-22).
  const savedDrafts = () => Object.keys(window.sessionStorage).filter((key) => key.startsWith('madar.draft.')).map((key) => window.sessionStorage.getItem(key));

  it('shows the next person no unsent words or files of the person before, after Preview as (V-22)', async () => {
    const { api } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Do not tell Faisal yet');
    await userEvent.upload(screen.getByLabelText('Attach files'), new File(['x'], 'Secret.pdf', { type: 'application/pdf' }));
    await act(async () => { await api.call('session.previewAs', { userId: 'usr_002' }); });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
    expect(screen.queryByRole('list', { name: PICKED })).toBeNull();
    // The words of the person before are gone from this tab too.
    expect(savedDrafts()).not.toContain('Do not tell Faisal yet');
  }, 20000);

  it('keeps the draft of one person out of the box of another in the same tab (V-22)', async () => {
    let room = '';
    await renderApp('/inbox', (state) => {
      room = Object.values(state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_002'))!.id;
    });
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Do not tell Faisal yet');
    cleanup();
    // The same tab, now as Faisal: the app starts again with another current person.
    await renderApp(`/inbox/${room}`, (state) => { state.session.currentUserId = 'usr_002'; });
    await screen.findByRole('heading', { level: 2, name: 'Hala Nasser' });
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
  }, 20000);
});

describe('the bell and the Inbox badge', () => {
  it('opens the notifications from the bell in the pill', async () => {
    await renderApp('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    await userEvent.click(within(nav).getByRole('link', { name: /^Notifications/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/notifications');
    expect(within(nav).getByRole('link', { name: /^Notifications/ })).toHaveAttribute('aria-current', 'page');
  });

  it('counts unread chat messages on the Inbox tab', async () => {
    await renderApp('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    const inbox = within(nav).getByRole('link', { name: /^Inbox/ });
    // Three chat messages, and two task threads with a new comment from someone else (audit 2026-10-03, SHL-5).
    expect(await within(inbox).findByText('Unread messages: 5')).toBeInTheDocument();
  });

  it('counts a new chat message and clears the count once the chat is read', async () => {
    const { api, store } = await renderApp('/dashboard');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    await within(within(nav).getByRole('link', { name: /^Inbox/ })).findByText('Unread messages: 5');
    await api.call('chats.markRead', { conversationId: Object.values(store.state.conversations).find((c) => c.projectId === 'prj_001')?.id ?? '' });
    expect(await within(within(nav).getByRole('link', { name: /^Inbox/ })).findByText('Unread messages: 3')).toBeInTheDocument();
  });
});

describe('the Inbox renders (performance audit 2026-10-07, RND-5)', () => {
  it('renders again only the two rows whose selection changes on a chat switch, and every row age still reads the clock', async () => {
    const { api } = await renderApp('/inbox');
    const rows = await api.call('chats.list', {});
    const [a, b] = rows.filter((row) => row.kind === 'project' && row.project && row.unread === 0);
    if (!a?.project || !b?.project) throw new Error('The sample needs two read project chats.');
    // The project tiles of the other project chats. A task thread names its project too, so leave out the projects of A and B.
    const others = new Set(rows.flatMap((row) => (row.kind === 'project' && row.project && row.project.id !== a.project?.id && row.project.id !== b.project?.id ? [row.project.id] : [])));
    await userEvent.click(await rowLink(new RegExp(a.title)));
    await screen.findByRole('log', { name: 'Messages' });
    await settle();
    const tilesOfOthers = () => renders.tiles.filter((id) => others.has(id)).length;
    const before = tilesOfOthers();
    const agesFrom = renders.ages.length;
    await userEvent.click(await rowLink(new RegExp(b.title)));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: b.title })).toBeInTheDocument());
    await settle();
    expect(others.size).toBeGreaterThan(0);
    expect(tilesOfOthers()).toBe(before);
    const refreshed = new Set(renders.ages.slice(agesFrom));
    for (const row of rows) expect(refreshed.has(row.lastAt)).toBe(true);
  }, 30_000);

  it('renders only the new bubble when a message goes out', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const log = await screen.findByRole('log', { name: 'Messages' });
    expect(within(log).getByText(/The sprinkler riser clashes with beam B14/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Chats' })).queryByText('Unread: 2')).toBeNull());
    await settle();
    const shown = new Set(renders.bodies);
    const old = () => renders.bodies.filter((body) => shown.has(body)).length;
    const before = old();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'Fresh words for the log.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await within(log).findByText('Fresh words for the log.')).toBeInTheDocument();
    await settle();
    expect(old()).toBe(before);
    expect(renders.bodies).toContain('Fresh words for the log.');
  }, 30_000);
});

describe('the Inbox archive (owner, 2026-10-18; UX audit 2026-10-19)', () => {
  const chatsList = () => screen.getByRole('list', { name: 'Chats' });
  // The menu button of a row names its chat. It shows on hover in the browser; the test finds it in the row.
  const menuOfRow = (link: HTMLElement, title: string) => within(link.closest('li') as HTMLElement).getByRole('button', { name: `Options for ${title}` });
  const archiveFromRow = async (link: HTMLElement, title: string) => {
    await userEvent.click(menuOfRow(link, title));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
  };
  const quietRow = () => screen.getByRole('button', { name: 'Archived (1)' });

  it('archives a chat from its row menu, shows a toast with Undo, and the quiet row above the list opens the archived chats', async () => {
    await renderApp('/inbox');
    await archiveFromRow(await rowLink(/Corniche Office Tower/), 'Corniche Office Tower');
    await waitFor(() => expect(within(chatsList()).queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull());
    expect(await screen.findByText('Chat archived.')).toBeInTheDocument();
    // The quiet row sits under the search field, before the list, not at the end of it.
    const search = screen.getByRole('searchbox', { name: 'Search chats' });
    expect(search.compareDocumentPosition(quietRow()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(quietRow().compareDocumentPosition(chatsList()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(quietRow());
    expect(await rowLink(/Corniche Office Tower/)).toBeInTheDocument();
    // The archived view has its own title, a back arrow and its own search words.
    expect(screen.getByRole('heading', { level: 2, name: 'Archived chats' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search archived chats' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }));
    expect(screen.queryByRole('heading', { level: 2, name: 'Archived chats' })).toBeNull();
  });

  it('takes the archive back with the Undo of the toast, and shows no second toast for the Undo', async () => {
    await renderApp('/inbox');
    await archiveFromRow(await rowLink(/Corniche Office Tower/), 'Corniche Office Tower');
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await rowLink(/Corniche Office Tower/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archived \(/ })).toBeNull();
    expect(screen.queryByText('Moved back to Inbox.')).toBeNull();
  });

  it('drops the unread number of the Inbox badge when a chat with unread messages is archived', async () => {
    await renderApp('/inbox');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    await within(within(nav).getByRole('link', { name: /^Inbox/ })).findByText('Unread messages: 5');
    await archiveFromRow(await rowLink(/Corniche Office Tower/), 'Corniche Office Tower');
    expect(await within(within(nav).getByRole('link', { name: /^Inbox/ })).findByText('Unread messages: 3')).toBeInTheDocument();
  });

  it('moves a chat back to the Inbox from the archived list, with a toast', async () => {
    await renderApp('/inbox');
    await archiveFromRow(await rowLink(/Corniche Office Tower/), 'Corniche Office Tower');
    await waitFor(() => expect(within(chatsList()).queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull());
    await userEvent.click(quietRow());
    await userEvent.click(menuOfRow(await rowLink(/Corniche Office Tower/), 'Corniche Office Tower'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move back to Inbox' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Archived \(/ })).toBeNull());
    expect(await rowLink(/Corniche Office Tower/)).toBeInTheDocument();
    expect(await screen.findByText('Moved back to Inbox.')).toBeInTheDocument();
  });

  it('archives the open chat from the header menu and keeps the chat open', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await screen.findByRole('log', { name: 'Messages' });
    const headerMenus = screen.getAllByRole('button', { name: 'Options for Corniche Office Tower' });
    await userEvent.click(headerMenus[headerMenus.length - 1]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(within(chatsList()).queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull());
    expect(screen.getByRole('heading', { level: 2, name: /Corniche Office Tower/ })).toBeInTheDocument();
  });

  it('keeps the main list when a chat is archived after the archived list closed by itself', async () => {
    await renderApp('/inbox');
    await archiveFromRow(await rowLink(/Corniche Office Tower/), 'Corniche Office Tower');
    await waitFor(() => expect(within(chatsList()).queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull());
    await userEvent.click(quietRow());
    await userEvent.click(menuOfRow(await rowLink(/Corniche Office Tower/), 'Corniche Office Tower'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move back to Inbox' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Archived \(/ })).toBeNull());
    await archiveFromRow(await rowLink(/Faisal Al-Harbi/), 'Faisal Al-Harbi');
    await waitFor(() => expect(within(chatsList()).queryByRole('link', { name: /Faisal Al-Harbi/ })).toBeNull());
    expect(quietRow()).toBeInTheDocument();
    expect(within(chatsList()).getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Archived chats' })).toBeNull();
  });

  it('finds an archived chat in the main search, with the word Archived, and finds nothing archived without a search', async () => {
    await renderApp('/inbox');
    await archiveFromRow(await rowLink(/Corniche Office Tower/), 'Corniche Office Tower');
    await waitFor(() => expect(within(chatsList()).queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull());
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'corniche');
    const found = await rowLink(/Corniche Office Tower/);
    expect(within(found).getByText(/Archived/)).toBeInTheDocument();
    expect(screen.queryByText('No chat matches.')).toBeNull();
  });

  it('gives each row menu the name of its chat, and not the same name sixteen times', async () => {
    await renderApp('/inbox');
    await rowLink(/Corniche Office Tower/);
    expect(screen.queryByRole('button', { name: 'Chat options' })).toBeNull();
    const names = within(chatsList()).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name?.startsWith('Options for '))).toBe(true);
  });
});

describe('the row menu of the Inbox list (chats-06)', () => {
  it('shows only while the pointer or the keyboard is on the row, and is gone on a phone and under a finger', async () => {
    await renderApp('/inbox');
    const row = await rowLink(/Corniche Office Tower/);
    const holder = within(row.closest('li') as HTMLElement).getByRole('button', { name: 'Options for Corniche Office Tower' }).parentElement as HTMLElement;
    const classes = holder.className.split(' ');
    expect(classes).toEqual(expect.arrayContaining(['absolute', 'sm:opacity-0', 'sm:group-hover:opacity-100', 'sm:group-focus-within:opacity-100', 'max-sm:hidden', 'pointer-coarse:hidden']));
    // The row itself is a group of the hover and the focus, and it can slide for the swipe.
    expect((row.closest('li') as HTMLElement).className).toContain('group');
  });
});

describe('no "Waits for your reply" line in the Inbox (fbk_028, owner 2026-10-19)', () => {
  it('shows no such line on a chat whose newest message came from someone else, before or after the chat is opened', async () => {
    await renderApp('/inbox');
    const row = await rowLink(/Faisal Al-Harbi/);
    // Faisal wrote the newest message of this chat. Before fbk_028 the row said that it waits for a reply.
    expect(within(row).getByText(/Unread: 1/)).toBeInTheDocument();
    expect(screen.queryByText('Waits for your reply')).toBeNull();
    await userEvent.click(row);
    await waitFor(() => expect(within(row).queryByText(/Unread: 1/)).toBeNull());
    expect(screen.queryByText('Waits for your reply')).toBeNull();
  });
});

describe('Mark as unread (fbk_028, owner 2026-10-19)', () => {
  const rowOf = async (name: RegExp) => (await rowLink(name)).closest('li') as HTMLElement;
  /** Opens the chat of a row, so the chat is read, and waits until its number is gone. */
  async function readChat(name: RegExp) {
    const link = await rowLink(name);
    await userEvent.click(link);
    await waitFor(() => expect(within(link).queryByText(/^Unread: \d+$/)).toBeNull());
    return link;
  }

  it('offers it in the row menu of a chat that was read: the row is unread again, with a toast and Undo, and the open chat closes', async () => {
    const { store, api } = await renderApp('/inbox');
    await readChat(/Faisal Al-Harbi/);
    expect(await screen.findByRole('heading', { level: 2, name: 'Faisal Al-Harbi' })).toBeInTheDocument();
    const badgeBefore = (await api.call('chats.unreadCount', {})).unread;
    await userEvent.click(within(await rowOf(/Faisal Al-Harbi/)).getByRole('button', { name: 'Options for Faisal Al-Harbi' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as unread' }));
    expect(await screen.findByText('Marked as unread.')).toBeInTheDocument();
    const link = await rowLink(/Faisal Al-Harbi/);
    await waitFor(() => expect(within(link).getByText('Unread: 1')).toBeInTheDocument());
    // The chat that was open goes back to the list: the person marked it to come back to it later.
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'Faisal Al-Harbi' })).toBeNull());
    expect(screen.getByText('Pick a chat')).toBeInTheDocument();
    expect(Object.values(store.state.chatReads).find((r) => r.userId === 'usr_001' && r.markedUnread)).toBeDefined();
    // The Inbox badge counts it.
    expect((await api.call('chats.unreadCount', {})).unread).toBe(badgeBefore + 1);
  });

  it('takes the mark back with Undo', async () => {
    await renderApp('/inbox');
    const link = await readChat(/Faisal Al-Harbi/);
    await userEvent.click(within(await rowOf(/Faisal Al-Harbi/)).getByRole('button', { name: 'Options for Faisal Al-Harbi' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as unread' }));
    await waitFor(() => expect(within(link).getByText('Unread: 1')).toBeInTheDocument());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(within(link).queryByText(/^Unread: \d+$/)).toBeNull());
  });

  it('ends when the person opens the chat again', async () => {
    const { store } = await renderApp('/inbox');
    const link = await readChat(/Faisal Al-Harbi/);
    await userEvent.click(within(await rowOf(/Faisal Al-Harbi/)).getByRole('button', { name: 'Options for Faisal Al-Harbi' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as unread' }));
    await waitFor(() => expect(within(link).getByText('Unread: 1')).toBeInTheDocument());
    await userEvent.click(link);
    await waitFor(() => expect(within(link).queryByText(/^Unread: \d+$/)).toBeNull());
    expect(Object.values(store.state.chatReads).some((r) => r.userId === 'usr_001' && r.markedUnread)).toBe(false);
  });

  it('keeps another chat open when the row menu of a different chat marks that chat', async () => {
    await renderApp('/inbox');
    await readChat(/Faisal Al-Harbi/);
    await readChat(/Corniche Office Tower/);
    await screen.findByRole('heading', { level: 2, name: 'Corniche Office Tower' });
    await userEvent.click(within(await rowOf(/Faisal Al-Harbi/)).getByRole('button', { name: 'Options for Faisal Al-Harbi' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as unread' }));
    const marked = await rowLink(/Faisal Al-Harbi/);
    await waitFor(() => expect(within(marked).getByText('Unread: 1')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 2, name: 'Corniche Office Tower' })).toBeInTheDocument();
  });

  it('offers it only for a chat with nothing unread: a chat with new messages has Archive alone', async () => {
    await renderApp('/inbox');
    const tower = await rowOf(/Corniche Office Tower/);
    await userEvent.click(within(tower).getByRole('button', { name: 'Options for Corniche Office Tower' }));
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark as unread' })).toBeNull();
  });

  it('puts it in the menu of the open chat as well, which is the way on a phone, and it works there', async () => {
    await renderApp('/inbox');
    await readChat(/Faisal Al-Harbi/);
    const header = (await screen.findByRole('heading', { level: 2, name: 'Faisal Al-Harbi' })).closest('header') as HTMLElement;
    await userEvent.click(within(header).getByRole('button', { name: 'Options for Faisal Al-Harbi' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as unread' }));
    expect(await screen.findByText('Marked as unread.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'Faisal Al-Harbi' })).toBeNull());
    expect(within(await rowLink(/Faisal Al-Harbi/)).getByText('Unread: 1')).toBeInTheDocument();
  });

  it('works in a group and in a task thread, from the menu of the open chat', async () => {
    await renderApp('/inbox', (state) => {
      withTaskTalk(state);
      addGroupConversation(state, 'Tower team', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], '2026-09-30T09:00:00.000+03:00');
    });
    for (const [name, title] of [[/Tower team/, 'Tower team'], [/Room finish schedule/, 'Room finish schedule']] as const) {
      await readChat(name);
      const header = (await screen.findByRole('heading', { level: 2, name: title })).closest('header') as HTMLElement;
      await userEvent.click(within(header).getByRole('button', { name: `Options for ${title}` }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as unread' }));
      await waitFor(() => expect(within(screen.getByRole('list', { name: 'Chats' })).getAllByText('Unread: 1').length).toBeGreaterThan(0));
      await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: title })).toBeNull());
      expect(within(await rowLink(name)).getByText('Unread: 1')).toBeInTheDocument();
    }
  });

  it('keeps the mark while the chat is open: a mark set from outside is not undone by the open chat', async () => {
    const { api } = await renderApp('/inbox');
    await readChat(/Faisal Al-Harbi/);
    const { id } = await api.call('chats.openDirect', { userId: 'usr_002' });
    await act(async () => { await api.call('chats.markUnread', { conversationId: id }); });
    await settle();
    expect(within(await rowLink(/Faisal Al-Harbi/)).getByText('Unread: 1')).toBeInTheDocument();
  });

  it('ends the mark of a task thread when it opens, also when the newest comment is the own comment of the person', async () => {
    const { api, store } = await renderApp('/inbox', withTaskTalk);
    const task = Object.values(store.state.tasks).find((t) => t.title === 'Room finish schedule')!;
    await api.call('comments.create', { targetType: 'task', targetId: task.id, body: 'On it.' });
    await api.call('chats.markUnread', { conversationId: task.id });
    const link = await rowLink(/Room finish schedule/);
    await waitFor(() => expect(within(link).getByText('Unread: 1')).toBeInTheDocument());
    await userEvent.click(link);
    await waitFor(() => expect(within(link).queryByText(/^Unread: \d+$/)).toBeNull());
    expect(Object.values(store.state.chatReads).some((r) => r.conversationId === task.id && r.markedUnread)).toBe(false);
  });

  it('shows no "Mark as unread" for an archived chat in the archived list', async () => {
    await renderApp('/inbox');
    await readChat(/Faisal Al-Harbi/);
    await userEvent.click(within(await rowOf(/Faisal Al-Harbi/)).getByRole('button', { name: 'Options for Faisal Al-Harbi' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await userEvent.click(await screen.findByRole('button', { name: /Archived \(1\)/ }));
    await userEvent.click(within(await rowOf(/Faisal Al-Harbi/)).getByRole('button', { name: 'Options for Faisal Al-Harbi' }));
    expect(await screen.findByRole('menuitem', { name: 'Move back to Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark as unread' })).toBeNull();
  });
});

describe('the mention list in the Inbox (chats-01)', () => {
  it('opens above the message box and shows the names that start with the letters first', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await userEvent.type(box, '@fa');
    const list = await screen.findByRole('listbox');
    expect(list).toHaveClass('bottom-full');
    expect(within(list).getAllByRole('option')[0]).toHaveTextContent(/^FA?Faisal/);
  });
});

/** A group of Hala (usr_001, the maker), Faisal (usr_002) and the person usr_003, made in the sample office. */
const withGroup = (state: State) => {
  addGroupConversation(state, 'Tower team', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], '2026-09-30T09:00:00.000+03:00');
};

/** Opens the group from the list. */
async function openGroup() {
  await userEvent.click(await rowLink(/Tower team/));
  await screen.findByRole('heading', { level: 2, name: 'Tower team' });
}

/** Opens the People sheet with the count in the header. */
async function openPeople() {
  await openGroup();
  await userEvent.click(await screen.findByRole('button', { name: '3 people' }));
  return screen.findByRole('dialog', { name: 'People in the group' });
}

describe('group chats', () => {
  it('makes a group of the two people picked, with a name, and opens it', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New group' }));
    await userEvent.click(await screen.findByRole('button', { name: /Faisal Al-Harbi/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Reem Al-Ghamdi/ }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Group name' }), 'Tower team');
    await userEvent.click(screen.getByRole('button', { name: 'Make group' }));
    await waitFor(() => expect(window.location.hash).toMatch(/#\/inbox\/cnv_\d+/));
    expect(Object.values(store.state.conversations).find((c) => c.kind === 'group' && c.name === 'Tower team')).toMatchObject({ name: 'Tower team', makerId: 'usr_001' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Tower team' })).toBeInTheDocument();
  });

  it('needs no name: the title says New group, a line counts the people, the name field shows from the start, and the group takes the first names', async () => {
    const { store } = await renderApp('/inbox');
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New group' }));
    const sheet = await screen.findByRole('dialog', { name: 'New group' });
    expect(within(sheet).getByText('Pick two people or more.')).toBeInTheDocument();
    expect(within(sheet).getByRole('textbox', { name: 'Group name' })).toHaveAttribute('autocomplete', 'off');
    const make = within(sheet).getByRole('button', { name: 'Make group' });
    expect(make).toBeDisabled();
    await userEvent.click(await within(sheet).findByRole('button', { name: /Faisal Al-Harbi/ }));
    expect(make).toBeDisabled();
    await userEvent.click(within(sheet).getByRole('button', { name: /Reem Al-Ghamdi/ }));
    expect(within(sheet).getByText('2 people picked')).toBeInTheDocument();
    expect(make).toBeEnabled();
    await userEvent.click(make);
    await waitFor(() => expect(Object.values(store.state.conversations).some((c) => c.kind === 'group' && /Faisal.*Reem/.test(c.name ?? ''))).toBe(true));
  });

  it('goes back to one person with the link Message one person', async () => {
    await renderApp('/inbox');
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New group' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Message one person' }));
    expect(await screen.findByRole('dialog', { name: 'Pick a person' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Group name' })).toBeNull();
  });

  it('marks each picked person with a check mark, so the choice shows without colour', async () => {
    await renderApp('/inbox');
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New group' }));
    const faisal = await screen.findByRole('button', { name: /Faisal Al-Harbi/ });
    const before = faisal.querySelectorAll('svg').length;
    await userEvent.click(faisal);
    expect(faisal).toHaveAttribute('aria-pressed', 'true');
    expect(faisal.querySelectorAll('svg').length).toBe(before + 1);
    await userEvent.click(faisal);
    expect(faisal.querySelectorAll('svg').length).toBe(before);
  });

  it('shows a group in the list by its name, with one picture and no faces, and the Inbox search finds it by name', async () => {
    await renderApp('/inbox', withGroup);
    const row = await rowLink(/Tower team/);
    expect(within(row).getByRole('img', { name: 'Group chat' })).toBeInTheDocument();
    // The picture of the group holds no face, so no stack of initials covers the title.
    expect(within(row).queryByRole('img', { name: /Faisal|Hala|Reem|Sara/ })).toBeNull();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'tower te');
    expect(within(screen.getByRole('list', { name: 'Chats' })).getByRole('link', { name: /Tower team/ })).toBeInTheDocument();
  });

  it('shows the count of people in the header to every member, and opens the People sheet with the names, "You" and the maker', async () => {
    await renderApp('/inbox', (state) => {
      withGroup(state);
      state.session.currentUserId = 'usr_002';
    });
    const sheet = await openPeople();
    expect(within(sheet).getByText('3 people')).toBeInTheDocument();
    const rows = within(sheet).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('You')).toBeInTheDocument();
    expect(within(sheet).getByText('Group maker')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Add people' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Leave group' })).toBeInTheDocument();
    // A member who is not the maker has no Remove.
    expect(within(sheet).queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('keeps Rename, Mark as unread and Archive in the group menu, and nothing else', async () => {
    await renderApp('/inbox', withGroup);
    await openGroup();
    const menus = screen.getAllByRole('button', { name: 'Options for Tower team' });
    await userEvent.click(menus[menus.length - 1]);
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Mark as unread' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('lets the maker rename the group, and writes one quiet line about it', async () => {
    await renderApp('/inbox', withGroup);
    await openGroup();
    const menus = screen.getAllByRole('button', { name: 'Options for Tower team' });
    await userEvent.click(menus[menus.length - 1]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const field = await screen.findByRole('textbox', { name: 'Group name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Tower design team');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Tower design team' })).toBeInTheDocument();
    const line = await within(await screen.findByRole('log', { name: 'Messages' })).findByText(/renamed the group to/);
    // Each name sits between FSI and PDI marks, so the test drops them before it compares.
    expect(line.textContent?.replace(/[\u2068\u2069]/g, '')).toBe('Hala Nasser renamed the group to Tower design team');
  });

  it('shows Remove on each other person to the maker, removes one with a toast and Undo, and writes a quiet line', async () => {
    const { store } = await renderApp('/inbox', withGroup);
    const sheet = await openPeople();
    await userEvent.click(within(sheet).getAllByRole('button', { name: /^Remove / })[0]);
    await waitFor(() => expect(Object.values(store.state.conversations).find((c) => c.kind === 'group' && c.name === 'Tower team')?.memberIds).toHaveLength(2));
    expect(await screen.findByText(/ removed\.$/)).toBeInTheDocument();
    // The open sheet blocks the page, and the unit tests load no Tailwind classes, so the toast button takes a plain click.
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.values(store.state.conversations).find((c) => c.kind === 'group' && c.name === 'Tower team')?.memberIds).toHaveLength(3));
  });

  it('adds people with a line that says they read the earlier messages, and writes a quiet line in the chat', async () => {
    const { store } = await renderApp('/inbox', withGroup);
    const sheet = await openPeople();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add people' }));
    const add = await screen.findByRole('dialog', { name: 'Add people to the group' });
    expect(within(add).getByText('They see the earlier messages too.')).toBeInTheDocument();
    // The first person who is not in the group yet.
    const candidate = (await within(add).findAllByRole('button')).find((button) => button.hasAttribute('aria-pressed'))!;
    const name = candidate.querySelector('bdi')!.textContent!;
    await userEvent.click(candidate);
    await userEvent.click(within(add).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(Object.values(store.state.conversations).find((c) => c.kind === 'group' && c.name === 'Tower team')?.memberIds).toHaveLength(4));
    const line = await within(await screen.findByRole('log', { name: 'Messages' })).findByText(/ added /);
    expect(line.textContent?.replace(/[\u2068\u2069]/g, '')).toBe(`Hala Nasser added ${name}`);
  });

  it('asks before a leave, with Cancel in focus, and names the group in the toast after it', async () => {
    await renderApp('/inbox', withGroup);
    const sheet = await openPeople();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Leave group' }));
    const confirm = await screen.findByRole('dialog', { name: 'Leave this group?' });
    expect(within(confirm).getByText(/The chat and its messages leave your Inbox/)).toBeInTheDocument();
    await waitFor(() => expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await userEvent.click(within(confirm).getByRole('button', { name: 'Leave the group' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Chats' })).not.toHaveTextContent('Tower team'));
    expect(await screen.findByText(/You left/)).toHaveTextContent('Tower team');
  });

  it('lets the last person stay in a closed chat that takes no new messages', async () => {
    await renderApp('/inbox', (state) => {
      withGroup(state);
      const group = Object.values(state.conversations).find((c) => c.kind === 'group' && c.name === 'Tower team')!;
      state.conversations[group.id] = { ...group, memberIds: ['usr_001'] };
    });
    await openGroup();
    expect(await screen.findByText('Everyone else left this group.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });
});
