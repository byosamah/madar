import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildSeed } from '../../data/seed';
import { initI18n } from '../../i18n';
import { PictureFrame } from '../../components/PictureFrame';
import { DEFAULT_CROP } from '../../lib/picture';
import { TODAY } from '../../test/factories';
import { renderWithRuntime } from '../../test/render';
import { BareProvider } from './bare';
import { NotificationsSection } from './NotificationsSection';
import { PasswordSection } from './PasswordSection';
import { ProfileSection } from './ProfileSection';

// The remote build: the Password section and the Morning summary exist only there.
vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }));

afterEach(() => {
  vi.unstubAllGlobals();
  initI18n('en');
});

describe('the bare mode of the Settings parts (Me sub-pages)', () => {
  it('keeps the h2 of a section on the desk and hides it in bare mode', async () => {
    const desk = await renderWithRuntime(<PasswordSection />);
    const heading = await screen.findByRole('heading', { level: 2, name: 'Password' });
    expect(heading).not.toHaveClass('sr-only');
    desk.unmount();

    await renderWithRuntime(<BareProvider><PasswordSection /></BareProvider>);
    const bare = await screen.findByRole('heading', { level: 2, name: 'Password' });
    expect(bare).toHaveClass('sr-only');
  });

  it('hides the h2 of the profile in bare mode', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    await renderWithRuntime(<BareProvider><ProfileSection user={state.users.usr_001} /></BareProvider>);
    expect(document.getElementById('settings-profile')).toHaveClass('sr-only');
  });

  it('keeps the h2 of the profile on the desk', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    await renderWithRuntime(<ProfileSection user={state.users.usr_001} />);
    expect(document.getElementById('settings-profile')).not.toHaveClass('sr-only');
  });

  it('leaves the Morning summary out of Notifications in bare mode only', async () => {
    const desk = await renderWithRuntime(<NotificationsSection />);
    expect(await screen.findByRole('switch', { name: 'Morning summary' })).toBeInTheDocument();
    desk.unmount();

    await renderWithRuntime(<BareProvider><NotificationsSection /></BareProvider>);
    await screen.findByRole('heading', { level: 2, name: 'Notifications' });
    expect(screen.queryByRole('switch', { name: 'Morning summary' })).toBeNull();
  });

  it('makes the column names sticky in bare mode only', async () => {
    const desk = await renderWithRuntime(<NotificationsSection />);
    expect(await screen.findByText('In app')).not.toHaveClass('sticky');
    desk.unmount();

    await renderWithRuntime(<BareProvider><NotificationsSection /></BareProvider>);
    expect(await screen.findByText('In app')).toHaveClass('sticky');
  });

  it('gives the password button the full width on a phone', async () => {
    await renderWithRuntime(<PasswordSection />);
    expect(await screen.findByRole('button', { name: 'Change the password' })).toHaveClass('max-sm:w-full');
  });

  it('marks the picture frame as no drag area for the sheet', () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:frame', revokeObjectURL: () => undefined }));
    render(
      <PictureFrame
        file={new File(['x'], 'a.png', { type: 'image/png' })}
        crop={DEFAULT_CROP}
        onCrop={() => undefined}
        plate="#fff"
        words={{ group: 'Frame', hint: 'Drag the picture.', zoom: 'Zoom', preview: 'Preview' }}
        previews={() => null}
      />,
    );
    expect(screen.getByRole('img', { name: 'Drag the picture.' })).toHaveAttribute('data-vaul-no-drag');
  });
});
