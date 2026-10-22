import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addGroupConversation } from '../../api/chatState';
import type { RoleSettings } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { fakeLive } from '../../test/fakeLive';
import { renderApp } from '../../test/render';
import { without } from '../../test/rr2work';
import { stubPhone, withArchivedTower, withEveryKind, withGroup } from './phoneHarness';

const rowLink = async (name: RegExp) => within(await screen.findByRole('list', { name: 'Chats' })).getByRole('link', { name });
const optionsButton = (title: string) => screen.findByRole('button', { name: `Options for ${title}` });
const sheetOf = (title: string) => screen.findByRole('dialog', { name: `Options for ${title}` });
const live = () => fakeLive({ usr_002: 'online', usr_003: 'away' }, ['usr_002', 'usr_003']);

async function openGroupOptions(prepare: (state: State) => void = withGroup, options: Parameters<typeof renderApp>[2] = { live: live().port }) {
  const app = await renderApp('/inbox', prepare, options);
  await userEvent.click(await rowLink(/Tower team/));
  await userEvent.click(await optionsButton('Tower team'));
  return { ...app, sheet: await sheetOf('Tower team') };
}
async function openProjectOptions() {
  const app = await renderApp('/inbox');
  await userEvent.click(await rowLink(/Corniche Office Tower/));
  await userEvent.click(await optionsButton('Corniche Office Tower'));
  return { ...app, sheet: await sheetOf('Corniche Office Tower') };
}
const labelsOf = (sheet: HTMLElement) => [...sheet.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
/** A Member who sits in a group that Faisal made. */
const memberInGroup = (roles?: RoleSettings) => (state: State) => {
  state.session.currentUserId = 'usr_005';
  if (roles) state.settings.roles = roles;
  addGroupConversation(state, 'Tower team', 'usr_002', ['usr_002', 'usr_001', 'usr_005'], '2026-09-30T09:00:00.000+03:00');
};

describe('the options sheet of a chat on a phone (Direction D)', () => {
  it('opens one dialog "Options for Tower team" with the people, then the rows in the order of the design', async () => {
    stubPhone();
    const { sheet } = await openGroupOptions();
    expect(within(sheet).getByRole('heading', { name: 'People in the group' })).toBeInTheDocument();
    const labels = labelsOf(sheet);
    expect(labels.at(-1)).toBe('Leave group');
    expect(within(sheet).getByRole('button', { name: 'Leave group' })).toHaveClass('text-late');
    const order = ['Add people', 'Rename', 'All messages', 'Only when I am named', 'Archive'];
    const positions = order.map((label) => labels.findIndex((text) => text === label));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(within(sheet).getByText('You · Group maker')).toBeInTheDocument();
    const faisal = within(sheet).getByText('Faisal Al-Harbi').closest('li') as HTMLElement;
    expect(within(faisal).getByText('Online')).toBeInTheDocument();
    const reem = within(sheet).getByText('Reem Al-Ghamdi').closest('li') as HTMLElement;
    expect(within(reem).getByText('Away')).toBeInTheDocument();
  });

  it('adds a Message button to each other person and none to the own row, and starts the direct chat with state.from', async () => {
    stubPhone();
    const { sheet, router } = await openGroupOptions();
    expect(within(sheet).queryByRole('button', { name: 'Message Hala Nasser' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Message Reem Al-Ghamdi' })).toHaveTextContent('Message');
    const from = router.state.location.pathname;
    await userEvent.click(within(sheet).getByRole('button', { name: 'Message Faisal Al-Harbi' }));
    await waitFor(() => expect(router.state.location.pathname).not.toBe(from));
    expect(router.state.location.pathname).toMatch(/^\/inbox\/cnv_/);
    expect(router.state.location.state).toEqual({ from });
  });

  it('hides the Message buttons without chat.direct, and Add people and Rename without chat.groupChange', async () => {
    stubPhone();
    await renderApp('/inbox', memberInGroup(without('chat.direct', 'chat.groupChange')), { live: live().port });
    await userEvent.click(await rowLink(/Tower team/));
    await userEvent.click(await optionsButton('Tower team'));
    const sheet = await sheetOf('Tower team');
    expect(within(sheet).queryByRole('button', { name: /^Message / })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Add people' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Leave group' })).toBeInTheDocument();
  });

  it('shows Remove only to the maker, with the toast and Undo of today', async () => {
    stubPhone();
    const { sheet, store } = await openGroupOptions();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Remove Faisal Al-Harbi' }));
    const members = () => Object.values(store.state.conversations).find((c) => c.kind === 'group' && c.name === 'Tower team')?.memberIds;
    await waitFor(() => expect(members()).toHaveLength(2));
    expect(await screen.findByText(/ removed\.$/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(members()).toHaveLength(3));
  });

  it('hides Remove from a member who is not the maker', async () => {
    stubPhone();
    await renderApp('/inbox', memberInGroup(), { live: live().port });
    await userEvent.click(await rowLink(/Tower team/));
    await userEvent.click(await optionsButton('Tower team'));
    expect(within(await sheetOf('Tower team')).queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('shows "Away (set by you)" on the own row when the person chose Away', async () => {
    stubPhone();
    const { sheet } = await openGroupOptions((state) => {
      withGroup(state);
      state.users.usr_001.preferences.awayByHand = true;
    });
    const own = within(sheet).getByText('Hala Nasser').closest('li') as HTMLElement;
    expect(within(own).getByText('Away (set by you)')).toBeInTheDocument();
  });

  it('opens the Rename sheet only after this sheet closed', async () => {
    stubPhone();
    const { sheet } = await openGroupOptions();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Rename' }));
    await screen.findByRole('dialog', { name: 'Rename the group' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
  });

  it('shows Open the project first for a project chat, with no People part and no Leave group', async () => {
    stubPhone();
    const { sheet } = await openProjectOptions();
    const link = within(sheet).getByRole('link', { name: 'Open the project' });
    expect(link.getAttribute('href')).toMatch(/\/projects\/prj_001$/);
    expect(within(sheet).queryByRole('heading', { name: 'People in the group' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Leave group' })).toBeNull();
  });

  it('shows Open to-do first for a to-do thread, and no Notify me', async () => {
    stubPhone();
    await renderApp('/inbox', withEveryKind);
    await userEvent.click(await rowLink(/Room finish schedule/));
    await userEvent.click(await optionsButton('Room finish schedule'));
    const sheet = await sheetOf('Room finish schedule');
    expect(within(sheet).getByRole('link', { name: 'Open to-do' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('radiogroup')).toBeNull();
    expect(within(sheet).queryByText('Notify me')).toBeNull();
  });

  it('checks the radio of the saved level, and a pick saves the other level', async () => {
    stubPhone();
    const { sheet } = await openProjectOptions();
    const group = within(sheet).getByRole('radiogroup', { name: 'Notify me' });
    // A project chat starts on "Only when I am named" (NotifyChoice.test.tsx).
    expect(within(group).getByRole('radio', { name: 'Only when I am named' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(group).getByRole('radio', { name: 'All messages' }));
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'All messages' })).toHaveAttribute('aria-checked', 'true'));
    expect(within(group).getByRole('radio', { name: 'Only when I am named' })).toHaveAttribute('aria-checked', 'false');
    expect(within(sheet).getByText('The unread count still shows every message.')).toBeInTheDocument();
  });

  it('archives from the sheet: the toast, the chat page closes by Back (POP), the list shows', async () => {
    stubPhone();
    const { sheet, router } = await openProjectOptions();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Chat archived.')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(router.state.historyAction).toBe('POP');
    expect(await screen.findByRole('list', { name: 'Chats' })).toBeInTheDocument();
  });

  it('keeps the chat open after Move back to Inbox', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox/cnv_001', withArchivedTower);
    await userEvent.click(await optionsButton('Corniche Office Tower'));
    await userEvent.click(within(await sheetOf('Corniche Office Tower')).getByRole('button', { name: 'Move back to Inbox' }));
    expect(await screen.findByText('Moved back to Inbox.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/inbox/cnv_001');
    expect(document.querySelector('[data-chat-page]')).not.toBeNull();
  });

  it('marks as unread from the sheet: the toast with Undo and the chat page closes', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    // The chat was read when it opened. Its unread count is 0, so the sheet offers the row.
    await screen.findByRole('log', { name: 'Messages' });
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/inbox\/cnv_/));
    await userEvent.click(await optionsButton('Corniche Office Tower'));
    const sheet = await sheetOf('Corniche Office Tower');
    await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Mark as unread' })).toBeInTheDocument());
    await userEvent.click(within(sheet).getByRole('button', { name: 'Mark as unread' }));
    expect(await screen.findByText('Marked as unread.')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('leaves the group: the confirm opens after the sheet, the leave goes back one step', async () => {
    stubPhone();
    const { sheet, router } = await openGroupOptions();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Leave group' }));
    const confirm = await screen.findByRole('dialog', { name: 'Leave this group?' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    await userEvent.click(within(confirm).getByRole('button', { name: 'Leave the group' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(router.state.historyAction).toBe('POP');
    expect(await screen.findByText(/You left/)).toHaveTextContent('Tower team');
  });

  it('opens the sheet from the picture and from the count button of a group', async () => {
    stubPhone();
    await renderApp('/inbox', withGroup);
    await userEvent.click(await rowLink(/Tower team/));
    await userEvent.click(await screen.findByRole('button', { name: 'People in the group' }));
    expect(await sheetOf('Tower team')).toBeInTheDocument();
    await userEvent.click(within(await sheetOf('Tower team')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: '3 people' }));
    expect(await sheetOf('Tower team')).toBeInTheDocument();
  });

  it('keeps the anchored menu and the People sheet on a desk', async () => {
    await renderApp('/inbox', withGroup);
    await userEvent.click(await rowLink(/Tower team/));
    await screen.findByRole('heading', { level: 2, name: 'Tower team' });
    const menus = screen.getAllByRole('button', { name: 'Options for Tower team' });
    await userEvent.click(menus[menus.length - 1]);
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Options for Tower team' })).toBeNull();
  });

  it('reads in Arabic with the female forms of the presence words', async () => {
    stubPhone();
    await renderApp('/inbox', (state) => {
      withGroup(state);
      state.users.usr_001.preferences.language = 'ar';
    }, { live: live().port });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(within(await screen.findByRole('list', { name: 'المحادثات' })).getByRole('link', { name: /Tower team/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: /^خيارات/ }))[0]);
    const sheet = await screen.findByRole('dialog', { name: /^خيارات/ });
    const reem = within(sheet).getByText('ريم الغامدي').closest('li') as HTMLElement;
    expect(within(reem).getByText('بعيدة عن الشاشة')).toBeInTheDocument();
  });
});
