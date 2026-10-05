import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../i18n';
import { PictureError } from '../../lib/picture';
import { renderApp } from '../../test/render';

const PICTURE = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const made = vi.hoisted(() => ({ next: null as null | (() => Promise<string>) }));

// jsdom has no canvas, so the cut of the picture is a stand-in here. lib/picture.test.ts tests the real steps.
vi.mock('../../lib/picture', async (original) => ({
  ...(await original<typeof import('../../lib/picture')>()),
  pictureOf: vi.fn(() => (made.next ? made.next() : Promise.resolve(PICTURE))),
}));

const file = () => new File(['picture'], 'me.jpg', { type: 'image/jpeg' });

/** The profile area at the top of Settings (owner items 10 and 12, 2026-10-05). */
describe('the profile area', () => {
  it('saves a new picture at once, shows it, and takes it off again with Remove picture', async () => {
    made.next = null;
    const { store } = await renderApp('/settings');
    const region = await screen.findByRole('region', { name: 'Profile' });
    expect(within(region).queryByRole('button', { name: 'Remove picture' })).toBeNull();
    await userEvent.upload(within(region).getByLabelText('Choose a picture'), file());
    await waitFor(() => expect(store.state.users.usr_001.avatarUrl).toBe(PICTURE));
    expect(await screen.findByText('Picture saved.')).toBeInTheDocument();
    expect(within(region).getByRole('img', { name: 'Hala Nasser' })).toHaveAttribute('src', PICTURE);
    expect(within(region).getByRole('button', { name: 'Change picture' })).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Remove picture' }));
    await waitFor(() => expect(store.state.users.usr_001.avatarUrl).toBeNull());
    expect(await screen.findByText('Picture removed.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Add picture' })).toBeInTheDocument();
  });

  it('says so when the browser cannot read the picture, and saves nothing', async () => {
    made.next = () => Promise.reject(new PictureError('unreadable'));
    const { store } = await renderApp('/settings');
    const region = await screen.findByRole('region', { name: 'Profile' });
    await userEvent.upload(within(region).getByLabelText('Choose a picture'), file());
    expect(await within(region).findByText('Madar cannot read this picture. Choose a JPEG, PNG or WebP picture.')).toBeInTheDocument();
    expect(store.state.users.usr_001.avatarUrl).toBeNull();
    made.next = null;
  });

  it('edits both names; the English name is required, the Arabic name may stay empty', async () => {
    const { store } = await renderApp('/settings', (state) => {
      state.users.usr_001.nameAr = undefined;
    });
    const english = await screen.findByLabelText('Name in English');
    expect(english).toHaveAccessibleDescription(/required/i);
    const arabic = screen.getByLabelText('Name in Arabic');
    expect(arabic).toHaveValue('');
    await userEvent.type(arabic, 'هالة ناصر');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.users.usr_001.nameAr).toBe('هالة ناصر'));
    expect(store.state.users.usr_001.name).toBe('Hala Nasser');
  });

  it('shows the Arabic name on an Arabic screen, in the picture and in the person menu', async () => {
    await renderApp('/settings', (state) => {
      state.users.usr_001.preferences.language = 'ar';
      state.users.usr_001.nameAr = 'هالة ناصر';
    });
    try {
      const region = await screen.findByRole('region', { name: 'الملف الشخصي' });
      expect(within(region).getByRole('img', { name: 'هالة ناصر' })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'هالة ناصر' }).length).toBeGreaterThan(0);
    } finally {
      initI18n('en');
    }
  });

  it('shows a picture saved as data in a list whose person cards carry none (the office list gives it)', async () => {
    await renderApp('/projects/prj_001?tab=team', (state) => {
      state.users.usr_002.avatarUrl = PICTURE;
    });
    await screen.findAllByRole('img', { name: 'Faisal Al-Harbi' }, { timeout: 10_000 });
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Faisal Al-Harbi' }).some((img) => img.getAttribute('src') === PICTURE)).toBe(true));
  });
});
