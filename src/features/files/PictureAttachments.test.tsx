import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MadarApi } from '../../api/calls';
import type { Attachment } from '../../api/contract/views';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { initI18n } from '../../i18n';
import { AttachmentList, isFileNamesBody } from './PictureAttachments';

const file = (id: string, name: string | null, mimeType?: string): Attachment => ({ id, name, ...(mimeType ? { mimeType } : {}) });
const PHOTO = file('fil_001', 'Site photo.jpg', 'image/jpeg');
const SECOND = file('fil_002', 'Level 2.png', 'image/png');
const THIRD = file('fil_003', 'Stair.webp', 'image/webp');
const PLAN = file('fil_004', 'Plan.pdf', 'application/pdf');

type Call = { name: string; input: Record<string, unknown> };

/**
 * The list in the real build (files.link signs a new link on each call) or in the prototype (files.get gives the stored data). The stub
 * records every call, so a test can say which links the screen asked for.
 */
function renderList(files: Attachment[], mode: 'remote' | 'prototype' = 'remote') {
  const calls: Call[] = [];
  let n = 0;
  const api = {
    call: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'files.link') {
        n += 1;
        return { url: `https://store.test/${input.variant}-${input.id}-${n}`, expiresAt: 'x', name: 'x.png', mimeType: 'image/png', size: 1 };
      }
      if (name === 'files.get') return { blob: new Blob(['x'], { type: 'image/png' }), file: { file: { name: 'x.png' } } };
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  initI18n('en');
  const runtime: Runtime = { api, mode };
  const view = render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient({ remote: mode === 'remote' })}>
      <ToastProvider><AttachmentList files={files} /></ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, calls, links: () => calls.filter((c) => c.name === 'files.link').map((c) => c.input) };
}

const previews = () => screen.queryAllByRole('button', { name: /^View / });

beforeEach(() => {
  initI18n('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('the files of a message or a comment (owner, 2026-10-19)', () => {
  it('shows a picture as a preview of its small picture, and any other file as a chip', async () => {
    const { container, links } = renderList([PHOTO, PLAN]);
    const preview = await screen.findByRole('button', { name: 'View Site photo.jpg' });
    await waitFor(() => expect(preview.querySelector('img')).toHaveAttribute('src', 'https://store.test/thumb-fil_001-1'));
    const img = preview.querySelector('img') as HTMLImageElement;
    // A file picture holds client work and its signed link: the replay shows a gray box (insight design, section 5).
    expect(img).toHaveClass('ph-no-capture');
    // Row pictures load and decode only near the view (src/CLAUDE.md).
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(screen.getByRole('button', { name: 'Preview Plan.pdf' })).toBeInTheDocument();
    // Only the picture asks for a link, and only for its small picture. The PDF asks for nothing until a press.
    expect(links()).toEqual([{ id: 'fil_001', letter: undefined, variant: 'thumb', disposition: 'inline' }]);
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('lets one picture shrink to a narrow bubble, so it never runs out of the bubble on a phone (fbk_040)', () => {
    renderList([PHOTO]);
    const list = screen.getByRole('list', { name: 'Pictures' });
    // A flex item keeps the width of its content unless it may shrink: the 240 px tile ran 50 px out of a bubble at 390 px.
    expect(list).toHaveClass('min-w-0', 'max-w-full');
    expect(list.querySelector('li')).toHaveClass('min-w-0', 'max-w-full');
  });

  it('shows a deleted file as removed, and a file with no known type as a chip', () => {
    renderList([file('fil_005', null), file('fil_006', 'Old.jpg')]);
    expect(screen.getByText('File removed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Old.jpg' })).toBeInTheDocument();
    expect(previews()).toHaveLength(0);
  });

  it('keeps an SVG as a chip in the real build, where the store sends it as a download, and previews it in the prototype', async () => {
    const svg = file('fil_007', 'Logo.svg', 'image/svg+xml');
    const real = renderList([svg], 'remote');
    expect(screen.getByRole('button', { name: 'Download Logo.svg' })).toBeInTheDocument();
    expect(previews()).toHaveLength(0);
    expect(real.links()).toEqual([]);
    real.unmount();
    renderList([svg], 'prototype');
    expect(await screen.findByRole('button', { name: 'View Logo.svg' })).toBeInTheDocument();
  });

  it('shows the picture from the stored data in the prototype', async () => {
    const { container, calls } = renderList([PHOTO], 'prototype');
    await screen.findByRole('button', { name: 'View Site photo.jpg' });
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:madar-test'));
    expect(calls.map((c) => c.name)).toEqual(['files.get']);
  });

  it('keeps a grey box of the right size while the picture loads, and the same shape when it has loaded', async () => {
    const { container } = renderList([PHOTO]);
    const preview = await screen.findByRole('button', { name: 'View Site photo.jpg' });
    expect(preview.parentElement).toHaveStyle({ aspectRatio: String(4 / 3) });
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    const img = container.querySelector('img') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 300 });
    Object.defineProperty(img, 'naturalHeight', { value: 400 });
    fireEvent.load(img);
    await waitFor(() => expect(preview.parentElement).toHaveStyle({ aspectRatio: String(3 / 4) }));
  });

  it('asks for a link only when the picture is near the view', async () => {
    let seen: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { seen = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const { links, container } = renderList([PHOTO]);
    await screen.findByRole('button', { name: 'View Site photo.jpg' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(links()).toEqual([]);
    expect(container.querySelector('img')).toBeNull();
    act(() => seen([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(links()).toHaveLength(1));
  });

  it('puts several pictures in a grid, with the other files after them as chips', async () => {
    const { container } = renderList([PHOTO, PLAN, SECOND, THIRD]);
    const grid = await screen.findByRole('list', { name: 'Pictures' });
    expect(within(grid).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['View Site photo.jpg', 'View Level 2.png', 'View Stair.webp']);
    expect(grid).toHaveClass('grid');
    expect(screen.getByRole('button', { name: 'Preview Plan.pdf' })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(3));
  });

  it('falls back to the chip of a picture that breaks again after its new link', async () => {
    const { container, links } = renderList([PHOTO, SECOND]);
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    const first = () => container.querySelector('img[src*="fil_001"]') as HTMLImageElement;
    fireEvent.error(first());
    await waitFor(() => expect(first().getAttribute('src')).toMatch(/fil_001-3$/));
    fireEvent.error(first());
    expect(await screen.findByRole('button', { name: 'Download Site photo.jpg' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Site photo.jpg' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View Level 2.png' })).toBeInTheDocument();
    expect(links().filter((l) => l.id === 'fil_001')).toHaveLength(2);
  });

  describe('the viewer', () => {
    it('opens on a press, with the name, Close and Download, and asks the full picture', async () => {
      const { links, container } = renderList([PHOTO]);
      await userEvent.click(await screen.findByRole('button', { name: 'View Site photo.jpg' }));
      const viewer = await screen.findByRole('dialog', { name: 'Site photo.jpg' });
      expect(within(viewer).getByRole('button', { name: 'Close' })).toBeInTheDocument();
      await waitFor(() => expect(links()).toContainEqual({ id: 'fil_001', letter: undefined, variant: 'full', disposition: 'inline' }));
      await waitFor(() => expect(viewer.querySelector('img[src^="https://store.test/full-fil_001"]')).not.toBeNull());
      // The small picture is the same link as the preview: the viewer asks for no second small link.
      expect(links().filter((l) => l.variant === 'thumb')).toHaveLength(1);
      expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
    });

    it('downloads the file with its name through a download link', async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      const { links } = renderList([PHOTO]);
      await userEvent.click(await screen.findByRole('button', { name: 'View Site photo.jpg' }));
      const viewer = await screen.findByRole('dialog', { name: 'Site photo.jpg' });
      await userEvent.click(within(viewer).getByRole('button', { name: 'Download Site photo.jpg' }));
      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(links()).toContainEqual({ id: 'fil_001', letter: undefined, variant: 'full', disposition: 'attachment' });
      click.mockRestore();
    });

    it('gives the focus back to the preview when it closes', async () => {
      renderList([PHOTO]);
      const preview = await screen.findByRole('button', { name: 'View Site photo.jpg' });
      await userEvent.click(preview);
      await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(preview).toHaveFocus());
    });

    it('moves between the pictures of the same message with the arrow keys, and the focus returns to the last one shown', async () => {
      renderList([PHOTO, PLAN, SECOND, THIRD]);
      await userEvent.click(await screen.findByRole('button', { name: 'View Site photo.jpg' }));
      expect(await screen.findByRole('dialog', { name: 'Site photo.jpg' })).toBeInTheDocument();
      expect(screen.getByText('1 of 3')).toBeInTheDocument();
      await userEvent.keyboard('{ArrowRight}');
      expect(await screen.findByRole('dialog', { name: 'Level 2.png' })).toBeInTheDocument();
      expect(screen.getByText('2 of 3')).toBeInTheDocument();
      await userEvent.keyboard('{ArrowRight}{ArrowRight}');
      expect(screen.getByRole('dialog', { name: 'Stair.webp' })).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(screen.getByRole('button', { name: 'View Stair.webp' })).toHaveFocus());
    });

    it('downloads the picture that shows, not the first one', async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      const { links } = renderList([PHOTO, SECOND]);
      await userEvent.click(await screen.findByRole('button', { name: 'View Site photo.jpg' }));
      await screen.findByRole('dialog', { name: 'Site photo.jpg' });
      await userEvent.click(screen.getByRole('button', { name: 'Next picture' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Download Level 2.png' }));
      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(links()).toContainEqual({ id: 'fil_002', letter: undefined, variant: 'full', disposition: 'attachment' });
      click.mockRestore();
    });
  });
});

describe('isFileNamesBody', () => {
  it('is true when the words are only the file names that the composer put there for a message with no words', () => {
    expect(isFileNamesBody('Site photo.jpg', [PHOTO])).toBe(true);
    expect(isFileNamesBody('Site photo.jpg, Level 2.png', [PHOTO, SECOND])).toBe(true);
  });

  it('is true for any files, pictures or not, when the words equal the joined names exactly (fbk_040)', () => {
    expect(isFileNamesBody('Plan.pdf', [PLAN])).toBe(true);
    expect(isFileNamesBody('Site photo.jpg, Plan.pdf', [PHOTO, PLAN])).toBe(true);
    expect(isFileNamesBody('Old.jpg', [file('fil_006', 'Old.jpg')])).toBe(true);
  });

  it('is false when a person wrote words, when the names differ in any way, when a file was removed, or when there is no file', () => {
    expect(isFileNamesBody('The site photo', [PHOTO])).toBe(false);
    expect(isFileNamesBody('See Plan.pdf', [PLAN])).toBe(false);
    expect(isFileNamesBody('Plan.pdf, Site photo.jpg', [PHOTO, PLAN])).toBe(false);
    expect(isFileNamesBody('Plan.pdf', [PLAN, file('fil_005', null)])).toBe(false);
    expect(isFileNamesBody('Site photo.jpg', [])).toBe(false);
  });
});
