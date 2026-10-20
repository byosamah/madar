import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyReactions } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * The task panel takes the look of the chat (chat design 2026-10-19, item 6; track msg B16). The comments of Stair details (tsk_007) are
 * replaced by two comments of Faisal Al-Harbi (usr_002) one minute apart and one of Yousef Saleh (usr_006), who reads the panel.
 * Today in the tests is Wed 30 Sep 2026, so the comments of 29 Sep sit under "Yesterday".
 */
const TASK = '/projects/prj_001?tab=tasks&task=tsk_007&thread=1';
const MOVE = { from: { startDate: null, dueDate: '2026-10-10' }, to: { startDate: null, dueDate: '2026-10-14' } };

function put(state: State, id: string, authorId: string, body: string, at: string, extra: object = {}) {
  state.comments[id] = {
    id, targetType: 'task', targetId: 'tsk_007', authorId, body, reactions: emptyReactions(), fileIds: [], createdAt: `2026-09-29T${at}.000+03:00`, editedAt: null, ...extra,
  };
}

/** Yousef reads. The panel holds the three comments and the extra comments of the test. */
function plant(extra: (state: State) => void = () => undefined, language: 'en' | 'ar' = 'en') {
  return (state: State) => {
    state.session.currentUserId = 'usr_006';
    state.users.usr_006.preferences.language = language;
    for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === 'tsk_007') delete state.comments[id];
    put(state, 'cmt_901', 'usr_002', 'First note', '08:00:00');
    put(state, 'cmt_902', 'usr_002', 'Second note', '08:01:00');
    put(state, 'cmt_903', 'usr_006', 'My note', '08:05:00');
    extra(state);
  };
}

async function openPanel(setup = plant(), region = 'Comments') {
  const app = await renderApp(TASK, setup);
  const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
  const comments = within(await within(sheet).findByRole('region', { name: region }));
  await comments.findByText('Second note');
  return { ...app, sheet, comments };
}

const commentOf = (comments: ReturnType<typeof within>, text: string) => comments.getByText(text).closest('li') as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe('the task panel in the look of the chat', () => {
  it('draws a task comment as a bubble with a run, pills and the menu', async () => {
    const { comments } = await openPanel(plant((state) => { state.comments.cmt_902.reactions['👍'] = ['usr_006']; }));
    // Two comments of one person within 5 minutes form a run: one name, one face.
    expect(comments.getAllByText('Faisal Al-Harbi')).toHaveLength(1);
    // The day line, and the clock under the first bubble of a run.
    expect(comments.getByText('Yesterday')).toBeInTheDocument();
    expect(commentOf(comments, 'First note').querySelector('time')).not.toBeNull();
    // A reaction pill under the bubble, with the thin ring of the reader.
    const pill = within(commentOf(comments, 'Second note')).getByRole('button', { name: /React with 👍, 1/ });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    // The small menu holds the reactions and Reply, and no Edit and Delete on the comment of another person.
    await userEvent.click(within(commentOf(comments, 'Second note')).getByRole('button', { name: 'Actions for this comment' }));
    const menu = screen.getByRole('menu', { name: 'Actions for this comment' });
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(3);
    expect(within(menu).getByRole('menuitem', { name: 'Reply' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('keeps the menu button on a phone, and opens no second sheet on a long press (the panel is a sheet itself)', async () => {
    const { comments } = await openPanel();
    const mine = commentOf(comments, 'My note');
    const button = within(mine).getByRole('button', { name: 'Actions for this comment' });
    // A finger sees the button: the chat hides it on a touch screen and opens a sheet on a long press, but a bottom sheet cannot open
    // inside the bottom sheet of the task on a phone.
    expect(button.className).not.toMatch(/pointer-coarse:hidden/);
    expect(button.className).toMatch(/pointer-coarse:opacity-100/);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.pointerDown(within(mine).getByText('My note'), { pointerType: 'touch', clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(700);
    fireEvent.pointerUp(within(mine).getByText('My note'), { pointerType: 'touch' });
    vi.useRealTimers();
    expect(screen.queryByRole('dialog', { name: /^Your message · / })).toBeNull();
  });

  it('puts the own comment on the end side, with Edit and Delete in its menu', async () => {
    const { comments } = await openPanel();
    expect(commentOf(comments, 'My note')).toHaveClass('self-end');
    expect(commentOf(comments, 'First note')).toHaveClass('self-start');
    await userEvent.click(within(commentOf(comments, 'My note')).getByRole('button', { name: 'Actions for this comment' }));
    const menu = screen.getByRole('menu', { name: 'Actions for this comment' });
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('toggles a reaction from the menu and shows it as a pill', async () => {
    const { comments, store } = await openPanel();
    await userEvent.click(within(commentOf(comments, 'First note')).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'Actions for this comment' })).getByRole('menuitemcheckbox', { name: /React with ✅/ }));
    await waitFor(() => expect(store.state.comments.cmt_901.reactions['✅']).toEqual(['usr_006']));
    const pill = await within(commentOf(comments, 'First note')).findByRole('button', { name: /React with ✅, 1/ });
    await userEvent.click(pill);
    await waitFor(() => expect(store.state.comments.cmt_901.reactions['✅']).toEqual([]));
  });

  it('replies to a task comment from the panel', async () => {
    const { comments, sheet, store } = await openPanel();
    await userEvent.click(within(commentOf(comments, 'Second note')).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'Actions for this comment' })).getByRole('menuitem', { name: 'Reply' }));
    // The strip sits above the field of the box, and the focus goes into the field.
    const box = within(sheet).getByRole('textbox', { name: 'Add a comment' });
    const strip = within(sheet).getByText('Reply to Faisal Al-Harbi').parentElement!;
    expect(within(strip).getByText('Second note')).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveFocus());
    await userEvent.type(box, 'Noted, thanks.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.comments).find((c) => c.body === 'Noted, thanks.')?.replyToId).toBe('cmt_902'));
    // The strip goes after the send, and the new comment shows the old words in its own strip.
    await waitFor(() => expect(within(sheet).queryByText('Reply to Faisal Al-Harbi')).toBeNull());
    const made = await comments.findByText('Noted, thanks.');
    expect(within(made.closest('li') as HTMLElement).getByRole('button', { name: /Faisal Al-Harbi/ })).toHaveTextContent('Second note');
  });

  it('drops the reply with the X, and then sends no replyToId', async () => {
    const { comments, sheet, store } = await openPanel();
    await userEvent.click(within(commentOf(comments, 'First note')).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'Actions for this comment' })).getByRole('menuitem', { name: 'Reply' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel the reply' }));
    expect(within(sheet).queryByText('Reply to Faisal Al-Harbi')).toBeNull();
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'No reply here.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.comments).find((c) => c.body === 'No reply here.')).toBeDefined());
    expect(Object.values(store.state.comments).find((c) => c.body === 'No reply here.')?.replyToId).toBeUndefined();
  });

  it('scrolls the old comment to the middle and frames it when the person presses a reply strip', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { comments } = await openPanel(plant((state) => put(state, 'cmt_904', 'usr_002', 'Answer to the first', '08:10:00', { replyToId: 'cmt_901' })));
    const answer = commentOf(comments, 'Answer to the first');
    await userEvent.click(within(answer).getByRole('button', { name: /Faisal Al-Harbi/ }));
    // The strip of the answer shows the words of the old comment too, so the old comment is found by its id.
    const old = document.querySelector<HTMLElement>('[data-message-id="cmt_901"]')!;
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(scroll.mock.contexts.at(-1)).toBe(old);
    expect(old).toHaveAttribute('data-framed');
    await waitFor(() => expect(old).not.toHaveAttribute('data-framed'), { timeout: 3000 });
  });

  it('shows the strip of a deleted comment as "Deleted message", with no button', async () => {
    const { comments } = await openPanel(plant((state) => put(state, 'cmt_904', 'usr_002', 'Answer to the first', '08:10:00', { replyToId: 'cmt_999' })));
    const answer = within(commentOf(comments, 'Answer to the first'));
    expect(answer.getByText('Deleted message')).toBeInTheDocument();
    expect(answer.queryByRole('button', { name: /Deleted message/ })).toBeNull();
  });

  it('keeps a quiet line of a date reason as a grey line with its age and its Edit', async () => {
    const { comments } = await openPanel(plant((state) => put(state, 'cmt_905', 'usr_006', 'The client sent the survey late', '08:20:00', { dates: MOVE })));
    const line = comments.getByText(/ changed the due date: .*The client sent the survey late/).closest('li') as HTMLElement;
    // The look of today: a grey line with no bubble, no side spot, and the age of the line. Not the centered group line of the Inbox.
    expect(within(line).getByText('Due date: from Sat 10 Oct to Wed 14 Oct')).toBeInTheDocument();
    expect(line).not.toHaveAttribute('data-message-id');
    expect(line.querySelector('[data-part="side"]')).toBeNull();
    expect(line.querySelector('time')).not.toBeNull();
    expect(within(line).queryByRole('button', { name: /^React with/ })).toBeNull();
    await userEvent.click(within(line).getByRole('button', { name: 'Actions for this comment' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('breaks the run of a person at a quiet line', async () => {
    const { comments } = await openPanel(plant((state) => {
      put(state, 'cmt_905', 'usr_006', 'Why the dates moved', '08:01:30', { kind: 'reopened' });
      put(state, 'cmt_906', 'usr_002', 'Third note', '08:02:00');
    }));
    // Faisal shows his name again after the line, though his comments are 2 minutes apart.
    expect(comments.getAllByText('Faisal Al-Harbi')).toHaveLength(2);
    expect(commentOf(comments, 'Third note').querySelector('bdi')).not.toBeNull();
  });

  it('keeps the comments of a post as they are today', async () => {
    await renderApp('/projects/prj_001?tab=activity&update=upd_002', (state) => {
      state.session.currentUserId = 'usr_005';
      state.comments.cmt_910 = {
        id: 'cmt_910', targetType: 'update', targetId: 'upd_002', authorId: 'usr_002', body: 'Looks right to me.', reactions: emptyReactions(), fileIds: [],
        createdAt: '2026-09-29T09:00:00.000+03:00', editedAt: null,
      };
    });
    const item = (await screen.findByText('Looks right to me.')).closest('li') as HTMLElement;
    expect(within(item).getAllByRole('button', { name: /^React with/ })).toHaveLength(3);
    expect(item.querySelector('[data-part="side"]')).toBeNull();
    expect(item).not.toHaveAttribute('data-message-id');
  });

  it('shows a person outside the project the reactions as plain pills, with no menu', async () => {
    const { comments } = await openPanel(plant((state) => {
      state.session.currentUserId = 'usr_003';
      state.comments.cmt_901.reactions['👀'] = ['usr_002', 'usr_005'];
    }));
    const first = within(commentOf(comments, 'First note'));
    expect(first.getByText(/👀 2/)).toBeInTheDocument();
    expect(first.queryByRole('button')).toBeNull();
  });

  it('reads the panel in Arabic, right to left', async () => {
    const { comments } = await openPanel(plant(undefined, 'ar'), 'التعليقات');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(within(commentOf(comments, 'Second note')).getByRole('button', { name: 'خيارات هذا التعليق' })).toBeInTheDocument();
    expect(comments.getByText('أمس')).toBeInTheDocument();
  });
});
