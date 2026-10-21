import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyReactions } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

/**
 * Any emoji as a reaction (chat presence design E1 to E3, track emoji E4): the + of the message menu, of the phone sheet and of a post
 * comment. Hala (usr_001) is the Admin. msg_901 is by Faisal (usr_002) in the chat of Corniche Office Tower, as in MessageMenu.test.
 */
const FAISAL = 'The wall is 40 cm higher.';
const roomOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;
function plant(state: State) {
  const room = roomOf(state);
  state.messages.msg_901 = {
    id: 'msg_901', conversationId: room.id, authorId: 'usr_002', actingForId: 'usr_002', body: FAISAL, mentions: [],
    createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
}
const inArabic = (state: State) => {
  plant(state);
  state.users.usr_001.preferences.language = 'ar';
};

afterEach(() => vi.unstubAllGlobals());

const row = (id = 'msg_901') => document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
async function openTower() {
  await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /Corniche Office Tower/ }));
  await waitFor(() => expect(row()).not.toBeNull());
}
async function openTowerInArabic() {
  await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower/ }));
  await waitFor(() => expect(row()).not.toBeNull());
}
const menuGone = () => waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
const phone = () => vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('max-width: 639px'), media: query, onchange: null,
  addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
}));
async function longPress(id: string) {
  const target = row(id).querySelector<HTMLElement>('p')!;
  fireEvent.pointerDown(target, { pointerType: 'touch', clientX: 10, clientY: 10 });
  await act(() => new Promise((resolve) => setTimeout(resolve, 550)));
}
const toggles = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((call) => call[0] === 'reactions.toggle').map((call) => call[1]);

describe('the + of the message menu', () => {
  it('opens the list and a pick of 🎉 calls reactions.toggle with 🎉, closes the list and shows the pill', async () => {
    const { api } = await renderApp('/inbox', plant);
    await openTower();
    const spy = vi.spyOn(api, 'call');
    const tools = within(row()).getByRole('button', { name: 'Actions for this message' });
    await userEvent.click(tools);
    const menu = screen.getByRole('menu', { name: 'Actions for this message' });
    // The three reactions keep their place, and the + comes after them.
    expect(within(menu).getAllByRole('menuitemcheckbox').map((button) => button.textContent)).toEqual(['👍', '✅', '👀']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Add a reaction' }));
    // The menu ends and the list opens at the "..." button of this message.
    await menuGone();
    const list = await screen.findByRole('dialog', { name: 'Add a reaction' });
    expect(await within(list).findByRole('searchbox', { name: 'Search emoji' })).toBeInTheDocument();
    await userEvent.click(within(list).getAllByRole('button', { name: 'party popper' })[0]);
    expect(toggles(spy)).toEqual([{ messageId: 'msg_901', emoji: '🎉' }]);
    const pill = await within(row()).findByRole('button', { name: 'React with 🎉, 1' });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a reaction' })).toBeNull());
    // A press on the pill takes the reaction back.
    await userEvent.click(pill);
    await waitFor(() => expect(within(row()).queryByRole('button', { name: /React with 🎉/ })).toBeNull());
  });

  it('closes the list with Escape and gives the focus to the "..." button, and with a press outside', async () => {
    await renderApp('/inbox', plant);
    await openTower();
    const tools = within(row()).getByRole('button', { name: 'Actions for this message' });
    await userEvent.click(tools);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add a reaction' }));
    await screen.findByRole('dialog', { name: 'Add a reaction' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a reaction' })).toBeNull());
    await waitFor(() => expect(within(row()).getByRole('button', { name: 'Actions for this message' })).toHaveFocus());
    await userEvent.click(within(row()).getByRole('button', { name: 'Actions for this message' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add a reaction' }));
    await screen.findByRole('dialog', { name: 'Add a reaction' });
    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog', { name: 'Add a reaction' })).toBeNull();
  });

  it('shows the pills 👍 ✅ 👀 🎉 🙏 in that order', async () => {
    await renderApp('/inbox', (state) => {
      plant(state);
      // Stored in another order on purpose: the order comes from the keys, not from the record.
      state.messages.msg_901.reactions = { '🙏': ['usr_003'], '🎉': ['usr_002', 'usr_003'], '👀': ['usr_001'], '✅': ['usr_002'], '👍': ['usr_003'] };
    });
    await openTower();
    const pills = within(row()).getByRole('group', { name: 'Reactions' });
    expect(within(pills).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'React with 👍, 1', 'React with ✅, 1', 'React with 👀, 1', 'React with 🎉, 2', 'React with 🙏, 1',
    ]);
  });

  it('shows the toast of a refused write when the message has the most reactions', async () => {
    await renderApp('/inbox', (state) => {
      plant(state);
      const kinds = ['🎉', '🙏', '🔥', '😂', '❤️', '🥳', '😍', '🤔', '😮', '😢', '😡', '🙌', '👏', '💯', '🚀', '⭐', '🌟', '☕', '🍕'];
      state.messages.msg_901.reactions = { ...Object.fromEntries(kinds.map((kind) => [kind, ['usr_003']])), '👍': ['usr_003'] };
    });
    await openTower();
    await userEvent.click(within(row()).getByRole('button', { name: 'Actions for this message' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add a reaction' }));
    const list = await screen.findByRole('dialog', { name: 'Add a reaction' });
    await userEvent.click((await within(list).findAllByRole('button', { name: 'grinning face' }))[0]);
    // The refusal has the reason reactions_full, so the toast says the rule (src/app/errors.ts), not only that the write failed.
    expect(await screen.findByText('This message has 20 kinds of reactions. Pick one of them.')).toBeInTheDocument();
    expect(within(row()).queryByRole('button', { name: /React with 😀/ })).toBeNull();
  });

  it('Arabic: the label is أضف تفاعلًا', async () => {
    await renderApp('/inbox', inArabic);
    await openTowerInArabic();
    await userEvent.click(within(row()).getByRole('button', { name: 'خيارات هذه الرسالة' }));
    const add = screen.getByRole('menuitem', { name: 'أضف تفاعلًا' });
    expect(add).toBeInTheDocument();
    await userEvent.click(add);
    const list = await screen.findByRole('dialog', { name: 'أضف تفاعلًا' });
    await userEvent.click((await within(list).findAllByRole('button', { name: 'قلب أحمر' }))[0]);
    expect(await within(row()).findByRole('button', { name: /^.*❤️.*1/ })).toBeInTheDocument();
  });
});

describe('the + of the phone sheet', () => {
  it('closes the message sheet before the emoji sheet opens, and one pick reacts and ends it', async () => {
    phone();
    const { api } = await renderApp('/inbox', plant);
    await openTower();
    const spy = vi.spyOn(api, 'call');
    await longPress('msg_901');
    const sheet = await screen.findByRole('dialog', { name: /Faisal Al-Harbi · / });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add a reaction' }));
    // In the same moment the message sheet is closing and the emoji sheet is not there yet.
    expect(screen.queryByRole('dialog', { name: 'Add an emoji' })).toBeNull();
    const emoji = await screen.findByRole('dialog', { name: 'Add an emoji' });
    // Never two sheets at once.
    expect(screen.queryByRole('dialog', { name: /Faisal Al-Harbi · / })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await userEvent.click((await within(emoji).findAllByRole('button', { name: 'party popper' }))[0]);
    expect(toggles(spy)).toEqual([{ messageId: 'msg_901', emoji: '🎉' }]);
    expect(await within(row()).findByRole('button', { name: 'React with 🎉, 1' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the + of a post comment', () => {
  it('shows the + after the three, and a pick of 🎉 adds the reaction', async () => {
    const { store } = await renderApp('/projects/prj_001?tab=activity&update=upd_002', (state) => {
      state.session.currentUserId = 'usr_005';
      state.comments.cmt_910 = {
        id: 'cmt_910', targetType: 'update', targetId: 'upd_002', authorId: 'usr_002', body: 'Looks right to me.', reactions: { ...emptyReactions(), '🙏': ['usr_002'] }, fileIds: [],
        createdAt: '2026-09-29T09:00:00.000+03:00', editedAt: null,
      };
    });
    const item = (await screen.findByText('Looks right to me.')).closest('li') as HTMLElement;
    // The three quick ones, then the emoji in use, then the +.
    expect(within(item).getAllByRole('button', { name: /^React with/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'React with 👍, 0', 'React with ✅, 0', 'React with 👀, 0', 'React with 🙏, 1',
    ]);
    await userEvent.click(within(item).getByRole('button', { name: 'Add a reaction' }));
    const list = await screen.findByRole('dialog', { name: 'Add a reaction' });
    await userEvent.click((await within(list).findAllByRole('button', { name: 'party popper' }))[0]);
    await waitFor(() => expect(store.state.comments.cmt_910.reactions['🎉']).toEqual(['usr_005']));
    expect(await within(item).findByRole('button', { name: 'React with 🎉, 1' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a reaction' })).toBeNull());
    await waitFor(() => expect(within(item).getByRole('button', { name: 'Add a reaction' })).toHaveFocus());
  });

  it('shows no + to a person who may not react', async () => {
    await renderApp('/projects/prj_001?tab=activity&update=upd_002', (state) => {
      state.session.currentUserId = 'usr_003';
      state.comments.cmt_910 = {
        id: 'cmt_910', targetType: 'update', targetId: 'upd_002', authorId: 'usr_002', body: 'Looks right to me.', reactions: { ...emptyReactions(), '🎉': ['usr_002'] }, fileIds: [],
        createdAt: '2026-09-29T09:00:00.000+03:00', editedAt: null,
      };
    });
    const item = (await screen.findByText('Looks right to me.')).closest('li') as HTMLElement;
    expect(within(item).queryByRole('button', { name: 'Add a reaction' })).toBeNull();
    expect(within(item).getByText('🎉')).toBeInTheDocument();
  });
});
