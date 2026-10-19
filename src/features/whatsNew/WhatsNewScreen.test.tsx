import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { renderRemoteApp } from '../../test/renderRemote';
import { WHATS_NEW } from '../../whatsNew/entries';

describe("What's new screen", () => {
  it('shows the title, the entry title and the entry text in English', async () => {
    await renderApp('/whats-new');
    expect(await screen.findByRole('heading', { level: 1, name: "What's new" })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'The project list' })).toBeInTheDocument();
    expect(screen.getByText(/^Now you can archive a chat\. Press the three dots/)).toBeInTheDocument();
  });

  it('shows the Arabic title and the Arabic entry in Arabic', async () => {
    await renderApp('/whats-new', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'ما الجديد' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'قائمة المشاريع' })).toBeInTheDocument();
  });

  it('marks the newest entry seen when the page opens', async () => {
    await renderApp('/whats-new');
    await screen.findByRole('heading', { level: 1, name: "What's new" });
    expect(window.localStorage.getItem('madar.whatsNewSeen.usr_001')).toBe(WHATS_NEW[0].id);
  });

  it('opens in the real build too', async () => {
    await renderRemoteApp('/whats-new');
    expect(await screen.findByRole('heading', { level: 1, name: "What's new" })).toBeInTheDocument();
    expect(screen.getByText(/^Now you can archive a chat\. Press the three dots/)).toBeInTheDocument();
  });

  // UX audit 2026-10-19, chats-14: a person reads only the entries that the person can use, and one link takes the person there.
  it('hides the entries that only the Admin can use from a Member, and shows them to the Admin', async () => {
    const { unmount } = await renderApp('/whats-new', (state) => {
      state.session.currentUserId = 'usr_005';
    });
    await screen.findByRole('heading', { level: 3, name: 'The project list' });
    expect(screen.queryByRole('heading', { level: 3, name: 'Sub-companies' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'Roles and rights' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'Project templates' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: 'The office report' })).toBeNull();
    // Everyone reads who changes a role.
    expect(screen.getByRole('heading', { level: 3, name: 'Who changes a role' })).toBeInTheDocument();
    unmount();
    await renderApp('/whats-new');
    expect(await screen.findByRole('heading', { level: 3, name: 'Sub-companies' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Roles and rights' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'The office report' })).toBeInTheDocument();
  });

  it('ends an entry that names a screen with one quiet link Open, and no button', async () => {
    await renderApp('/whats-new');
    const group = (await screen.findByRole('heading', { level: 3, name: 'Group chats' })).closest('article') as HTMLElement;
    const link = within(group).getByRole('link', { name: 'Open: Group chats' });
    expect(link).toHaveAttribute('href', expect.stringMatching(/\/inbox$/));
    expect(within(group).getByText('Open')).toBe(link);
    expect(screen.queryAllByRole('button')).toHaveLength(screen.queryAllByRole('button', { name: /Hala Nasser|Notifications|Search/ }).length);
    // An entry with no screen has no link.
    const calendar = screen.getByRole('heading', { level: 3, name: 'A new calendar' }).closest('article') as HTMLElement;
    expect(within(calendar).queryByRole('link')).toBeNull();
  });

  it('keeps the text column to 40 rem', async () => {
    await renderApp('/whats-new');
    const article = (await screen.findByRole('heading', { level: 3, name: 'Group chats' })).closest('article') as HTMLElement;
    expect(article).toHaveClass('max-w-[40rem]');
  });

  it('marks the entries newer than the last one the person saw with the word New, and none on a first visit', async () => {
    window.localStorage.setItem('madar.whatsNewSeen.usr_001', '2026-10-23-5');
    const { unmount } = await renderApp('/whats-new');
    await screen.findByRole('heading', { level: 3, name: 'Group chats' });
    const mark = (title: string) => within((screen.getByRole('heading', { level: 3, name: new RegExp(`^${title}`) }))).queryByText('New');
    expect(mark('Who changes a role')).not.toBeNull();
    expect(mark('Archive a chat')).not.toBeNull();
    expect(mark('Group chats')).toBeNull();
    expect(mark('Agents read your chats')).toBeNull();
    unmount();
    window.localStorage.clear();
    await renderApp('/whats-new');
    await screen.findByRole('heading', { level: 3, name: 'Group chats' });
    expect(screen.queryAllByText('New')).toHaveLength(0);
  });
});

