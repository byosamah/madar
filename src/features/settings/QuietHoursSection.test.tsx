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

type Words = { title: string; switch: string; days: string; quietFrom: string; until: string; saved: string };
const W = (en as unknown as { quietHours: Words }).quietHours;
const sectionOf = async (title = W.title) => (await screen.findByRole('heading', { name: title })).closest('section')!;
const day = (section: HTMLElement, name: string) => within(section).getByRole('button', { name });

/** Quiet hours (owner, 2026-10-22, fbk_048). Hala (usr_001) is the Admin of the sample office, Faisal (usr_002) is not. */
describe('the Quiet hours section of Settings', () => {
  it('shows the switch on, the seven days from Sunday, the two times, and the line of the lock, by default', async () => {
    await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    expect(within(section).getByRole('switch', { name: W.switch })).toHaveAttribute('aria-checked', 'true');
    const days = within(section).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(days).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    for (const name of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday']) expect(day(section, name)).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Friday', 'Saturday']) expect(day(section, name)).toHaveAttribute('aria-pressed', 'false');
    expect(within(section).getByLabelText(W.until)).toHaveValue('08:00');
    expect(within(section).getByLabelText(W.quietFrom)).toHaveValue('17:00');
    expect(within(section).getByText('Your office keeps notifications on Sunday to Thursday, 8:00 AM to 5:00 PM.')).toBeInTheDocument();
  });

  it('locks the days of the lock, and offers only times outside the lock', async () => {
    await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    for (const name of ['Sunday', 'Thursday']) expect(day(section, name)).toBeDisabled();
    expect(day(section, 'Friday')).toBeEnabled();
    const from = within(section).getByLabelText(W.until) as HTMLSelectElement;
    const to = within(section).getByLabelText(W.quietFrom) as HTMLSelectElement;
    const values = (select: HTMLSelectElement) => [...select.options].map((option) => option.value);
    expect(values(from)[0]).toBe('06:00');
    expect(values(from).at(-1)).toBe('08:00');
    expect(values(to)[0]).toBe('17:00');
    expect(values(to).at(-1)).toBe('23:30');
    expect(from.options[0].textContent).toBe('6:00 AM');
  });

  it('saves a day at once, with a toast, and keeps the lock days in the range', async () => {
    const { store } = await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    await userEvent.click(day(section, 'Friday'));
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours).toEqual({ quiet: true, days: [0, 1, 2, 3, 4, 5], from: '08:00', to: '17:00' }));
    expect(await screen.findByText(W.saved)).toBeInTheDocument();
    await waitFor(() => expect(day(section, 'Friday')).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(day(section, 'Friday'));
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.days).toEqual([0, 1, 2, 3, 4]));
  });

  it('saves a new start and a new end', async () => {
    const { store } = await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    await userEvent.selectOptions(within(section).getByLabelText(W.until), '07:30');
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.from).toBe('07:30'));
    await userEvent.selectOptions(within(section).getByLabelText(W.quietFrom), '20:00');
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.to).toBe('20:00'));
  });

  it('turns quiet hours off at once, hides the day and time controls, and turns them on again', async () => {
    const { store } = await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    await userEvent.click(within(section).getByRole('switch', { name: W.switch }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.quiet).toBe(false));
    await waitFor(() => expect(within(section).queryByLabelText(W.until)).toBeNull());
    expect(within(section).queryByRole('button')).toBeNull();
    await userEvent.click(within(section).getByRole('switch', { name: W.switch }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.quiet).toBe(true));
    expect(await within(section).findByLabelText(W.until)).toBeInTheDocument();
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
    await userEvent.selectOptions(within(section).getByLabelText(W.until), '11:00');
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
    expect(within(section).getByLabelText(W.until)).toHaveValue('08:00');
    expect(within(section).getByLabelText(W.quietFrom)).toHaveValue('17:00');
  });

  it('reads in Arabic, with the days from Sunday and the 12-hour words', async () => {
    await renderWithRuntime(<div dir="rtl"><QuietHoursSection /></div>);
    const words = initI18n('ar');
    const title = words.t('quietHours.title');
    const section = await sectionOf(title);
    expect(title).toBe('متى يُنبّهك مدار');
    expect(within(section).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']);
    expect(within(section).getByRole('switch', { name: words.t('quietHours.switch') })).toBeInTheDocument();
    expect(within(section).getByText(/يُبقي مكتبك الإشعارات مفعّلة: الأحد إلى الخميس/)).toBeInTheDocument();
    expect(within(section).getByText('يهدأ مدار يوم الجمعة والسبت، ومن 5:00 م إلى 8:00 ص في أيام عملك. الجرس يحفظ كل شيء.')).toBeInTheDocument();
  });
});

/** fbk_049 (Faisal, 2026-10-22): the name said "quiet", the controls set the hours that notify, and the locked days looked off. */
describe('the section says when Madar notifies you, and when it is quiet', () => {
  it('names the hours that notify, and spells out the quiet time in one line', async () => {
    await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf('When Madar notifies you');
    expect(within(section).getByRole('switch', { name: 'Notify me only in my work hours' })).toHaveAttribute('aria-checked', 'true');
    expect(within(section).getByRole('group', { name: 'My work days' })).toBeInTheDocument();
    expect(within(section).getByText('Madar is quiet on Friday and Saturday, and from 5:00 PM to 8:00 AM on your work days. The bell keeps everything.')).toBeInTheDocument();
  });

  it('keeps the look of a picked day on a day the office locks, with a small lock', async () => {
    await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf('When Madar notifies you');
    const sunday = day(section, 'Sunday');
    expect(sunday).toHaveAttribute('aria-pressed', 'true');
    expect(sunday.className).not.toMatch(/opacity/);
    expect(within(sunday).getByRole('img', { name: 'The office keeps notifications on this day.' })).toBeInTheDocument();
    expect(within(day(section, 'Friday')).queryByRole('img')).toBeNull();
  });

  it('says "every day" when every day is a work day, and "at any time" with the switch off', async () => {
    await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf('When Madar notifies you');
    await userEvent.click(day(section, 'Friday'));
    await userEvent.click(day(section, 'Saturday'));
    expect(await within(section).findByText('Madar is quiet every day from 5:00 PM to 8:00 AM. The bell keeps everything.')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('switch', { name: 'Notify me only in my work hours' }));
    expect(await within(section).findByText('Madar notifies you at any time.')).toBeInTheDocument();
  });
});

/** fbk_051 (Faisal, 2026-10-22): the fields read "From 7:00 AM, To 11:30 PM" over the line "quiet from 11:30 PM to 7:00 AM". */
describe('the two times read in the order of the quiet line', () => {
  it('shows "Quiet from" (the end of work) first and "Until" (the start of work) second', async () => {
    await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    const quietFrom = within(section).getByLabelText('Quiet from');
    const until = within(section).getByLabelText('Until');
    expect(quietFrom).toHaveValue('17:00');
    expect(until).toHaveValue('08:00');
    expect(quietFrom.compareDocumentPosition(until) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section).getByText('Madar is quiet on Friday and Saturday, and from 5:00 PM to 8:00 AM on your work days. The bell keeps everything.')).toBeInTheDocument();
  });

  it('saves "Quiet from" as the end of the work hours, and "Until" as their start', async () => {
    const { store } = await renderWithRuntime(<QuietHoursSection />);
    const section = await sectionOf();
    await userEvent.selectOptions(within(section).getByLabelText('Quiet from'), '23:30');
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.to).toBe('23:30'));
    await userEvent.selectOptions(within(section).getByLabelText('Until'), '07:00');
    await waitFor(() => expect(store.state.users.usr_001.preferences.workHours?.from).toBe('07:00'));
  });

  it('reads in Arabic', async () => {
    await renderWithRuntime(<div dir="rtl"><QuietHoursSection /></div>);
    const words = initI18n('ar');
    const section = await sectionOf(words.t('quietHours.title'));
    expect(within(section).getByLabelText('الهدوء من')).toHaveValue('17:00');
    expect(within(section).getByLabelText('حتى')).toHaveValue('08:00');
  });
});

describe("What's new of fbk_049", () => {
  it('has the line about the clearer words at the top, dated on its release day, with the Settings link', async () => {
    const { WHATS_NEW } = await import('../../whatsNew/entries');
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-96')).toEqual({ id: '2026-10-23-96', day: '2026-10-22', to: '/settings' });
    for (const tree of [en, ar]) {
      const item = (tree as unknown as { whatsNew: { items: Record<string, { body: string }> } }).whatsNew.items['2026-10-23-96'];
      expect(item.body).toMatch(/8:00/);
    }
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
