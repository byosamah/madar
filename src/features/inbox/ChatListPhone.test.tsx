import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';
import { stubPhone, withArchivedTower, withEveryKind } from './phoneHarness';

const list = async () => screen.findByRole('list', { name: 'Chats' });
const chips = async () => screen.findByRole('radiogroup', { name: 'Kind of chat' });

describe('the chat list on a phone (Direction D)', () => {
  it('shows chips and no kind menu, and a chip filters the same list as the menu does', async () => {
    stubPhone();
    await renderApp('/inbox', withEveryKind);
    expect(screen.queryByRole('button', { name: /^Show chats:/ })).toBeNull();
    await userEvent.click(within(await chips()).getByRole('radio', { name: 'Projects' }));
    const chats = within(await list());
    expect(chats.getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(chats.queryByRole('link', { name: /Faisal Al-Harbi/ })).toBeNull();
    expect(window.localStorage.getItem('madar.chatKind')).toBe('projects');
    expect(within(await chips()).getByRole('radio', { name: 'Projects' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps the menu and shows no chip on a desk', async () => {
    await renderApp('/inbox', withEveryKind);
    expect(await screen.findByRole('button', { name: /^Show chats:/ })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Kind of chat' })).toBeNull();
  });

  it('draws the search text at 16 px or more on a phone', async () => {
    stubPhone();
    await renderApp('/inbox');
    const search = await screen.findByRole('searchbox', { name: 'Search chats' });
    expect(search.className).toContain('max(16px,var(--text-subheadline))');
  });

  it('puts "Archived (n)" as the last row of the panel, and first under the search on a desk', async () => {
    stubPhone();
    await renderApp('/inbox', withArchivedTower);
    const chats = await list();
    const quiet = within(chats).getByRole('button', { name: 'Archived (1)' });
    expect(chats.lastElementChild).toContainElement(quiet);
    await userEvent.click(quiet);
    expect(await screen.findByRole('heading', { level: 2, name: 'Archived chats' })).toBeInTheDocument();
  });

  it('keeps "Archived (n)" under the search on a desk', async () => {
    await renderApp('/inbox', withArchivedTower);
    const quiet = await screen.findByRole('button', { name: 'Archived (1)' });
    expect(within(await list()).queryByRole('button', { name: 'Archived (1)' })).toBeNull();
    expect(quiet.compareDocumentPosition(await list()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no panel around the aside and no inner scroll or fixed height', async () => {
    stubPhone();
    await renderApp('/inbox');
    const chats = await list();
    expect(chats).toHaveClass('panel', 'hairline');
    expect(chats).not.toHaveClass('overflow-y-auto');
    expect(chats.closest('aside')).not.toHaveClass('panel');
    expect(chats.closest('aside')!.parentElement!.className).not.toContain('h-[calc(');
  });

  it('keeps the panel, the inner scroll and the fixed height on a desk', async () => {
    await renderApp('/inbox');
    const chats = await list();
    expect(chats).toHaveClass('overflow-y-auto');
    expect(chats.closest('aside')).toHaveClass('panel');
  });

  it('lets a row swipe sideways and the page scroll up and down', async () => {
    stubPhone();
    await renderApp('/inbox');
    const row = (await screen.findByRole('link', { name: /Corniche Office Tower/ })).closest('li')!;
    expect(row.style.touchAction).toBe('pan-y');
  });

  it('shows "No chats here." for an empty chip', async () => {
    stubPhone();
    await renderApp('/inbox', (state) => {
      withEveryKind(state);
      for (const [id, comment] of Object.entries(state.comments)) if (comment.targetType === 'task') delete state.comments[id];
    });
    await userEvent.click(within(await chips()).getByRole('radio', { name: 'To-dos' }));
    expect(await screen.findByText('No chats here.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull();
  });

  it('shows the line of hidden unread messages under the panel, and "Show all" chooses All (fbk_056)', async () => {
    stubPhone();
    await renderApp('/inbox', withEveryKind);
    await userEvent.click(within(await chips()).getByRole('radio', { name: 'People' }));
    const sentence = await screen.findByText(/unread messages are in other chats\./);
    expect(sentence).toHaveTextContent('3 unread messages are in other chats.');
    const chats = await list();
    expect(chats.contains(sentence)).toBe(false);
    expect(chats.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Show all' });
    expect(button).toHaveClass('min-h-11');
    await userEvent.click(button);
    expect(within(await list()).getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(within(await chips()).getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(/unread messages are in other chats/)).toBeNull();
  });

  it('shows no line on a phone while All is chosen', async () => {
    stubPhone();
    await renderApp('/inbox', withEveryKind);
    await list();
    expect(screen.queryByText(/in other chats/)).toBeNull();
  });
});
