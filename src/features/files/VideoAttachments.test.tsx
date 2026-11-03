import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MadarApi } from '../../api/calls';
import type { Attachment } from '../../api/contract/views';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { initI18n } from '../../i18n';
import { AttachmentList } from './PictureAttachments';

const file = (id: string, name: string | null, mimeType?: string): Attachment => ({ id, name, ...(mimeType ? { mimeType } : {}) });
const CLIP = file('fil_101', 'dome-test-03.mp4', 'video/mp4');
const PHONE_CLIP = file('fil_102', 'Site walk.mov', 'video/quicktime');
const MKV = file('fil_103', 'Render.mkv', 'video/x-matroska');
const PHOTO = file('fil_104', 'Site photo.jpg', 'image/jpeg');

type Call = { name: string; input: Record<string, unknown> };

/** The list in the real build: files.link signs a new link on each call, and the stub records every call. */
function renderList(files: Attachment[]) {
  const calls: Call[] = [];
  let n = 0;
  const api = {
    call: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'files.link') {
        n += 1;
        return { url: `https://store.test/${input.disposition}-${input.variant}-${input.id}-${n}`, expiresAt: 'x', name: 'x.mp4', mimeType: 'video/mp4', size: 1 };
      }
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  const runtime: Runtime = { api, mode: 'remote' };
  const view = render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient({ remote: true })}>
      <ToastProvider><AttachmentList files={files} /></ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, calls, links: () => calls.filter((c) => c.name === 'files.link').map((c) => c.input) };
}

beforeEach(() => {
  initI18n('en');
});

describe('a video in a message or a comment (owner, 2026-11-03)', () => {
  it('shows a video as a tile with its first frame and a play mark, not as a chip that downloads', async () => {
    const { links } = renderList([CLIP]);
    const tile = await screen.findByRole('button', { name: 'Play dome-test-03.mp4' });
    expect(tile).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByRole('button', { name: 'Download dome-test-03.mp4' })).toBeNull();
    const list = screen.getByRole('list', { name: 'Videos' });
    await waitFor(() => expect(list.querySelector('video')).not.toBeNull());
    const video = list.querySelector('video') as HTMLVideoElement;
    // The first frame: the inline link with a start mark. The fragment never reaches the store, so the signature stays good.
    expect(video.getAttribute('src')).toBe('https://store.test/inline-full-fil_101-1#t=0.1');
    // Only the first bytes load until a press, so a chat scroll does not spend the mobile data of a phone.
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video).toHaveAttribute('playsinline');
    expect(video.muted).toBe(true);
    expect(video).not.toHaveAttribute('controls');
    expect(video).not.toHaveAttribute('autoplay');
    // A file video holds client work and its signed link: the replay shows a gray box (insight design, section 5).
    expect(video).toHaveClass('ph-no-capture');
    // One inline link of the full file. A video has no small picture.
    expect(links()).toEqual([{ id: 'fil_101', letter: undefined, variant: 'full', disposition: 'inline' }]);
  });

  it('plays the video over the whole screen on a press, with the same link, Close and Download', async () => {
    const user = userEvent.setup();
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.href); });
    const { links } = renderList([CLIP]);
    await user.click(await screen.findByRole('button', { name: 'Play dome-test-03.mp4' }));
    const dialog = await screen.findByRole('dialog', { name: 'dome-test-03.mp4' });
    const player = dialog.querySelector('video') as HTMLVideoElement;
    expect(player).not.toBeNull();
    expect(player.getAttribute('src')).toBe('https://store.test/inline-full-fil_101-1');
    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('playsinline');
    expect(player).toHaveClass('ph-no-capture');
    // The tile and the player share one signed link: the press asks for no new link.
    expect(links()).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Download dome-test-03.mp4' }));
    await waitFor(() => expect(clicks).toEqual(['https://store.test/attachment-full-fil_101-2']));
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    vi.restoreAllMocks();
  });

  it('plays a QuickTime video of a phone too, and keeps a video type that the server sends as a download as a chip', async () => {
    renderList([PHONE_CLIP, MKV]);
    expect(await screen.findByRole('button', { name: 'Play Site walk.mov' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Render.mkv' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play Render.mkv' })).toBeNull();
  });

  it('shows the pictures first, then the video, and one "Download all" for every file', async () => {
    renderList([CLIP, PHOTO]);
    const picture = await screen.findByRole('button', { name: 'View Site photo.jpg' });
    const video = screen.getByRole('button', { name: 'Play dome-test-03.mp4' });
    expect(picture.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download all (2)' })).toBeInTheDocument();
  });

  it('turns a video that cannot load into a chip that downloads, after one new link', async () => {
    const { links } = renderList([CLIP]);
    const list = await screen.findByRole('list', { name: 'Videos' });
    await waitFor(() => expect(list.querySelector('video')).not.toBeNull());
    fireEvent.error(list.querySelector('video') as HTMLVideoElement);
    await waitFor(() => expect(list.querySelector('video')?.getAttribute('src')).toBe('https://store.test/inline-full-fil_101-2#t=0.1'));
    fireEvent.error(list.querySelector('video') as HTMLVideoElement);
    expect(await screen.findByRole('button', { name: 'Download dome-test-03.mp4' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play dome-test-03.mp4' })).toBeNull();
    expect(links()).toHaveLength(2);
  });

  it('says so in the player when the video cannot play there, and keeps Download', async () => {
    const user = userEvent.setup();
    renderList([CLIP]);
    await user.click(await screen.findByRole('button', { name: 'Play dome-test-03.mp4' }));
    const dialog = await screen.findByRole('dialog', { name: 'dome-test-03.mp4' });
    fireEvent.error(dialog.querySelector('video') as HTMLVideoElement);
    await waitFor(() => expect(dialog.querySelector('video')?.getAttribute('src')).toBe('https://store.test/inline-full-fil_101-2'));
    fireEvent.error(dialog.querySelector('video') as HTMLVideoElement);
    expect(await within(dialog).findByText('This video cannot play here. Download it to watch it.')).toBeInTheDocument();
    expect(dialog.querySelector('video')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Download dome-test-03.mp4' })).toBeInTheDocument();
  });
});
