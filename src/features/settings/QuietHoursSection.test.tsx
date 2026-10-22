import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../i18n';
import { ar, en } from '../../i18n/trees';
import { renderApp, renderWithRuntime } from '../../test/render';
import { QuietHoursSection } from './QuietHoursSection';

afterEach(() => {
  cleanup();
  initI18n('en');
});

type Words = { title: string; switch: string; hint: string; days: string; from: string; to: string; saved: string };
const W = (en as unknown as { quietHours: Words }).quietHours;
const sectionOf = async (title = W.title) => (await screen.findByRole('heading', { name: title })).closest('section')!;
const day = (section: HTMLElement, name: string) => within(section).getByRole('button', { name });

/** Quiet hours (owner, 2026-10-22, fbk_048). Hala (usr_001) is the Admin of the sample office, Faisal (usr_002) is not. */
describe('the Quiet hours section of Settings', () => {
  it('shows the switch on, the seven days from Sunday, the two times, and the line of the lock, by default', async () => {
    await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    expect(within(section).getByRole('switch', { name: W.switch })).toHaveAttribute('aria-checked', 'true');
    expect(within(section).getByText(W.hint)).toBeInTheDocument();
    const days = within(section).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(days).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    for (const name of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday']) expect(day(section, name)).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Friday', 'Saturday']) expect(day(section, name)).toHaveAttribute('aria-pressed', 'false');
    expect(within(section).getByLabelText(W.from)).toHaveValue('09:00');
    expect(within(section).getByLabelText(W.to)).toHaveValue('17:00');
    expect(within(section).getByText('Your office keeps notifications on Sunday to Thursday, 9:00 AM to 5:00 PM.')).toBeInTheDocument();
  });

  it('locks the days of the lock, and offers only times outside the lock', async () => {
    await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    for (const name of ['Sunday', 'Thursday']) expect(day(section, name)).toBeDisabled();
    expect(day(section, 'Friday')).toBeEnabled();
    const from = within(section).getByLabelText(W.from) as HTMLSelectElement;
    const to = within(section).getByLabelText(W.to) as HTMLSelectElement;
    const values = (select: HTMLSelectElement) => [...select.options].map((option) => option.value);
    expect(values(from)[0]).toBe('06:00');
    expect(values(from).at(-1)).toBe('09:00');
    expect(values(to)[0]).toBe('17:00');
    expect(values(to).at(-1)).toBe('23:30');
    expect(from.options[0].textContent).toBe('6:00 AM');
  });

  it('saves a day at once, with a toast, and keeps the lock days in the range', async () => {
    const { store } = await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    await userEvent.click(day(section, 'Friday'));
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours).toEqual({ quiet: true, days: [0, 1, 2, 3, 4, 5], from: '09:00', to: '17:00' }));
    expect(await screen.findByText(W.saved)).toBeInTheDocument();
    await waitFor(() => expect(day(section, 'Friday')).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(day(section, 'Friday'));
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.days).toEqual([0, 1, 2, 3, 4]));
  });

  it('saves a new start and a new end', async () => {
    const { store } = await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    await userEvent.selectOptions(within(section).getByLabelText(W.from), '07:30');
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.from).toBe('07:30'));
    await userEvent.selectOptions(within(section).getByLabelText(W.to), '20:00');
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.to).toBe('20:00'));
  });

  it('turns quiet hours off at once, hides the day and time controls, and turns them on again', async () => {
    const { store } = await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    await userEvent.click(within(section).getByRole('switch', { name: W.switch }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.quiet).toBe(false));
    await waitFor(() => expect(within(section).queryByLabelText(W.from)).toBeNull());
    expect(within(section).queryByRole('button')).toBeNull();
    await userEvent.click(within(section).getByRole('switch', { name: W.switch }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.quiet).toBe(true));
    expect(await within(section).findByLabelText(W.from)).toBeInTheDocument();
  });

  it('frees the days and the times while the Admin has the lock off, and drops the line of the lock', async () => {
    const { store } = await renderWithRuntime(<QuietHoursSection />, (state) => {
      state.settings.workHours = { days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00', lock: { on: false, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' } };
    });
    const section = await sectionOf();
    expect(day(section, 'Sunday')).toBeEnabled();
    expect(within(section).queryByText(/keeps notifications on/)).toBeNull();
    await userEvent.click(day(section, 'Monday'));
    await userEvent.click(day(section, 'Tuesday'));
    await userEvent.selectOptions(within(section).getByLabelText(W.from), '11:00');
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours).toMatchObject({ days: [0, 3, 4], from: '11:00' }));
  });

  it('never turns off the last work day', async () => {
    const { store } = await renderWithRuntime(<QuietHoursSection />, (state) => {
      state.settings.workHours = { days: [0], from: '09:00', to: '17:00', lock: { on: false, days: [0], from: '09:00', to: '17:00' } };
    });
    const section = await sectionOf();
    expect(day(section, 'Sunday')).toBeDisabled();
    expect(store.state.users.usr_001.preferences.workHours).toBeUndefined();
  });

  it('shows the stored choice of the person, and widens it to the lock the Admin set later', async () => {
    await renderWithRuntime(<QuietHoursSection />, (state) => {
      state.users.usr_001.preferences.workHours = { quiet: true, days: [0, 1], from: '10:00', to: '14:00' };
    });
    const section = await sectionOf();
    // The days and the times of the lock stay in the range that the screen shows.
    for (const name of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday']) expect(day(section, name)).toHaveAttribute('aria-pressed', 'true');
    expect(within(section).getByLabelText(W.from)).toHaveValue('09:00');
    expect(within(section).getByLabelText(W.to)).toHaveValue('17:00');
  });

  it('reads in Arabic, with the days from Sunday and the 12-hour words', async () => {
    await renderWithRuntime(<div dir="rtl"><QuietHoursSection /></div>);
    const words = initI18n('ar');
    const title = words.t('quietHours.title');
    const section = await sectionOf(title);
    expect(title).toBe('ساعات الهدوء');
    expect(within(section).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']);
    expect(within(section).getByRole('switch', { name: words.t('quietHours.switch') })).toBeInTheDocument();
    expect(within(section).getByText(/يُبقي مكتبك الإشعارات مفعّلة: الأحد إلى الخميس/)).toBeInTheDocument();
    expect((ar as unknown as { quietHours: Words }).quietHours.hint).toContain('الجرس');
  });
});

describe('the Settings screen', () => {
  it('has the Quiet hours section after the notices and for every role', async () => {
    for (const person of ['usr_001', 'usr_003']) {
      await renderApp('/settings', (state) => {
        state.session.currentUserId = person;
      });
      const quiet = await screen.findByRole('heading', { name: W.title });
      const notices = await screen.findByRole('heading', { name: en.settings.notifications });
      expect(notices.compareDocumentPosition(quiet) & Node.DOCUMENT_POSITION_FOLLOWING, person).toBeTruthy();
      cleanup();
    }
  });
});
