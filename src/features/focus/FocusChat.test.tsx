import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chatReadKey, type State } from '../../api/store';
import { ImageViewer } from '../../components/ImageViewer';
import { Sheet } from '../../components/Sheet';
import { readDraft } from '../../app/drafts';
import { renderApp } from '../../test/render';
import { phoneMedia } from '../../test/phoneMedia';

/**
 * The project chat beside the timer in Focus mode (fbk_059, owner 2026-10-25). One quiet button opens the chat as a panel on the end
 * side from 1024 px, and as a full page over Focus under 1024 px. The panel is closed at first and the device keeps the last choice.
 * Sara (usr_005) leads "Civil Defense drawings" (tsk_012) in the tower project (prj_001), so she may open its project chat.
 */
const SARA = 'usr_005';
const FOCUS_URL = '/projects/prj_001?tab=tasks&focus=tsk_012';
const WALL = 'The wall is 40 cm higher.';
const CHOICE_KEY = 'madar.focus.chat';

const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;

/** One new message of Faisal in the tower chat, newer than the read mark of Sara. */
function plant(state: State) {
  const room = roomOf(state);
  state.messages.msg_901 = {
    id: 'msg_901', conversationId: room.id, authorId: 'usr_002', actingForId: 'usr_002', body: WALL, mentions: [], fileIds: [],
    createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
  state.chatReads[chatReadKey(room.id, SARA)] = { conversationId: room.id, userId: SARA, lastReadAt: '2026-09-29T08:00:00.000+03:00', archivedAt: null };
}

const show = (visible: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
  document.dispatchEvent(new Event('visibilitychange'));
};
afterEach(() => {
  Reflect.deleteProperty(document, 'hidden');
  vi.restoreAllMocks();
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
const calls = (spy: { mock: { calls: unknown[][] } }, name: string) => spy.mock.calls.filter(([called]) => called === name);
const wide = () => phoneMedia({ phone: false, wide: true });
const narrow = () => phoneMedia({ phone: false, wide: false });
const phone = () => phoneMedia({ phone: true, wide: false });
const zOf = (element: Element) => Number(/\bz-\[?(\d+)\]?/.exec(element.className)?.[1]);

async function openFocus(options: { user?: string; url?: string; prepare?: (state: State) => void } = {}) {
  const view = await renderApp(options.url ?? FOCUS_URL, (state) => {
    state.session.currentUserId = options.user ?? SARA;
    plant(state);
    options.prepare?.(state);
  });
  const focus = await screen.findByRole('dialog', { name: 'Focus' });
  return { ...view, focus };
}
const projectChatButton = (focus: HTMLElement) => within(focus).findByRole('button', { name: 'Project chat' });
const panelOf = () => screen.findByRole('complementary', { name: 'Project chat' });

describe('the project chat button in Focus mode', () => {
  it('shows one quiet button at the end of the top row, and the panel is closed at first', async () => {
    wide();
    const { focus } = await openFocus();
    const button = await projectChatButton(focus);
    // Quiet grey, never the navy main button.
    expect(button).toHaveClass('bg-fill');
    expect(button).not.toHaveClass('signature');
    expect(button.parentElement).toContainElement(within(focus).getByText('Corniche Office Tower'));
    expect(button.parentElement!.lastElementChild).toBe(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('complementary', { name: 'Project chat' })).toBeNull();
    expect(window.localStorage.getItem(CHOICE_KEY)).toBeNull();
  });

  // The owner, 2026-10-25: "allow to switch to the task chat too". A person who may not open the project chat still has the to-do thread.
  it('gives a person who may not open the project chat only the to-do thread, and no leak of the project chat', async () => {
    wide();
    const { focus, api, store } = await openFocus({
      prepare: (state) => {
        state.settings.roles = { off: { member: ['chat.project.team'] } };
      },
    });
    const spy = vi.spyOn(api, 'call');
    await within(focus).findByRole('heading', { level: 1, name: 'Civil Defense drawings' });
    await settle();
    expect(within(focus).queryByRole('button', { name: 'Project chat' })).toBeNull();
    await userEvent.click(await within(focus).findByRole('button', { name: 'To-do thread' }));
    const panel = await screen.findByRole('complementary', { name: 'To-do thread' });
    await settle();
    expect(within(panel).queryByRole('radiogroup')).toBeNull();
    expect(within(panel).queryByText(WALL)).toBeNull();
    const room = roomOf(store.state).id;
    expect(calls(spy, 'chats.messages').some(([, input]) => (input as { conversationId?: string })?.conversationId === room)).toBe(false);
  });

  it('sends no chat request and no read mark while the panel is closed, and the chat stays unread', async () => {
    wide();
    const { focus, api, store } = await openFocus();
    const spy = vi.spyOn(api, 'call');
    await projectChatButton(focus);
    await settle();
    expect(calls(spy, 'chats.messages')).toHaveLength(0);
    expect(calls(spy, 'chats.markRead')).toHaveLength(0);
    expect(store.state.chatReads[chatReadKey(roomOf(store.state).id, SARA)]?.lastReadAt).toBe('2026-09-29T08:00:00.000+03:00');
    // No dot and no count on the button for the new message.
    const button = within(focus).getByRole('button', { name: 'Project chat' });
    expect(button.querySelector('[data-dot], .bg-accent')).toBeNull();
    expect(button).toHaveTextContent(/^Project chat$/);
  });
});

describe('the panel on a wide window (1024 px or more)', () => {
  it('opens the project chat on a press, reads it once, and waits for a hidden tab', async () => {
    wide();
    const { focus, api } = await openFocus();
    const spy = vi.spyOn(api, 'call');
    show(false);
    await userEvent.click(await projectChatButton(focus));
    const panel = await panelOf();
    expect(within(focus).getByRole('button', { name: 'Project chat' })).toHaveAttribute('aria-expanded', 'true');
    expect(await within(panel).findByText(WALL)).toBeInTheDocument();
    await settle();
    // A hidden tab marks nothing (the Inbox rule).
    expect(calls(spy, 'chats.markRead')).toHaveLength(0);
    act(() => show(true));
    await waitFor(() => expect(calls(spy, 'chats.markRead')).toHaveLength(1));
    expect(window.localStorage.getItem(CHOICE_KEY)).toBe('open');
  });

  it('sends a message from the panel and Focus stays open', async () => {
    wide();
    const { focus } = await openFocus();
    await userEvent.click(await projectChatButton(focus));
    const panel = await panelOf();
    const box = await within(panel).findByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'I will send it today.{Enter}');
    expect(await within(panel).findByText('I will send it today.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Focus' })).toBeInTheDocument();
    expect(window.location.hash).toContain('focus=tsk_012');
  });

  // The owner, 2026-10-25: "allow to switch to the task chat too in focus mode". A project to-do has two chats: the project chat and its
  // own thread. A two-part switch at the top of the sidebar picks one, and the device keeps the pick. The shown chat alone reads and marks.
  it('switches the sidebar between the project chat and the to-do thread, and the device keeps the pick', async () => {
    wide();
    const { focus, unmount } = await openFocus({
      prepare: (state) => {
        state.comments.cmt_902 = {
          id: 'cmt_902', targetType: 'task', targetId: 'tsk_012', authorId: 'usr_002', body: 'Use the new stair widths.',
          reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
        };
      },
    });
    await userEvent.click(await projectChatButton(focus));
    const panel = await panelOf();
    const choice = within(panel).getByRole('radiogroup', { name: 'Which chat' });
    expect(within(choice).getByRole('radio', { name: 'Project chat' })).toBeChecked();
    expect(await within(panel).findByText(WALL)).toBeInTheDocument();
    await userEvent.click(within(choice).getByRole('radio', { name: 'To-do thread' }));
    const thread = await screen.findByRole('complementary', { name: 'To-do thread' });
    expect(await within(thread).findByText('Use the new stair widths.')).toBeInTheDocument();
    expect(within(thread).queryByText(WALL)).toBeNull();
    expect(window.localStorage.getItem('madar.focus.chatKind')).toBe('task');
    unmount();
    const again = await openFocus();
    const kept = await screen.findByRole('complementary', { name: 'To-do thread' });
    expect(within(kept).getByRole('radio', { name: 'To-do thread' })).toBeChecked();
    expect(within(again.focus).getByRole('button', { name: 'Project chat' })).toBeInTheDocument();
  });

  // The owner, 2026-10-25 ("make this part better"): in the narrow sidebar the full hint took three lines and "Send" a wide button.
  // The box takes the short hint with the @ tip and the round Send icon of a phone; Enter still sends on a desk.
  it('gives the box in the sidebar the short hint and the round Send icon, and Enter still sends', async () => {
    wide();
    const { focus } = await openFocus();
    await userEvent.click(await projectChatButton(focus));
    const panel = await panelOf();
    const box = await within(panel).findByRole('textbox', { name: 'Message' });
    expect(box).toHaveAttribute('placeholder', 'Use @ to mention.');
    const send = within(panel).getByRole('button', { name: 'Send' });
    expect(send).toHaveClass('rounded-full');
    expect(send).not.toHaveTextContent('Send');
    await userEvent.type(box, 'Short box works.{Enter}');
    expect(await within(panel).findByText('Short box works.')).toBeInTheDocument();
  });

  it('shows a slim header (tile, title, Close) and none of the Inbox controls', async () => {
    wide();
    const { focus } = await openFocus();
    await userEvent.click(await projectChatButton(focus));
    const panel = await panelOf();
    await within(panel).findByText(WALL);
    expect(within(panel).getByRole('heading', { level: 2, name: 'Corniche Office Tower' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(panel).queryByRole('link')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Options for / })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /Back/ })).toBeNull();
    expect(within(panel).queryByRole('link', { name: 'Search messages' })).toBeNull();
  });

  it('keeps Focus open on Escape from inside the panel, and the page Escape still ends it', async () => {
    wide();
    const { focus } = await openFocus();
    await userEvent.click(await projectChatButton(focus));
    const panel = await panelOf();
    const box = await within(panel).findByRole('textbox', { name: 'Message' });
    await userEvent.click(box);
    await userEvent.keyboard('{Escape}');
    await settle();
    // The link is the truth: the dialog stays in the page during its exit animation.
    expect(window.location.hash).toContain('focus=tsk_012');
    expect(screen.getByRole('dialog', { name: 'Focus' })).toBeInTheDocument();
    // The @ list takes its own Escape.
    await userEvent.type(box, '@');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(window.location.hash).toContain('focus=tsk_012');
    expect(screen.getByRole('dialog', { name: 'Focus' })).toBeInTheDocument();
    // Escape on the page, outside the panel, still exits.
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.click(within(focus).getByRole('heading', { level: 1 }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Focus' })).toBeNull());
  });

  it('keeps the focus on Done when a remembered open panel comes back, and the box takes none', async () => {
    window.localStorage.setItem(CHOICE_KEY, 'open');
    wide();
    const { focus } = await openFocus();
    const done = within(focus).getByRole('button', { name: 'Done' });
    await waitFor(() => expect(done).toHaveFocus());
    const panel = await panelOf();
    expect(await within(panel).findByText(WALL)).toBeInTheDocument();
    await within(panel).findByRole('textbox', { name: 'Message' });
    await settle();
    expect(done).toHaveFocus();
  });

  it('keeps the timer time when the panel opens and closes', async () => {
    wide();
    const { focus } = await openFocus();
    const timer = within(focus).getByRole('region', { name: 'Focus timer' });
    await userEvent.click(within(timer).getByRole('button', { name: 'Start' }));
    expect(within(timer).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await userEvent.click(await projectChatButton(focus));
    await panelOf();
    expect(within(focus).getByRole('region', { name: 'Focus timer' })).toBe(timer);
    await userEvent.click(within(await panelOf()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Project chat' })).toBeNull());
    expect(within(focus).getByRole('region', { name: 'Focus timer' })).toBe(timer);
    expect(timer.isConnected).toBe(true);
    // A new mount would show Start and 25:00 again.
    expect(within(timer).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('keeps the choice on the device: open, leave, enter again, still open; closed stays closed', async () => {
    wide();
    const first = await openFocus();
    await userEvent.click(await projectChatButton(first.focus));
    await panelOf();
    first.unmount();
    const second = await openFocus();
    expect(await panelOf()).toBeInTheDocument();
    await userEvent.click(within(second.focus).getByRole('button', { name: 'Project chat' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Project chat' })).toBeNull());
    expect(window.localStorage.getItem(CHOICE_KEY)).toBe('closed');
  });

  it('keeps the half-written text when the panel closes and opens', async () => {
    wide();
    const { focus, store } = await openFocus();
    await userEvent.click(await projectChatButton(focus));
    const panel = await panelOf();
    await userEvent.type(await within(panel).findByRole('textbox', { name: 'Message' }), 'Half of a');
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Project chat' })).toBeNull());
    expect(readDraft(SARA, `chat:${roomOf(store.state).id}`)).toBe('Half of a');
    await userEvent.click(within(focus).getByRole('button', { name: 'Project chat' }));
    expect(await within(await panelOf()).findByRole('textbox', { name: 'Message' })).toHaveValue('Half of a');
  });

  it('does nothing in Focus when a reply strip points to a message older than the loaded pages', async () => {
    wide();
    const lines = (state: State) => {
      const room = roomOf(state).id;
      for (let n = 1; n <= 260; n += 1) {
        state.messages[`msg_${1000 + n}`] = {
          id: `msg_${1000 + n}`, conversationId: room, authorId: 'usr_002', actingForId: 'usr_002', body: `Line ${n}`, mentions: [], fileIds: [],
          createdAt: new Date(Date.parse('2026-09-30T06:00:00.000Z') - (300 - n) * 60_000).toISOString().replace('Z', '+03:00'), editedAt: null,
        };
      }
      state.messages.msg_1700 = {
        id: 'msg_1700', conversationId: room, authorId: 'usr_002', actingForId: 'usr_002', body: 'Back to the first lines', mentions: [], fileIds: [],
        replyToId: 'msg_1010', createdAt: '2026-09-30T08:30:00.000+03:00', editedAt: null,
      };
    };
    const { focus } = await openFocus({ prepare: lines });
    await userEvent.click(await projectChatButton(focus));
    const panel = await panelOf();
    expect(await within(panel).findByText('Back to the first lines')).toBeInTheDocument();
    expect(within(panel).queryByText('Line 11')).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: /Line 10$/ }));
    await settle();
    expect(window.location.hash).toBe(`#${FOCUS_URL}`);
    expect(screen.getByRole('dialog', { name: 'Focus' })).toBeInTheDocument();
  }, 30_000);

  it('shifts the column with a class only: the panel is a sibling and the page keeps its place in the tree', async () => {
    wide();
    const { focus } = await openFocus();
    const heading = within(focus).getByRole('heading', { level: 1 });
    await userEvent.click(await projectChatButton(focus));
    await panelOf();
    expect(within(focus).getByRole('heading', { level: 1 })).toBe(heading);
    expect(focus).toHaveClass('lg:pe-[24rem]');
    await userEvent.click(within(await panelOf()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(focus).not.toHaveClass('lg:pe-[24rem]'));
    expect(within(focus).getByRole('heading', { level: 1 })).toBe(heading);
  });

  // The owner, 2026-10-25: "the project chat make it open like sidebar". The panel is docked: flush on the end edge, full height,
  // one hairline on its start side, no card corners or shadow, and the Focus page leaves exactly its width free.
  it('docks the chat as a sidebar on the end edge, full height, with no card look', async () => {
    wide();
    const { focus } = await openFocus();
    await userEvent.click(await projectChatButton(focus));
    const panel = await panelOf();
    for (const name of ['fixed', 'inset-y-0', 'end-0', 'w-[24rem]', 'border-s', 'border-hairline', 'bg-panel']) expect(panel, name).toHaveClass(name);
    for (const name of ['panel', 'inset-y-3', 'end-3']) expect(panel, name).not.toHaveClass(name);
  });
});

describe('a narrow window or a phone (under 1024 px)', () => {
  it('does not open a remembered open panel by itself', async () => {
    window.localStorage.setItem(CHOICE_KEY, 'open');
    narrow();
    const { focus, api } = await openFocus();
    const spy = vi.spyOn(api, 'call');
    await projectChatButton(focus);
    await settle();
    expect(screen.queryByRole('complementary', { name: 'Project chat' })).toBeNull();
    expect(document.querySelector('[data-chat-page]')).toBeNull();
    expect(calls(spy, 'chats.messages')).toHaveLength(0);
    // A press here opens the page and leaves the remembered choice alone.
    await userEvent.click(within(focus).getByRole('button', { name: 'Project chat' }));
    expect(window.localStorage.getItem(CHOICE_KEY)).toBe('open');
  });

  it('opens a full page over Focus that is not inert, and Back to focus returns with the timer running', async () => {
    phone();
    const { focus } = await openFocus();
    const timer = within(focus).getByRole('region', { name: 'Focus timer' });
    await userEvent.click(within(timer).getByRole('button', { name: 'Start' }));
    await userEvent.click(await projectChatButton(focus));
    const page = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-chat-page]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(await within(page).findByText(WALL)).toBeInTheDocument();
    // Focus sets the mark of an open panel on <html>; the page must still take focus and clicks.
    expect(document.documentElement).toHaveAttribute('data-panel-open');
    expect(page.inert).not.toBe(true);
    expect(zOf(page)).toBeGreaterThan(zOf(focus));
    expect(within(page).queryByRole('link', { name: 'Back to chats' })).toBeNull();
    expect(within(page).queryByRole('link', { name: 'Search messages' })).toBeNull();
    // The timer keeps running under the page.
    expect(within(timer).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await userEvent.click(within(page).getByRole('button', { name: 'Back to focus' }));
    await waitFor(() => expect(document.querySelector('[data-chat-page]')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Focus' })).toBeInTheDocument();
    expect(within(focus).getByRole('region', { name: 'Focus timer' })).toBe(timer);
    expect(within(timer).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(window.localStorage.getItem(CHOICE_KEY)).toBeNull();
  });

  it('writes in the page, and Escape in the box neither ends Focus nor leaves the page', async () => {
    phone();
    const { focus } = await openFocus();
    await userEvent.click(await projectChatButton(focus));
    const page = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-chat-page]');
      expect(found).not.toBeNull();
      return found!;
    });
    const box = await within(page).findByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'On my way');
    await userEvent.click(within(page).getByRole('button', { name: 'Send' }));
    expect(await within(page).findByText('On my way')).toBeInTheDocument();
    await userEvent.click(box);
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(screen.getByRole('dialog', { name: 'Focus' })).toBeInTheDocument();
    expect(window.location.hash).toContain('focus=tsk_012');
  });
});

describe('an office to-do', () => {
  const OFFICE = (state: State) => {
    state.tasks.tsk_900 = {
      id: 'tsk_900', projectId: null, stageId: null, title: 'Renew the trade licence', description: '', ownerId: SARA, status: 'todo',
      dueDate: '2026-10-05', flagged: false, needsReview: false, checklist: [], createdBy: SARA, createdAt: '2026-09-29T09:00:00.000+03:00',
      completedAt: null,
    };
    state.counters.tsk = Math.max(state.counters.tsk ?? 0, 900);
    state.comments.cmt_901 = {
      id: 'cmt_901', targetType: 'task', targetId: 'tsk_900', authorId: 'usr_004', body: 'The office stamp is ready.',
      reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
    };
  };

  it('has no switch for an office to-do: its thread is its only chat', async () => {
    wide();
    const { focus } = await openFocus({ url: '/work?focus=tsk_900', prepare: OFFICE });
    await userEvent.click(await within(focus).findByRole('button', { name: 'To-do thread' }));
    const panel = await screen.findByRole('complementary', { name: 'To-do thread' });
    expect(within(panel).queryByRole('radiogroup')).toBeNull();
  });

  it('says "To-do thread", shows the comments in the panel and posts a comment', async () => {
    wide();
    const { focus, store } = await openFocus({ url: '/work?focus=tsk_900', prepare: OFFICE });
    const button = await within(focus).findByRole('button', { name: 'To-do thread' });
    expect(within(focus).queryByRole('button', { name: 'Project chat' })).toBeNull();
    await userEvent.click(button);
    const panel = await screen.findByRole('complementary', { name: 'To-do thread' });
    expect(await within(panel).findByText('The office stamp is ready.')).toBeInTheDocument();
    await userEvent.type(await within(panel).findByRole('textbox', { name: /Message|Comment/ }), 'Done with the stamp.{Enter}');
    expect(await within(panel).findByText('Done with the stamp.')).toBeInTheDocument();
    expect(Object.values(store.state.comments).some((comment) => comment.targetId === 'tsk_900' && comment.body === 'Done with the stamp.')).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Focus' })).toBeInTheDocument();
  });
});

describe('the layers around Focus mode', () => {
  it('puts Focus above the tab pill and below the sheets, the picture viewer and the toasts', async () => {
    narrow();
    const { focus } = await openFocus();
    const pill = document.querySelector('nav[data-pill]');
    expect(pill).not.toBeNull();
    expect(zOf(focus)).toBeGreaterThan(zOf(pill!));
    const viewer = render(<ImageViewer open onClose={() => undefined} name="Site photo.jpg" src="https://store.test/full.jpg" placeholder="https://store.test/thumb.jpg" onDownload={() => undefined} />);
    const picture = await screen.findByRole('dialog', { name: 'Site photo.jpg' });
    expect(zOf(picture)).toBeGreaterThan(zOf(focus));
    viewer.unmount();
    render(<Sheet open onOpenChange={() => undefined} title="A sheet"><p>Body</p></Sheet>);
    const sheet = await screen.findByRole('dialog', { name: 'A sheet' });
    expect(zOf(sheet)).toBeGreaterThan(zOf(focus));
    const overlay = document.querySelector('[data-vaul-overlay]');
    expect(zOf(overlay!)).toBeGreaterThan(zOf(focus));
  });
});
