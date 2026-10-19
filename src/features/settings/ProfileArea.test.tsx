import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../i18n';
import { PictureError, pictureOf } from '../../lib/picture';
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
  it('frames a new picture, saves it with Save, shows it, and takes it off again with Remove picture', async () => {
    made.next = null;
    const { store } = await renderApp('/settings');
    const region = await screen.findByRole('region', { name: 'Profile' });
    expect(within(region).queryByRole('button', { name: 'Remove picture' })).toBeNull();
    await userEvent.upload(within(region).getByLabelText('Choose a picture'), file());
    // The picture does not save at once: the frame step comes first (fbk_029).
    const sheet = await screen.findByRole('dialog', { name: 'Frame your picture' });
    expect(store.state.users.usr_001.avatarUrl).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.users.usr_001.avatarUrl).toBe(PICTURE));
    expect(await screen.findByText('Picture saved.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Frame your picture' })).toBeNull());
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
    const sheet = await screen.findByRole('dialog', { name: 'Frame your picture' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Madar cannot read this picture. Choose a JPEG, PNG or WebP picture.')).toBeInTheDocument();
    expect(store.state.users.usr_001.avatarUrl).toBeNull();
    made.next = null;
  });

  it('closes the frame step and says so when the browser cannot load the picture at all', async () => {
    made.next = null;
    const { store } = await renderApp('/settings');
    const region = await screen.findByRole('region', { name: 'Profile' });
    await userEvent.upload(within(region).getByLabelText('Choose a picture'), file());
    const sheet = await screen.findByRole('dialog', { name: 'Frame your picture' });
    fireEvent.error(within(sheet).getByRole('group', { name: 'Frame your picture' }).querySelector('img')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Frame your picture' })).toBeNull());
    expect(await within(region).findByText('Madar cannot read this picture. Choose a JPEG, PNG or WebP picture.')).toBeInTheDocument();
    expect(store.state.users.usr_001.avatarUrl).toBeNull();
  });

  it('keeps the frame step open when the picture does not fit in 16 KB, so the person can zoom and try again', async () => {
    made.next = () => Promise.reject(new PictureError('too_big'));
    await renderApp('/settings');
    const region = await screen.findByRole('region', { name: 'Profile' });
    await userEvent.upload(within(region).getByLabelText('Choose a picture'), file());
    const sheet = await screen.findByRole('dialog', { name: 'Frame your picture' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Madar cannot make this picture small enough. Choose another picture.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Frame your picture' })).toBeInTheDocument();
    made.next = null;
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Frame your picture' })).toBeNull());
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

describe('the frame of a profile picture (fbk_029, owner 2026-10-23)', () => {
  /** Opens the frame step with a file whose browser size is 400 by 200, as the browser tells it when the picture has loaded. */
  async function openFrame() {
    made.next = null;
    vi.mocked(pictureOf).mockClear();
    const view = await renderApp('/settings');
    const region = await screen.findByRole('region', { name: 'Profile' });
    const chosen = file();
    await userEvent.upload(within(region).getByLabelText('Choose a picture'), chosen);
    const sheet = await screen.findByRole('dialog', { name: 'Frame your picture' });
    const frame = within(sheet).getByRole('group', { name: 'Frame your picture' });
    const image = frame.querySelector('img')!;
    Object.defineProperty(image, 'naturalWidth', { value: 400, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: 200, configurable: true });
    fireEvent.load(image);
    return { ...view, sheet, frame, chosen, region };
  }

  it('starts as the centre square, as the picture always was, and shows the picture round at the sizes where it appears', async () => {
    const { sheet, frame, chosen } = await openFrame();
    expect(within(sheet).getByText('How it looks in Madar')).toBeInTheDocument();
    // The big frame, then the previews at the sizes of Settings (72), the chat header (40) and the bubbles (24).
    const circles = [...frame.querySelectorAll<HTMLElement>('span.rounded-full')].map((circle) => circle.style.width);
    expect(circles).toEqual(['72px', '40px', '24px']);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(pictureOf).toHaveBeenCalledWith(chosen, { crop: { zoom: 2, cx: 0.5, cy: 0.5 } }));
  });

  it('zooms with the slider, and saves the picture from the frame that the person made', async () => {
    const { sheet, frame, chosen } = await openFrame();
    fireEvent.change(within(frame).getByRole('slider', { name: 'Zoom' }), { target: { value: '3' } });
    expect(within(frame).getByRole('slider', { name: 'Zoom' })).toHaveValue('3');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(pictureOf).toHaveBeenCalledWith(chosen, { crop: { zoom: 3, cx: 0.5, cy: 0.5 } }));
  });

  it('moves the picture with the arrow keys on the frame, as the drag does, and keeps the move in the saved picture', async () => {
    const { sheet, frame, chosen } = await openFrame();
    const circle = within(frame).getByRole('img', { name: 'Drag the picture to move it. Use the slider to zoom.' });
    fireEvent.keyDown(circle, { key: 'ArrowRight' });
    fireEvent.keyDown(circle, { key: 'ArrowDown' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(pictureOf).toHaveBeenCalled());
    const crop = vi.mocked(pictureOf).mock.calls.at(-1)![1]!.crop!;
    expect(crop.zoom).toBe(2);
    // An arrow right pushes the picture to the right, so the window moves left on the picture. An arrow down moves the window up.
    expect(crop.cx).toBeLessThan(0.5);
    expect(crop.cy).toBeLessThan(0.5);
    expect(vi.mocked(pictureOf).mock.calls.at(-1)![0]).toBe(chosen);
  });

  it('saves nothing with Cancel, and the picture of the person stays', async () => {
    const { sheet, store } = await openFrame();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Frame your picture' })).toBeNull());
    expect(pictureOf).not.toHaveBeenCalled();
    expect(store.state.users.usr_001.avatarUrl).toBeNull();
  });

  it('starts again with the next file: the frame of the first file does not carry over', async () => {
    const { sheet, frame, region } = await openFrame();
    fireEvent.change(within(frame).getByRole('slider', { name: 'Zoom' }), { target: { value: '3' } });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Frame your picture' })).toBeNull());
    await userEvent.upload(within(region).getByLabelText('Choose a picture'), new File(['again'], 'second.png', { type: 'image/png' }));
    const next = await screen.findByRole('dialog', { name: 'Frame your picture' });
    expect(within(next).getByRole('slider', { name: 'Zoom' })).toHaveValue('1');
  });
});
