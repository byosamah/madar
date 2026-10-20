import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../i18n';
import { ar, en } from '../../i18n/trees';
import { renderApp, renderWithRuntime } from '../../test/render';
import { expectCalm } from '../auth/calmChecks';
import { AdminReachSection } from './AdminReachSection';

afterEach(() => {
  cleanup();
  initI18n('en');
});

type ReachWords = { title: string; saved: string; mine: { label: string; hint: string }; mixed: { label: string; hint: string }; all: { label: string; hint: string } };
// The base word tree has no type for the track files, so the words of this section are read through one cast.
const W = (en as unknown as { adminReach: ReachWords }).adminReach;
const WAR = (ar as unknown as { adminReach: ReachWords }).adminReach;

/** Hala (usr_001) is the Admin of the sample office, Faisal (usr_002) is not. */
const sectionOf = async () => (await screen.findByRole('heading', { name: W.title })).closest('section')!;

describe('the What reaches me section of the Admin (owner, 2026-10-23)', () => {
  it('shows three choices with one line each, and the default choice checked', async () => {
    await renderWithRuntime(<AdminReachSection />);
    const section = await sectionOf();
    const radios = within(section).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    for (const choice of ['mine', 'mixed', 'all'] as const) {
      expect(within(section).getByRole('radio', { name: new RegExp(W[choice].label) })).toHaveTextContent(W[choice].hint);
    }
    expectCalm(section, { titleLevel: 2 });
  });

  it('saves a pick at once, shows a toast, and moves the check', async () => {
    const { store } = await renderWithRuntime(<AdminReachSection />);
    const section = await sectionOf();
    await userEvent.click(within(section).getByRole('radio', { name: new RegExp(W.all.label) }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.adminReach).toBe('all'));
    expect(await screen.findByText(W.saved)).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByRole('radio', { name: new RegExp(W.all.label) })).toHaveAttribute('aria-checked', 'true'));
    await userEvent.click(within(section).getByRole('radio', { name: new RegExp(W.mine.label) }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.adminReach).toBe('mine'));
  });

  it('shows the stored choice', async () => {
    await renderWithRuntime(<AdminReachSection />, (state) => {
      state.users.usr_001.preferences.adminReach = 'mine';
    });
    const section = await sectionOf();
    expect(within(section).getByRole('radio', { name: new RegExp(W.mine.label) })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves the choice with the arrow keys', async () => {
    const { store } = await renderWithRuntime(<AdminReachSection />);
    const section = await sectionOf();
    within(section).getByRole('radio', { name: new RegExp(W.mixed.label) }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(store.state.users.usr_001.preferences.adminReach).toBe('all'));
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    await waitFor(() => expect(store.state.users.usr_001.preferences.adminReach).toBe('mine'));
  });

  it('is not there for a Member or a person of Management', async () => {
    for (const person of ['usr_002', 'usr_003']) {
      const { unmount } = await renderWithRuntime(<AdminReachSection />, (state) => {
        state.session.currentUserId = person;
        state.users[person].systemRole = person === 'usr_002' ? 'management' : 'member';
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(screen.queryByRole('radiogroup'), person).toBeNull();
      unmount();
    }
  });

  it('reads in Arabic', async () => {
    await renderWithRuntime(<div dir="rtl"><AdminReachSection /></div>);
    const words = initI18n('ar');
    const section = (await screen.findByRole('heading', { name: words.t('adminReach.title') })).closest('section')!;
    expect(within(section).getAllByRole('radio')).toHaveLength(3);
    expect(WAR.title).toBe('ما يصلك');
  });
});

describe('the Settings screen', () => {
  it('has the section for the Admin, before the notification switches, and not for a Member', async () => {
    await renderApp('/settings');
    const title = await screen.findByRole('heading', { name: W.title });
    const notices = await screen.findByRole('heading', { name: en.settings.notifications });
    expect(title.compareDocumentPosition(notices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    await renderApp('/settings', (state) => {
      state.session.currentUserId = 'usr_003';
    });
    await screen.findByRole('heading', { name: en.settings.notifications });
    expect(screen.queryByRole('heading', { name: W.title })).toBeNull();
  });
});
