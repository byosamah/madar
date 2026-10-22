import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeLive } from '../../test/fakeLive';
import { renderApp } from '../../test/render';
import { stubPhone, withEveryKind, withGroup } from './phoneHarness';

const cutter = (heading: HTMLElement) => heading.querySelector('bdi') as HTMLElement;
const rowLink = async (name: RegExp, list = 'Chats') => within(await screen.findByRole('list', { name: list })).getByRole('link', { name });
const headerOf = async (name: RegExp) => (await screen.findByRole('heading', { level: 2, name })).closest('header') as HTMLElement;

describe('the chat header on a phone (Direction D)', () => {
  it('shows back, picture of 38 px, one title line, state line, Search and options for a direct chat', async () => {
    stubPhone();
    const live = fakeLive({ usr_002: 'online' });
    await renderApp('/inbox', undefined, { live: live.port });
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    const header = await headerOf(/Faisal Al-Harbi/);
    expect(header.className).toContain('h-[calc(56px+env(safe-area-inset-top))]');
    const head = within(header);
    expect(head.getByRole('link', { name: 'Back to chats' })).toBeInTheDocument();
    expect(head.getByText('Online')).toBeInTheDocument();
    expect(head.getByRole('link', { name: 'Search messages' }).getAttribute('href')).toMatch(/\/search\?in=messages$/);
    expect(head.getByRole('button', { name: 'Options for Faisal Al-Harbi' })).toBeInTheDocument();
    const picture = header.querySelector<HTMLElement>('[data-presence], img, [role="img"]');
    expect(picture).not.toBeNull();
    expect(header.querySelector('[style*="width: 38px"]')).not.toBeNull();
  });

  it('shows "Project chat" with the project tile for a project chat', async () => {
    stubPhone();
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const header = await headerOf(/Corniche Office Tower/);
    expect(within(header).getByText('Project chat')).toBeInTheDocument();
    expect(header.querySelector('[style*="width: 38px"]')).not.toBeNull();
  });

  it('shows the group picture as a button and "3 people" as a button for a group', async () => {
    stubPhone();
    await renderApp('/inbox', withGroup);
    await userEvent.click(await rowLink(/Tower team/));
    const header = await headerOf(/Tower team/);
    expect(within(header).getByRole('button', { name: 'People in the group' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: '3 people' })).toBeInTheDocument();
  });

  it('shows "To-do thread · Project" or "Office", one title line and no Open to-do link in the header', async () => {
    stubPhone();
    await renderApp('/inbox', withEveryKind);
    await userEvent.click(await rowLink(/Room finish schedule/));
    const header = await headerOf(/Room finish schedule/);
    const heading = within(header).getByRole('heading', { level: 2 });
    expect(cutter(heading)).toHaveClass('block', 'truncate');
    expect(cutter(heading)).not.toHaveClass('line-clamp-2');
    expect(within(header).getByText(/^To-do thread · /)).toBeInTheDocument();
    expect(within(header).queryByRole('link', { name: 'Open to-do' })).toBeNull();
  });

  it('keeps a long mixed-direction title on one line and the title block shrinkable', async () => {
    stubPhone();
    await renderApp('/inbox', (state) => {
      state.users.usr_001.preferences.language = 'ar';
      state.users.usr_002.nameAr = undefined;
      state.users.usr_002.name = 'Faisal Abdulrahman Al-Harbi of the Corniche Office Tower team and more words';
    });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.click(await rowLink(/Faisal Abdulrahman/, 'المحادثات'));
    const heading = await screen.findByRole('heading', { level: 2, name: /Faisal Abdulrahman/ });
    expect(cutter(heading)).toHaveClass('block', 'truncate');
    expect(heading.parentElement).toHaveClass('min-w-0', 'flex-1');
  });

  it('opens the Search screen from the icon (its Messages group is Task I10)', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.click(within(await headerOf(/Corniche Office Tower/)).getByRole('link', { name: 'Search messages' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'));
  });

  it('keeps the Back rule of the first task: a step back to the list', async () => {
    stubPhone();
    const { router } = await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.click(within(await headerOf(/Corniche Office Tower/)).getByRole('link', { name: 'Back to chats' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inbox'));
    expect(router.state.historyAction).toBe('POP');
  });

  it('keeps the old header on a desk', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    const header = await headerOf(/Corniche Office Tower/);
    expect(within(header).queryByRole('link', { name: 'Search messages' })).toBeNull();
    expect(header.className).not.toContain('h-[calc(56px');
  });
});
