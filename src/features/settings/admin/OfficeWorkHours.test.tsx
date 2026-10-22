import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../../i18n';
import { en } from '../../../i18n/trees';
import { renderWithRuntime } from '../../../test/render';
import { OfficeSection } from './OfficeSection';

afterEach(() => {
  cleanup();
  initI18n('en');
});

type Words = { title: string; lock: string; defaultTitle: string };
const W = (en as unknown as { admin: { workHours: Words } }).admin.workHours;

const officeOf = async () => screen.findByRole('region', { name: 'Office settings' });
const lockSwitch = (office: HTMLElement) => within(office).getByRole('switch', { name: W.lock });

/** The Admin block "Work hours" of the office settings (owner, 2026-10-22, fbk_048). */
describe('the Work hours block of the office settings', () => {
  it('shows the default range and the lock switch on, with the same days and hours, from the built-in default', async () => {
    await renderWithRuntime(<OfficeSection />);
    const office = await officeOf();
    await within(office).findByText(W.defaultTitle);
    expect(lockSwitch(office)).toHaveAttribute('aria-checked', 'true');
    // Two ranges: the default of a person, and the lock.
    expect(within(office).getAllByRole('group', { name: 'Days' })).toHaveLength(2);
    expect(office.querySelector('#office-default-from')).toHaveValue('09:00');
    expect(office.querySelector('#office-default-to')).toHaveValue('17:00');
    expect(office.querySelector('#office-lock-range-from')).toHaveValue('09:00');
    expect(office.querySelector('#office-lock-range-to')).toHaveValue('17:00');
    expect(office.querySelector('#office-lock-range-day-0')).toHaveAttribute('aria-pressed', 'true');
    expect(office.querySelector('#office-lock-range-day-5')).toHaveAttribute('aria-pressed', 'false');
    expect(office.querySelector('#office-default-day-0')).toBeDisabled();
  });

  it('saves a new default range with the other settings', async () => {
    const { store } = await renderWithRuntime(<OfficeSection />);
    const office = await officeOf();
    await within(office).findByText(W.defaultTitle);
    await userEvent.click(office.querySelector('#office-lock-range-day-4') as HTMLElement);
    await userEvent.selectOptions(office.querySelector('#office-default-from') as HTMLElement, '08:00');
    await userEvent.selectOptions(office.querySelector('#office-default-to') as HTMLElement, '18:00');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    await waitFor(() => expect(store.state.settings.workHours).toEqual({
      days: [0, 1, 2, 3, 4], from: '08:00', to: '18:00', lock: { on: true, days: [0, 1, 2, 3], from: '09:00', to: '17:00' },
    }));
    expect(store.state.settings.workloadLimit).toBe(10);
  });

  it('widens the default range when the lock grows, so the range always holds the lock', async () => {
    const { store } = await renderWithRuntime(<OfficeSection />);
    const office = await officeOf();
    await within(office).findByText(W.defaultTitle);
    await userEvent.click(office.querySelector('#office-lock-range-day-5') as HTMLElement);
    await userEvent.selectOptions(office.querySelector('#office-lock-range-from') as HTMLElement, '08:00');
    expect(office.querySelector('#office-default-day-5')).toHaveAttribute('aria-pressed', 'true');
    expect(office.querySelector('#office-default-from')).toHaveValue('08:00');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    await waitFor(() => expect(store.state.settings.workHours?.lock).toEqual({ on: true, days: [0, 1, 2, 3, 4, 5], from: '08:00', to: '17:00' }));
    expect(store.state.settings.workHours).toMatchObject({ days: [0, 1, 2, 3, 4, 5], from: '08:00' });
  });

  it('turns the lock off, hides its controls, frees the default range, and saves it', async () => {
    const { store } = await renderWithRuntime(<OfficeSection />);
    const office = await officeOf();
    await within(office).findByText(W.defaultTitle);
    await userEvent.click(lockSwitch(office));
    expect(office.querySelector('#office-lock-range-from')).toBeNull();
    expect(office.querySelector('#office-default-day-0')).toBeEnabled();
    await userEvent.selectOptions(office.querySelector('#office-default-from') as HTMLElement, '11:00');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    await waitFor(() => expect(store.state.settings.workHours).toMatchObject({ from: '11:00', lock: { on: false } }));
  });

  it('shows the stored default and lock', async () => {
    await renderWithRuntime(<OfficeSection />, (state) => {
      state.settings.workHours = { days: [0, 1, 2, 3, 4, 5], from: '08:00', to: '18:00', lock: { on: false, days: [0, 1], from: '10:00', to: '12:00' } };
    });
    const office = await officeOf();
    await within(office).findByText(W.defaultTitle);
    expect(lockSwitch(office)).toHaveAttribute('aria-checked', 'false');
    expect(office.querySelector('#office-default-from')).toHaveValue('08:00');
    expect(office.querySelector('#office-default-day-5')).toHaveAttribute('aria-pressed', 'true');
  });
});
