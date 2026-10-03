import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TRIGGERS } from '../../api/contract/entities';
import { initI18n } from '../../i18n';
import { en } from '../../i18n/trees';
import { renderWithRuntime } from '../../test/render';
import { NotificationsSection } from './NotificationsSection';

describe('the Notifications section (moved out of Settings, plan T0.4)', () => {
  it('shows the same switches as before: one for each trigger, with the person\'s choices', async () => {
    await renderWithRuntime(<NotificationsSection />, (state) => {
      state.users.usr_001.preferences.notifications.overdue = false;
    });
    const section = (await screen.findByRole('heading', { name: en.settings.notifications })).closest('section')!;
    const switches = within(section).getAllByRole('switch');
    expect(switches).toHaveLength(TRIGGERS.length);
    for (const trigger of TRIGGERS) {
      const toggle = within(section).getByRole('switch', { name: en.settings.triggers[trigger] });
      expect(toggle).toHaveAttribute('aria-checked', trigger === 'overdue' ? 'false' : 'true');
    }
  });

  it('saves a switch', async () => {
    const { store } = await renderWithRuntime(<NotificationsSection />);
    await userEvent.click(await screen.findByRole('switch', { name: en.settings.triggers.mention }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.notifications.mention).toBe(false));
  });

  it('reads right to left in Arabic', async () => {
    await renderWithRuntime(<div dir="rtl"><NotificationsSection /></div>);
    const ar = initI18n('ar');
    const section = (await screen.findByRole('heading', { name: ar.t('settings.notifications') })).closest('section')!;
    expect(within(section).getByRole('switch', { name: ar.t('settings.triggers.mention') })).toBeInTheDocument();
    initI18n('en');
  });
});
